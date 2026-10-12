// The instance button must not overlap the card's own trailing controls.
//
// The bug: "+ 实例" was an absolute sibling at `right-2 top-2`, which lands
// exactly on the buff-count chip and the chevron that already live in the card's
// top-right -- measured, they overlapped into an unreadable pile. The fix moves
// it into a slot the card reserves room for, so this checks the geometry rather
// than trusting the markup.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9610;
const profile = makeProfile('inst-overlap');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,2000)); } }
if (!browser) { console.log('CDP FAILED'); process.exit(2); }
const ctx = await browser.newContext({ viewport:{width:1600,height:1000}, deviceScaleFactor:1 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,200)));
const cfg = JSON.parse(require('fs').readFileSync('data/lunaris-config-2026-10-07.json','utf8'));

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+'  '+x);} };

await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil:'networkidle' });
await p.evaluate(({team,axes,activeId,version})=>{ localStorage.setItem('lunaris-team',JSON.stringify({version:1,units:team.units})); localStorage.setItem('lunaris-axes',JSON.stringify({version,axes,activeId})); }, cfg);
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(3000);
await p.locator('[data-pool-mode] button', { hasText:'实例' }).first().click().catch(()=>{});
await p.waitForTimeout(400);
await p.locator('[data-new-instance]').click();
await p.waitForTimeout(500);

const measure = () => p.evaluate(() => {
  const card = document.querySelector('[data-pool-template] [data-buff-card]');
  if (!card) return null;
  const b = card.querySelector('[data-instantiate]');
  const col = card.querySelector('button > span:last-child');
  const chip = col && col.querySelector('span');
  const chev = col && col.querySelector('svg');
  const name = card.querySelector('button span span.truncate');
  const g = e => e ? { x:e.getBoundingClientRect().x, y:e.getBoundingClientRect().y, w:e.getBoundingClientRect().width, h:e.getBoundingClientRect().height } : null;
  const ov = (a,c) => a&&c && !(a.x+a.w<=c.x || c.x+c.w<=a.x || a.y+a.h<=c.y || c.y+c.h<=a.y);
  const B=g(b), C=g(chip), V=g(chev), N=g(name);
  return { hasButton: !!b, ovChip: ov(B,C), ovChev: ov(B,V), ovName: ov(B,N) };
});

// --- collapsed state --------------------------------------------------------
let m = await measure();
ok('the instantiate button renders', m?.hasButton);
ok('collapsed: no overlap with the chip', m && !m.ovChip, JSON.stringify(m));
ok('collapsed: no overlap with the chevron', m && !m.ovChev, JSON.stringify(m));
ok('collapsed: no overlap with the name', m && !m.ovName, JSON.stringify(m));

// --- expanded (hover) state -------------------------------------------------
await p.locator('[data-pool-template]').first().hover();
await p.waitForTimeout(400);
m = await measure();
ok('expanded: no overlap with the chip', m && !m.ovChip, JSON.stringify(m));
ok('expanded: no overlap with the chevron', m && !m.ovChev, JSON.stringify(m));
ok('expanded: no overlap with the name', m && !m.ovName, JSON.stringify(m));

ok('no page errors', errs.length === 0, errs.join('|'));
console.log('\n' + pass + ' pass, ' + fail + ' fail');
await browser.close(); chrome.kill(); await removeProfile(profile);
process.exit(fail ? 1 : 0);