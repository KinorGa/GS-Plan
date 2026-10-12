// The bulk-settings dialog, driven in a real browser.
//
// The pure test proves the walk; this proves the WIRING -- that the toolbar button
// opens a dialog whose Apply reaches the entries and whose Revert puts them back,
// which is the half that a unit test cannot see.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import fs from 'node:fs';

sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9531;
const profile = makeProfile('bulk');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 160; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { up = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
if (!up) { console.log('COULD NOT REACH CDP'); process.exit(2); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

// A tiny axis of two plain rows, built straight into storage so the test does not
// depend on the shipped sample file's shape.
const seed = {
  version: 1,
  activeId: 'a1',
  axes: [{
    id: 'a1', name: 'test',
    entries: [
      { id: 'e1', charId: 'none', drops: [], statOverrides: { enemyLevel: 100 }, critMode: 'never', summary: null, expanded: false },
      { id: 'e2', charId: 'none', drops: [], statOverrides: { enemyLevel: 100, enemyResPyro: 40 }, critMode: 'avg', summary: null, expanded: false },
    ],
  }],
};

await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
await p.evaluate((s) => {
  localStorage.setItem('lunaris-axes', JSON.stringify(s));
  localStorage.setItem('lunaris-team', JSON.stringify({ version: 1, units: [] }));
}, seed);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2500);

const readEntries = () => p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('lunaris-axes'));
  return s.axes.find((a) => a.id === s.activeId).entries;
});

// --- 1. the button exists and opens the dialog -------------------------------
ok('bulk-open button is present', await p.locator('[data-bulk-open]').count() === 1);
await p.locator('[data-bulk-open]').click();
await p.waitForTimeout(400);
ok('dialog opens', await p.locator('[data-bulk-dialog]').count() === 1);
ok('the crit-mode choices are there', await p.locator('[data-bulk-crit]').count() === 3);
ok('enemy fields rendered', await p.locator('[data-bulk-field]').count() >= 10, String(await p.locator('[data-bulk-field]').count()));
ok('no RES-SHRED field (that is a buff, not the enemy)',
  await p.locator('[data-bulk-field^="resShred"]').count() === 0);
ok('every element RES row carries its element icon',
  await p.locator('[data-bulk-field="enemyResPyro"] img').count() === 1);

// --- 2. Apply is inert until something is ticked -----------------------------
ok('Apply starts disabled', await p.locator('[data-bulk-apply]').isDisabled());

// --- 3. set the enemy level to 55 and crit mode to crit ----------------------
await p.locator('[data-bulk-input="enemyLevel"]').fill('55');
await p.locator('[data-bulk-crit="crit"]').click();
ok('Apply enables once something is set', !(await p.locator('[data-bulk-apply]').isDisabled()));
await p.locator('[data-bulk-apply]').click();
await p.waitForTimeout(500);
ok('dialog closes on apply', await p.locator('[data-bulk-dialog]').count() === 0);

let es = await readEntries();
ok('entry 1 enemy level applied', es[0].statOverrides.enemyLevel === 55, JSON.stringify(es[0].statOverrides));
ok('entry 2 enemy level applied', es[1].statOverrides.enemyLevel === 55);
ok('entry 1 crit mode applied', es[0].critMode === 'crit');
ok('entry 2 crit mode applied', es[1].critMode === 'crit');
ok('entry 2 keeps its own pyro RES (not ticked)', es[1].statOverrides.enemyResPyro === 40, JSON.stringify(es[1].statOverrides));

// --- 4. Revert puts the OLD values back --------------------------------------
ok('revert button appears after apply', await p.locator('[data-bulk-revert]').count() === 1);
await p.locator('[data-bulk-revert]').click();
await p.waitForTimeout(500);
es = await readEntries();
ok('entry 1 enemy level restored', es[0].statOverrides.enemyLevel === 100, JSON.stringify(es[0].statOverrides));
ok('entry 2 enemy level restored', es[1].statOverrides.enemyLevel === 100);
ok('entry 1 crit mode restored', es[0].critMode === 'never', es[0].critMode);
ok('entry 2 crit mode restored', es[1].critMode === 'avg', es[1].critMode);
ok('revert button disappears after revert', await p.locator('[data-bulk-revert]').count() === 0);

// --- 5. no console errors along the way --------------------------------------
ok('no page/console errors', errs.length === 0, errs.join(' | '));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
await browser.close(); chrome.kill(); await removeProfile(profile);
process.exit(fail ? 1 : 0);