// The artifact optimiser, driven in a real browser.
//
// The pure test proves the problem format and the search; this proves the
// WIRING, which is the half a unit test cannot see: that the button sits on the
// artifact panel, that the dialog draws the five PIECE CARDS with their artwork
// and their per-piece substat states, that "从配置导入" pins what the build wears,
// that Run reaches '/api/optimize', and that the returned CSV lands as a table
// beside the current build.
//
// Needs 'npm run dev' (the page AND the '/api/optimize' hop) and a built
// 'native/optimize/optimize.exe'. The seed is a real saved configuration, so the
// expression it merges is hundreds of rows rather than a synthetic pair.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { makeProfile, removeProfile, spawnChrome, sweepProfiles } from './_profiles.mjs';

const PORT = Number(process.env.PLAN_PORT || 5199);
const SITE = 'http://127.0.0.1:' + PORT + '/planner.html';
const CFG = path.join('data', '法布杜C2尼C2.json');

if (!fs.existsSync(CFG)) {
  console.log('SKIP  needs ' + CFG);
  process.exit(0);
}
if (!fs.existsSync(path.join('native', 'optimize', 'optimize.exe'))) {
  console.log('SKIP  needs native/optimize/optimize.exe (run native/optimize/build.bat)');
  process.exit(0);
}

// The stored shapes are the ones the app itself writes: the team as
// '{ version, units }', the axes with their pools still packed.
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const axesState = { version: cfg.version ?? 2, axes: cfg.axes, activeId: cfg.activeId, pools: cfg.pools };
const teamState = { version: 1, units: cfg.team.units };

// How many substats the fixture build actually wears: four lines times five
// pieces. Counted through the app's own resolver rather than off the raw file, so
// the number the test expects is the number the page will render.
const { activeArtifacts } = await import('../src/lib/artifact-sets.js');
const fixtureBuild = activeArtifacts(cfg.team.units[0]);
const wornLines = Object.values(fixtureBuild)
  .reduce((n, piece) => n + (piece?.subStats || []).filter((s) => s?.key).length, 0);

const dbg = 9588;
// 'spawnChrome' waits for CDP itself, and it retries the handshake -- a bare
// 'connectOverCDP' reset mid-connect on this machine without its flags.
sweepProfiles();
const profile = makeProfile('optimize');
const chrome = await spawnChrome({ port: dbg, profile });

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

const browser = await chromium.connectOverCDP('http://127.0.0.1:' + dbg);
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });

await p.goto(SITE, { waitUntil: 'networkidle' });
await p.evaluate(([a, t]) => {
  localStorage.setItem('lunaris-axes', JSON.stringify(a));
  localStorage.setItem('lunaris-team', JSON.stringify(t));
}, [axesState, teamState]);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(3000);

ok('the optimise button is on the artifact panel',
  await p.locator('[data-artifact-optimize]').count() === 1);

await p.locator('[data-artifact-optimize]').click();
await p.waitForTimeout(600);
const dialog = p.locator('[data-optimize-dialog]');
ok('the dialog opens', await dialog.count() === 1);

const shown = await dialog.innerText();
ok('the merged expression is printed', shown.includes('合并后的伤害表达式') || shown.includes('Merged damage expression'));
ok('the formula for the expected value is stated', shown.includes('min(R + ΔR, 100)'));

// THE FIVE PIECES, DRAWN. The dialog is a set of cards rather than a pile of
// sliders, and each card is a picture: a text-only panel cannot say which slot is
// missing artwork or which substat is legal where.
ok('five piece cards are drawn', await p.locator('[data-piece-card]').count() === 5);
ok('each card carries its piece artwork',
  await dialog.locator('img').count() >= 5,
  String(await dialog.locator('img').count()));
const cells = await p.locator('[data-substat-cell]').count();
ok('every substat a piece may carry is a cell', cells === 45, String(cells));
ok('every card states its main stat',
  await p.locator('[data-piece-main]').count() === 5);
// The main stat is EXCLUSIVE, and it is excluded by not being offered at all:
// nine cells a card, not ten, because a plume can never roll flat ATK.
ok('a piece is not offered its own main stat as a substat',
  await p.locator('[data-piece-card="plume"] [data-substat-cell="atk"]').count() === 0
  && await p.locator('[data-piece-card="flower"] [data-substat-cell="hp"]').count() === 0
  && await p.locator('[data-piece-card="circlet"] [data-substat-cell="critDmg"]').count() === 0);


// A BUILD WITH SUBSTATS OPENS IMPORTED: the lines it wears are on the cards as
// 必选, so the search starts inside a space that contains the build on screen.
ok('the worn substats are pinned on open',
  await p.locator('[data-substat-cell][data-state="2"]').count() === wornLines,
  (await p.locator('[data-substat-cell][data-state="2"]').count()) + ' vs ' + wornLines);
ok('the worn roll count is reported', /次满档/.test(shown), shown.slice(0, 300));

// The cells cycle, and the toolbar can free them again.
const firstPinned = p.locator('[data-substat-cell][data-state="2"]').first();
await firstPinned.click();
await p.waitForTimeout(150);
ok('clicking a pinned cell frees it',
  await p.locator('[data-substat-cell][data-state="2"]').count() === wornLines - 1,
  String(await p.locator('[data-substat-cell][data-state="2"]').count()));
