// Where browser test profiles live, and how they are deleted.
//
// WHY NOT `os.tmpdir()`. Every script used to create its Chrome profile under
// `%TEMP%` and then remove it, and the removal FAILED EVERY TIME -- measured:
//
//     chrome.kill();
//     fs.rmSync(profile, ...)   ->  EPERM: Permission denied
//     still present 1.5s later? ->  true
//     a second rmSync           ->  works
//
// `kill()` signals the process; it does not wait for it. Chrome is still shutting
// down and still holds handles inside the directory, so the delete throws -- and
// because it sat inside a `try { } catch { }`, it threw silently. 128 scripts each
// left ~75 MB behind, Windows never cleans `%TEMP%` (its own `GetTempFileName` docs
// say temporary files "are not automatically deleted"), and the pile survived
// reboots until the user cleared it by hand.
//
// TWO CHANGES, and both are needed:
//
//   1. THE PROFILES LIVE IN `tmp/` IN THE PROJECT, via `profilesDir()`. It is a
//      directory this repo owns, it is in `.gitignore`, and its contents are
//      obviously disposable -- so when something does go wrong it is one folder to
//      delete rather than a hunt through the system temp directory.
//
//   2. THE DELETE RETRIES. `removeProfile` waits for the directory to become
//      removable instead of trying once and giving up, which is what makes the
//      first point stay clean rather than merely moving the mess.
//
// It also sweeps: `sweepProfiles()` removes anything left in `tmp/` from an earlier
// run, so a crash cannot accumulate.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** The directory profiles are created in: `<project>/tmp`. */
export function profilesDir() {
  const dir = path.join(ROOT, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Delete a profile, waiting for the process that holds it to let go. */
export async function removeProfile(dir, { tries = 20, wait = 150 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      if (!fs.existsSync(dir)) return true;
    } catch {
      // EPERM/EBUSY while Chrome is still exiting -- retry.
    }
    await new Promise((r) => setTimeout(r, wait));
  }
  return !fs.existsSync(dir);
}

/**
 * The synchronous form, for a `process.on('exit')` handler.
 *
 * `exit` cannot await, so this spins. Bounded, because a handler that never returns
 * would hang the process it is trying to tidy up after.
 */
export function removeProfileSync(dir, { tries = 30, waitMs = 60 } = {}) {
  const sleep = (ms) => {
    const end = Date.now() + ms;
    // Atomics.wait on a throwaway buffer is the only synchronous sleep in Node.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, end - Date.now()));
  };
  for (let i = 0; i < tries; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      if (!fs.existsSync(dir)) return true;
    } catch { /* still held */ }
    sleep(waitMs);
  }
  return !fs.existsSync(dir);
}

/**
 * Remove profiles left by earlier runs.
 *
 * Called once per script at launch. A run that is killed -- Ctrl+C, a timeout, a
 * crash -- cannot clean up after itself, so something has to collect the debris, and
 * doing it at the START of the next run is the only moment that is guaranteed to
 * happen.
 */
export function sweepProfiles({ keep = [] } = {}) {
  const dir = profilesDir();
  const keepSet = new Set(keep);
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (keepSet.has(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      n += 1;
    } catch { /* in use by a concurrent run -- leave it */ }
  }
  return n;
}

/**
 * Create a profile in `tmp/` that deletes itself.
 *
 * The `exit` handler is registered the moment the directory exists, so even the
 * `process.exit()` every one of these scripts ends with still tidies up.
 */
export function makeProfile(name) {
  const dir = fs.mkdtempSync(path.join(profilesDir(), `${name}-`));
  process.once('exit', () => removeProfileSync(dir));
  return dir;
}

/** Chrome's executable, in one place so a path change is a one-line edit. */
export const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/** Launch Chrome against a managed profile, and wait for the debugger. */
export async function spawnChrome({ port, profile, args = [], extra = [] }) {
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-sandbox',
    '--hide-scrollbars',
    // Headless Chrome started failing the CDP handshake on this machine unless
    // these were present -- the debugger port answered but the socket reset mid-
    // connect (code=1006), so every browser script died at connectOverCDP.
    // --disable-dev-shm-usage is the load-bearing one.
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-gpu',
    // Keep the profile small as well as temporary. These caps hold a run to a few
    // megabytes while leaving localStorage intact, which the tests depend on.
    '--disk-cache-size=1',
    '--disable-application-cache',
    '--disable-gpu-shader-disk-cache',
    '--window-size=1900,1500',
    ...args,
    ...extra,
    'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return chrome;
}
