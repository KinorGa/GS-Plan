import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9771;
const profile = makeProfile('pagecheck');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,1500)); } }
const ctx = await browser.newContext({ viewport:{width:1400,height:1000} });
let fails=0;
for (const [name, path, expectLink] of [
  ['planner','/planner.html','/stats.html'],
  ['buffs','/buffs.html','/stats.html'],
  ['audit','/audit.html','/stats.html'],
  ['stats','/stats.html',null],
]) {
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(String(e).slice(0,200)));
  await p.goto('http://127.0.0.1:5199'+path, { waitUntil:'networkidle' });
  await p.waitForTimeout(2000);
  const link = expectLink ? await p.locator(`a[href="${expectLink}"]`).count() : 0;
  const ok = errs.length===0 && (!expectLink || link>0);
  if(!ok) fails++;
  console.log(`${ok?'PASS':'FAIL'}  ${name}: link(${expectLink})=${link} errors=${JSON.stringify(errs)}`);
  await p.close();
}
await browser.close(); chrome.kill(); await removeProfile(profile);
console.log(fails? `\n${fails} FAILED` : '\nall page checks passed');
process.exit(fails?1:0);