await p.locator('[data-optimize-import]').click();
await p.waitForTimeout(150);
ok('importing puts it back',
  await p.locator('[data-substat-cell][data-state="2"]').count() === wornLines);
await p.locator('[data-optimize-allmay]').click();
await p.waitForTimeout(150);
ok('every substat can be made optional',
  await p.locator('[data-substat-cell][data-state="2"]').count() === 0);
await p.locator('[data-optimize-import]').click();
await p.waitForTimeout(150);

await p.locator('[data-optimize-run]').click();
await p.waitForFunction(() => document.querySelectorAll('[data-optimize-results]').length === 1, null, { timeout: 120000 });
await p.waitForTimeout(500);

const res = await p.locator('[data-optimize-results]').innerText();
ok('the best allocation is named', res.includes('最优') || res.includes('Best'));
ok('the current build is compared', res.includes('当前配置') || res.includes('Current build'));
ok('the row count is reported', /种分配/.test(res), res.slice(0, 200));
ok('a page of rows is rendered', await p.locator('[data-optimize-results] tbody tr').count() > 50);
ok('the table has a column per substat',
  await p.locator('[data-optimize-results] thead svg, [data-optimize-results] thead img').count() >= 10,
  String(await p.locator('[data-optimize-results] thead svg, [data-optimize-results] thead img').count()));

// The current build is PINNED, not sorted into the rows: it has to be on screen
// beside the best allocation or the comparison is a number nobody can find.
ok('the current build is pinned beside the best', await p.locator('[data-optimize-current]').count() === 1);
ok('the current build card is not a search row',
  await p.locator('[data-optimize-current] tbody tr').count() === 0);

// The order switch reads the SAME rows under the other two crit conventions.
await p.locator('[data-optimize-order="crit"]').click();
await p.waitForTimeout(200);
ok('the table can be ordered by the crit convention',
  (await p.locator('[data-optimize-results] tbody tr').count()) > 0);

// THE HEADLINE FOLLOWS THE SORT. A crit-maximising allocation deliberately trades
// average damage for crit damage; if the top card kept showing 'avg' it would
// report the best crit build as WORSE than the current one. Read the SAME metric
// the table is sorted by, and require it to be at least the current build's.
const num = (t) => Number(String(t).replace(/[^0-9.]/g, '')) || 0;
const bestCrit = num(await p.locator('[data-optimize-best="crit"]').innerText());
const curCrit = num(await p.locator('[data-optimize-current-value="crit"]').innerText());
ok('the headline shows the CRIT value when sorted by crit',
  bestCrit > 0 && curCrit > 0 && bestCrit >= curCrit,
  bestCrit + ' vs ' + curCrit);

await p.locator('[data-optimize-order="avg"]').click();
await p.waitForTimeout(200);
const bestAvg = num(await p.locator('[data-optimize-best="avg"]').innerText());
const curAvg = num(await p.locator('[data-optimize-current-value="avg"]').innerText());
ok('the headline shows the AVG value when sorted by avg',
  bestAvg > 0 && curAvg > 0 && bestAvg >= curAvg,
  bestAvg + ' vs ' + curAvg);

// THE BASELINE IS SCALED BY NOTHING. The roll scale models the CANDIDATE rolls,
// not the build the user wears: changing it must leave the current build's number
// untouched, or every gain is measured against a build weaker than the real one.
const curAvgBefore = num(await p.locator('[data-optimize-current-value="avg"]').innerText());
await p.locator('[data-field="hit-scale"]').fill('0.8');
await p.waitForTimeout(150);
await p.locator('[data-optimize-run]').click();
await p.waitForFunction(() => document.querySelectorAll('[data-optimize-results]').length === 1, null, { timeout: 120000 });
const curAvgAfter = num(await p.locator('[data-optimize-current-value="avg"]').innerText());
ok('the current build does not move with the roll scale',
  curAvgAfter > 0 && curAvgAfter === curAvgBefore,
  curAvgBefore + ' vs ' + curAvgAfter);

// Switching a main stat REBUILDS the substat pool: the old main stat comes back as
// an ordinary substat and the new one leaves the list. The sands is the slot to try
// it on -- a plume has exactly one legal main stat, so nothing there can change.
await p.locator('[data-piece-main="sands"]').click();
await p.waitForTimeout(250);
ok('the main-stat menu offers the slot its own pool',
  await p.locator('[data-stat-menu] button').count() >= 5,
  String(await p.locator('[data-stat-menu] button').count()));
await p.locator('[data-stat-menu] button').first().click();
await p.waitForTimeout(250);
ok('the new main stat stops being a substat',
  await p.locator('[data-piece-card="sands"] [data-substat-cell="hpPct"]').count() === 0);
ok('the old main stat becomes one again',
  await p.locator('[data-piece-card="sands"] [data-substat-cell="atkPct"]').count() === 1);
ok('the slot still offers nine substats',
  await p.locator('[data-piece-card="sands"] [data-substat-cell]').count() === 9);

ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
await browser.close();
try { chrome.kill(); } catch { /* already gone */ }
await removeProfile(profile);
process.exit(fail ? 1 : 0);
