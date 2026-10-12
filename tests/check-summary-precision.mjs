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

const read = () => p.evaluate(() => {
  const labels=['总生命','总攻击','总防御','天赋倍率','反应增幅','暴击','伤害加成','防御区','抗性区','充能效率'];
  const out={};
  for (const lab of labels){ const el=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()===lab); if(el) out[lab]=el.nextElementSibling?.textContent; }
  const dmg=[...document.querySelectorAll('p')].find(x=>x.textContent.trim()==='单段伤害');
  const fields=[...document.querySelectorAll('[data-stat-field]')].map(f=>{const inp=f.querySelector('input'); return { key:f.getAttribute('data-stat-field'), value:inp.value, clipped: inp.scrollWidth>inp.clientWidth+1 };});
  return { strip: out, perHit: dmg?.nextElementSibling?.textContent, fields };
});
const r = await read();
console.log(JSON.stringify(r, null, 1));
console.log('errors:', JSON.stringify(errs));
await e1.screenshot({ path:'tests/summary-precision.png' }).catch(()=>{});
await p.screenshot({ path:'tests/summary-precision-full.png' });
await browser.close(); chrome.kill(); await removeProfile(profile);
console.log('done');
