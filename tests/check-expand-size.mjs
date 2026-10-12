import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9763;
const profile = makeProfile('chevsize');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=3', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,2000)); } }
const ctx = await browser.newContext({ viewport:{width:1720,height:900}, deviceScaleFactor:3 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,200)));
const full = JSON.parse(fs.readFileSync('data/法布尼-ft.json','utf8'));
let e1=null; const walk=(es)=>{for(const e of es||[]){ if(e.id==='e1') e1=e; if(e.children) walk(e.children); }}; walk(full.axes.find(a=>a.id===full.activeId).entries);
await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil:'networkidle' });
await p.evaluate(({team,axes,activeId,version})=>{ localStorage.setItem('lunaris-team',JSON.stringify({version:1,units:team.units})); localStorage.setItem('lunaris-axes',JSON.stringify({version,axes,activeId})); }, { team: full.team, version:1, activeId:'ax1', axes:[{ id:'ax1', name:'t', entries:[e1] }] });
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(2500);
const measure = () => p.evaluate(() => {
  const row = document.querySelector('[data-axis-entry]');
  const btns = [...row.querySelectorAll('button')];
  const g = e => { const r=e.getBoundingClientRect(); return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }; };
  const chev = btns.find(b=>/[\u25be\u25b4]/.test(b.textContent));
  const del = btns.find(b=>b.textContent.includes('\u2715'));
  const weight = row.querySelector('span.w-\\[76px\\]');
  const ov=(a,c)=>a&&c && !(a.x+a.w<=c.x || c.x+c.w<=a.x || a.y+a.h<=c.y || c.y+c.h<=a.y);
  return { row:g(row), chev: chev?g(chev):null, del: del?g(del):null, weight: weight?g(weight):null,
    ovDel: ov(chev&&g(chev), del&&g(del)), ovWeight: ov(chev&&g(chev), weight&&g(weight)) };
});
console.log('COLLAPSED', JSON.stringify(await measure()));
await p.locator('[data-axis-entry]').screenshot({ path:'tests/chev-collapsed.png' });
await p.locator('[data-axis-entry] button[title="展开"]').first().click();
await p.waitForTimeout(1000);
console.log('EXPANDED ', JSON.stringify(await measure()));
console.log('errors', JSON.stringify(errs));
await browser.close(); chrome.kill(); await removeProfile(profile);
console.log('done');
