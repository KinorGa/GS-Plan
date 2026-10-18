// The multiplier-source picker, driven in the real planner.
//
// This is the half a pure test cannot see: that the control is present on the
// damage card, renders image + text, actually changes the computed hit, survives
// a collapse/expand round trip, and comes back from storage after a reload.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { makeProfile, removeProfile, spawnChrome, sweepProfiles } from './_profiles.mjs';

const CFG = path.join('data', '法布杜C2尼C2.json');
if (!fs.existsSync(CFG)) {
  console.log('SKIP  needs ' + CFG);
  process.exit(0);
}

const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const entry = cfg.axes[0].entries.find((e) => e.charId && e.charId !== 'none' && !(e.children || []).length);
if (!entry) {
  console.log('SKIP  the fixture has no single-part damage row');
  process.exit(0);
}

// Keep the fixture's pools (drops reference them) but shrink the axis to one row
// so opening the card is immediate and the test is not racing 400 rows of layout.
const axesState = {
  version: cfg.version ?? 2,
  activeId: cfg.activeId || cfg.axes[0].id,
  axes: [{ ...cfg.axes[0], entries: [entry] }],
  pools: cfg.pools,
};
const teamState = { version: 1, units: cfg.team.units };

const dbg = 9617;
sweepProfiles();
const profile = makeProfile('scaling-basis');
const chrome = await spawnChrome({ port: dbg, profile });

let pass = 0, fail = 0;
const ok = (name, good, detail = '') => {
  if (good) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + '  ' + detail); }
};

try {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + dbg);
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));

  const openCard = async () => {
    await p.waitForFunction(() => document.querySelector('[data-axis-entry]'));
    const collapsed = p.locator('[data-axis-entry][data-collapsed="true"]').first();
    if (await collapsed.count()) {
      const toggle = collapsed.locator('button[title="展开"], button[title="Expand"]').first();
      if (await toggle.count()) await toggle.click();
      else await collapsed.click();
      await p.waitForTimeout(700);
    }
    await p.locator('[data-scaling-basis]').first().waitFor({ state: 'visible' });
  };

  const perHit = async () => Number(
    String(await p.locator('[data-summary="perHit"]').first().innerText()).replace(/[^0-9.]/g, '')
  ) || 0;

  await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
  await p.evaluate(([axes, team]) => {
    localStorage.setItem('lunaris-axes', JSON.stringify(axes));
    localStorage.setItem('lunaris-team', JSON.stringify(team));
  }, [axesState, teamState]);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await openCard();

  const picker = p.locator('[data-scaling-basis]').first();
  ok('an unmodified old entry defaults to ATK',
    await picker.getAttribute('data-scaling-basis') === 'atk');
  ok('the closed control shows an icon and its text',
    await picker.locator('summary img').count() === 1
    && /攻击力|ATK/.test(await picker.innerText()));

  const before = await perHit();
  await picker.locator('summary').click();
  await p.waitForTimeout(150);
  const options = p.locator('[data-scaling-basis-option]');
  ok('the menu offers all four sources', await options.count() === 4, String(await options.count()));
  ok('every option carries an image and a label',
    await p.locator('[data-scaling-basis-option] img').count() === 4
    && await p.locator('[data-scaling-basis-option]').evaluateAll((els) => (
      els.every((e) => e.textContent.trim().length > 0)
    )));

  await p.locator('[data-scaling-basis-option="hp"]').click();
  await p.waitForTimeout(500);
  const after = await perHit();
  ok('choosing HP stores the source on the entry',
    await picker.getAttribute('data-scaling-basis') === 'hp');
  ok('choosing HP changes the computed hit', after > 0 && before > 0 && after !== before,
    before + ' -> ' + after);

  // Collapse and re-open the row: the card remounts, so this proves the value
  // lives on the entry rather than in the card's local state.
  const expanded = p.locator('[data-axis-entry][data-expanded="true"]').first();
  await expanded.locator('button[title="收起"], button[title="Collapse"]').first().click();
  await p.waitForTimeout(400);
  await openCard();
  ok('the source survives collapse and expand',
    await p.locator('[data-scaling-basis]').first().getAttribute('data-scaling-basis') === 'hp');

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await openCard();
  ok('the source survives a page reload',
    await p.locator('[data-scaling-basis]').first().getAttribute('data-scaling-basis') === 'hp');
  ok('the card still shows HP after reload',
    await p.locator('[data-scaling-basis]').first().innerText().then((t) => /生命值|HP/.test(t)));

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await p.screenshot({ path: 'tests/scaling-basis.png' });
  await browser.close();
} finally {
  try { chrome.kill(); } catch { /* already gone */ }
  await removeProfile(profile);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
