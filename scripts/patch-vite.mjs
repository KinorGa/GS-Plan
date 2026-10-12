// Post-install patch for running Vite inside a sandbox that blocks piped
// child processes.
//
// Vite's `optimizeSafeRealPathSync()` (Windows only) shells out to `net use`
// via child_process.exec to detect mapped network drives. With piped stdio
// blocked that throws `spawn EPERM`, which surfaces as a 500 on every module
// request. This machine has no mapped network drives, so the probe is
// pointless: replace it with the same fallback Vite uses when the map is empty.
//
// Idempotent: safe to run repeatedly.
import fs from 'node:fs';
import path from 'node:path';

const CHUNK_DIR = path.join(process.cwd(), 'node_modules', 'vite', 'dist', 'node', 'chunks');

if (!fs.existsSync(CHUNK_DIR)) {
  console.log('[patch-vite] vite not installed yet; nothing to do');
  process.exit(0);
}

// (1) Vite's Windows-only `net use` probe spawns a child process with pipes.
const NET_USE_NEEDLE = 'exec("net use", (error, stdout) => {';
const NET_USE_MARKER = '/* dsh:net-use-probe-patched */';

// (2) The async esbuild transform spawns a child process; the sync variant runs
//     on a worker thread inside this process, which the sandbox allows.
const TRANSFORM_NEEDLE = 'const result = await transform$1(code, resolvedOptions);';
const TRANSFORM_MARKER = '/* dsh:esbuild-sync-transform */';
const TRANSFORM_REPLACEMENT =
  '/* dsh:esbuild-sync-transform */ const result = esbuild.transformSync ? esbuild.transformSync(code, resolvedOptions) : await transform$1(code, resolvedOptions);';

let patched = 0;
let netUseDone = false;
let transformDone = false;

for (const file of fs.readdirSync(CHUNK_DIR)) {
  if (!file.endsWith('.js')) continue;
  const full = path.join(CHUNK_DIR, file);
  let src = fs.readFileSync(full, 'utf8');
  let changed = false;

  if (src.includes(NET_USE_NEEDLE)) {
    const replacement =
      NET_USE_MARKER + ' safeRealpathSync = fs__default.realpathSync.native; ' +
      'void 0 && exec("net use", (error, stdout) => {';
    src = src.replace(NET_USE_NEEDLE, replacement);
    changed = true;
    netUseDone = true;
  } else if (src.includes(NET_USE_MARKER)) {
    netUseDone = true;
  }

  if (src.includes(TRANSFORM_NEEDLE)) {
    src = src.replace(TRANSFORM_NEEDLE, TRANSFORM_REPLACEMENT);
    changed = true;
    transformDone = true;
  } else if (src.includes(TRANSFORM_MARKER)) {
    transformDone = true;
  }

  if (changed) {
    fs.writeFileSync(full, src, 'utf8');
    console.log(`[patch-vite] patched ${file}`);
    patched++;
  }
}

console.log(
  `[patch-vite] net-use probe: ${netUseDone ? 'ok' : 'NOT FOUND'}, esbuild sync transform: ${
    transformDone ? 'ok' : 'NOT FOUND'
  }`
);
if (!netUseDone || !transformDone) {
  console.error('[patch-vite] WARNING: a patch target was not found; Vite may still spawn children');
}
