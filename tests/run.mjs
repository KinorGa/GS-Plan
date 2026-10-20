// The test runner for the committed checks.
//
// WHY A RUNNER AND NOT A TEST FRAMEWORK. The checks already exist and each one
// is a standalone script that prints what it verified and exits 1 on failure --
// they were written that way so a single one could be run by hand while chasing
// a bug. Wrapping them in a framework would mean rewriting 22 scripts to earn
// nothing; this just runs them, in order, and aggregates the exit codes.
//
// THREE GROUPS, because they need different things to be present:
//
//   pure     the default: no browser, no server. Just Node + the repo.
//   browser  drives real Chrome over CDP against a running dev server, so it
//            needs `npm run dev` (and Chrome installed).
//   fixtures some checks read data that is NOT committed: the downloaded
//            dataset (public/data, see `npm run fetch`) or a personal exported
//            config (data/*.json). Those are skipped, loudly, when absent --
//            never silently passed.
//
// Usage:
//   npm test                 pure checks
//   npm test -- --browser    pure + browser (needs `npm run dev` first)
//   npm test -- --all        everything
//   npm test -- --list       what would run, without running it
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SERVER = 'http://127.0.0.1:5199/';

/**
 * What each check needs on disk, by file name.
 *
 * Kept here rather than in the checks so that a missing fixture is reported as a
 * SKIP by the runner instead of an obscure ENOENT from inside a test. If a check
 * grows a new fixture, add it here and the skip message stays honest.
 */
const FIXTURES = {
  'check-artifact-scan-screen.mjs': ['public/data/artifactlist.json'],
  'check-artifact-scan-panel.mjs': ['public/data/artifactlist.json', 'tests/entry-note.png'],
  'check-csharp-api.mjs': [
    'dist/index.html',
    'server/GsPlan.Api/bin/Debug/net8.0/GsPlan.Api.dll',
  ],
  'check-csharp-core.mjs': [
    'public/data/stats-compact.json',
    'server/GsPlan.Api/bin/Debug/net8.0/GsPlan.Api.dll',
  ],
  'check-csharp-axis.mjs': [
    'public/data/charlist.json',
    'public/data/weaponlist.json',
    'public/data/char/chs/10000128.json',
    'public/data/stats-compact.json',
    'public/data/talent-damage.json',
    'data/lunaris-config-2026-10-07.json',
    'server/GsPlan.Api/bin/Debug/net8.0/GsPlan.Api.dll',
  ],
  'check-csharp-merged.mjs': [
    'public/data/charlist.json',
    'public/data/weaponlist.json',
    'public/data/char/chs/10000128.json',
    'public/data/stats-compact.json',
    'public/data/talent-damage.json',
    'data/lunaris-config-2026-10-07.json',
    'server/GsPlan.Api/bin/Debug/net8.0/GsPlan.Api.dll',
  ],
  'check-csharp-optimize.mjs': [
    'public/data/charlist.json',
    'public/data/weaponlist.json',
    'public/data/char/chs/10000128.json',
    'public/data/stats-compact.json',
    'public/data/talent-damage.json',
    'data/lunaris-config-2026-10-07.json',
    'server/GsPlan.Api/bin/Debug/net8.0/GsPlan.Api.dll',
  ],
  'check-core-client.mjs': ['data/lunaris-config-2026-10-07.json'],
  'check-child-notes.mjs': ['data/法布尼-ft.json'],
  'check-derive-precise.mjs': ['public/data/char/chs/10000343.json'],
  'check-crit-flow.mjs': ['data/lunaris-config-2026-10-07.json'],
  'check-gcsim-import.mjs': [
    'public/data/charlist.json',
    'public/data/weaponlist.json',
    'public/data/artifactlist.json',
    'public/data/char/chs/10000128.json',
  ],
  'check-e2e.mjs': ['data/法布尼-ft.json'],
  'check-entry-note.mjs': ['data/法布尼-ft.json'],
  'check-expand-size.mjs': ['data/法布尼-ft.json'],
  'check-instance-button.mjs': ['data/lunaris-config-2026-10-07.json'],
  'check-library.mjs': ['public/data/charlist.json', 'public/data/weaponlist.json'],
  'check-placeholders.mjs': ['public/data/charlist.json'],
  'check-sources.mjs': [
    'public/data/charlist.json',
    'public/data/weaponlist.json',
    'public/data/artifactlist.json',
  ],
  'check-summary-precision.mjs': ['data/法布尼-ft.json'],
  'check-weapon-icons.mjs': ['public/data/weaponlist.json'],
  'check-weapon-types.mjs': ['public/data/charlist.json'],
};

const args = new Set(process.argv.slice(2));
const wantBrowser = args.has('--browser') || args.has('--all');
const pureOnly = !args.has('--browser') && !args.has('--all');
const listOnly = args.has('--list');

const files = fs
  .readdirSync(HERE)
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs'))
  .sort();

const isBrowser = (f) => fs.readFileSync(path.join(HERE, f), 'utf8').includes('playwright');

/** Every path a check needs, or null when all are present. */
function missingFixtures(file) {
  const need = FIXTURES[file] || [];
  return need.filter((p) => !fs.existsSync(path.join(ROOT, p)));
}

let serverUp = null;
async function hasServer() {
  if (serverUp !== null) return serverUp;
  try {
    const res = await fetch(SERVER, { signal: AbortSignal.timeout(2000) });
    serverUp = res.ok;
  } catch {
    serverUp = false;
  }
  return serverUp;
}

const results = [];
let ran = 0;

for (const file of files) {
  const browser = isBrowser(file);
  if (pureOnly && browser) continue;
  if (args.has('--browser') && !browser) continue;

  const missing = missingFixtures(file);
  if (missing.length) {
    results.push({ file, status: 'SKIP', note: `needs ${missing[0]} (run: npm run fetch)` });
    continue;
  }
  if (browser && !(await hasServer())) {
    results.push({ file, status: 'SKIP', note: 'dev server not running (run: npm run dev)' });
    continue;
  }

  if (listOnly) {
    results.push({ file, status: 'RUN', note: browser ? 'browser' : '' });
    continue;
  }

  ran += 1;
  const started = Date.now();
  const proc = spawnSync(
    process.execPath,
    ['--import', './tests/register-jsx-run.mjs', path.join('tests', file)],
    { cwd: ROOT, encoding: 'utf8', timeout: 180000 }
  );
  const ms = Date.now() - started;
  const out = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  const ok = proc.status === 0;

  // The checks print a verdict every run; keep the last non-empty line as the
  // summary and only dump the whole thing when something failed.
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const summary = lines[lines.length - 1] || '(no output)';
  results.push({ file, status: ok ? 'PASS' : 'FAIL', note: summary.slice(0, 90), ms });
  if (!ok) {
    console.log(`\n----- ${file} FAILED -----`);
    console.log(out);
    console.log('--------------------------\n');
  }
}

const w = Math.max(...results.map((r) => r.file.length), 10) + 2;
for (const r of results) {
  const time = r.ms ? ` ${r.ms}ms` : '';
  console.log(`${r.file.padEnd(w)} ${r.status}${time}${r.note ? '  ' + r.note : ''}`);
}
const failed = results.filter((r) => r.status === 'FAIL').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(
  `\n${ran} ran, ${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${skipped} skipped`
);
process.exit(failed ? 1 : 0);
