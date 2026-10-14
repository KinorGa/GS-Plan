import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9761;
const profile = makeProfile('sumprec');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,2000)); } }
const ctx = await browser.newContext({ viewport:{width:1600,height:1100}, deviceScaleFactor:2 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200)));
const cfg = JSON.parse(require('fs').readFileSync('data/法布尼-ft.json','utf8'));
await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil:'networkidle' });
await p.evaluate(({team,axes,activeId,version})=>{ localStorage.setItem('lunaris-team',JSON.stringify({version:1,units:team.units})); localStorage.setItem('lunaris-axes',JSON.stringify({version,axes,activeId})); }, cfg);
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(2500);

await p.locator('[data-loop-header] button[title="展开"], [data-loop-header] button[title="Expand"]').first().click();
await p.waitForTimeout(800);
console.log('loop members visible:', await p.evaluate(()=>document.querySelectorAll('[data-entry-header]').length));

// A loop member that has several parts renders a `[data-entry-header]` row, and its
// PARTS -- the `[data-entry-child]` wrappers -- only exist while that row is expanded.
// The old selector asked for a child wrapper literally named `e1`, which never
// matches any more: `e1` is a member id, and a member is a header, not a child.
const partRow = p.locator('[data-entry-header] button[title="展开"], [data-entry-header] button[title="Expand"]').first();
await partRow.click();
await p.waitForTimeout(1200);
console.log('children after part expand:', await p.evaluate(()=>document.querySelectorAll('[data-entry-child]').length));

const e1 = p.locator('[data-entry-child]').first();
// The part itself starts collapsed; the stat strip this reads is inside it.
const partToggle = e1.locator('button[title="展开"], button[title="Expand"]').first();
if (await partToggle.count()) { await partToggle.click(); await p.waitForTimeout(1200); }
console.log('stat fields visible:', await p.evaluate(()=>document.querySelectorAll('[data-stat-field]').length));

// The strip items carry `data-summary="<key>"`, so a probe can find the summary
// value outright. `伤害加成` is BOTH a field-group heading and a summary label,
// so the old text-matching reader hit the heading and printed the whole group's
// rows as its value -- a run-on that read like a strip-rendering bug. Keying off
// the attribute removes the ambiguity for good.
const SUMMARY_KEYS = ['totalHp', 'totalAtk', 'totalDef', 'talent', 'reaction', 'crit', 'dmgBonus', 'defZone', 'resZone', 'er'];

const read = () => p.evaluate((keys) => {
  const strip = {};
  for (const k of keys) {
    const box = document.querySelector(`[data-summary="${k}"]`);
    strip[k] = {
      label: box?.firstElementChild?.textContent?.trim() ?? null,
      value: box?.lastElementChild?.textContent?.trim() ?? null,
    };
  }
  const fields = [...document.querySelectorAll('[data-stat-field]')].map((f) => {
    const inp = f.querySelector('input');
    return { key: f.getAttribute('data-stat-field'), value: inp.value, clipped: inp.scrollWidth > inp.clientWidth + 1 };
  });
  return { strip, perHit: document.querySelector('[data-summary="perHit"]')?.textContent?.trim() ?? null, fields };
}, SUMMARY_KEYS);

const r = await read();
console.log(JSON.stringify(r, null, 1));
console.log('errors:', JSON.stringify(errs));

let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ' != ' + JSON.stringify(want)}`);
};

// Every strip item exists and shows a value. 伤害加成 must read a single
// percentage -- if it ever reads the field grid again, the '✕' clear-buttons
// would show up here.
for (const k of SUMMARY_KEYS) check(`strip item ${k}`, typeof r.strip[k].value === 'string' && r.strip[k].value.length > 0, true);
check('dmgBonus is one percentage', /^-?[\d,]+(\.\d+)?%$/.test(r.strip.dmgBonus.value), true);
check('dmgBonus carries no clear-button glyph', r.strip.dmgBonus.value.includes('✕'), false);
check('perHit is a number', /^-?[\d,]+(\.\d+)?$/.test(r.perHit), true);
check('fields rendered', r.fields.length > 0, true);
check('page errors', errs.length, 0);

// The precision is a SETTING now (统一设置 -> 展示精度), so the strip must both
// default to at most three decimals and follow the choice. The click is the part
// a unit test cannot see: it proves the store re-rendered the card rather than
// only the dialog that set it.
const decimals = (s) => {
  const m = String(s).match(/\.(\d+)/);
  return m ? m[1].length : 0;
};
const worstDecimals = (strip) =>
  Math.max(...Object.values(strip).map((cell) => decimals(cell.value)));

check('default strip keeps at most 3 decimals', worstDecimals(r.strip) <= 3, true);

await p.locator('[data-bulk-open]').click();
await p.waitForTimeout(400);
check('the bulk dialog offers the precision control',
  await p.locator('[data-bulk-precision]').count(), 7);
await p.locator('[data-bulk-precision="1"]').click();
await p.waitForTimeout(300);
await p.keyboard.press('Escape');
await p.waitForTimeout(700);
const r1 = await read();
check('choosing 1 decimal caps the strip', worstDecimals(r1.strip) <= 1, true);
check('settings still left no errors', errs.length, 0);

await e1.screenshot({ path: 'tests/summary-precision.png' }).catch(() => {});
await p.screenshot({ path: 'tests/summary-precision-full.png' });
await browser.close(); chrome.kill(); await removeProfile(profile);
console.log(fail ? `FAILED: ${fail}` : 'all summary checks passed');
process.exit(fail ? 1 : 0);
