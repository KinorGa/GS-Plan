import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9741;
const profile = makeProfile('wico');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,1500)); } }
const ctx = await browser.newContext({ viewport:{width:1400,height:1000} });
const p = await ctx.newPage();
const bad=[]; p.on('requestfailed', r=>{ if(/png|webp|jpg/i.test(r.url())) bad.push(r.url()+' '+r.failure()?.errorText); });
await p.goto('http://127.0.0.1:5199/stats.html', { waitUntil:'networkidle' });
await p.waitForTimeout(1200);
await p.locator('button:has-text("武器")').first().click();
await p.waitForTimeout(300);
await p.locator('input').first().fill('狼的武功歌');
await p.waitForTimeout(500);
const results = [];
for (const name of ['狼的武功歌','无锋剑','猎弓','飞天御剑']) {
  await p.locator('input').first().fill(name);
  await p.waitForTimeout(400);
  const ent = p.locator('[data-stat-entry]').first();
  await ent.click();
  await p.waitForTimeout(500);
  const imgs = await p.locator('img').evaluateAll(list => list.map(im => ({ src: im.getAttribute('src'), nw: im.naturalWidth, w: im.getBoundingClientRect().width })));
  results.push({ name, imgs: imgs.filter(i=>i.w>0) });
}
console.log(JSON.stringify({ results, failedLoads: bad }, null, 1));
await p.screenshot({ path:'tests/stats-weapon-icon.png' });
await browser.close(); chrome.kill(); await removeProfile(profile);
console.log('done');
