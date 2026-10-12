import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9772;
const profile = makeProfile('childnotes');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,2000)); } }
const ctx = await browser.newContext({ viewport:{width:1720,height:1200}, deviceScaleFactor:2 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,300)));
const full = JSON.parse(fs.readFileSync('data/法布尼-ft.json','utf8'));
const all = full.axes.find(a=>a.id===full.activeId).entries;
const flat=[]; const collect=(es)=>{for(const e of es){ if(e.kind==='segment') collect(e.children); else flat.push(e); }}; collect(all);
const byId = id => flat.find(e=>e.id===id);
const compound = JSON.parse(JSON.stringify(flat.find(e=>e.id==='e3' && Array.isArray(e.children))));
compound.children[0].note = '\u7b2c\u4e00\u6bb5\u5e26\u62a4\u76fe\u624d\u7b97';
compound.children[1].note = '\u6269\u6563\u5403\u4e0d\u5230\u6297\u6027';
const e1 = { ...byId('e1'), note: '\u81ea\u5df1\u7684\u7b14\u8bb0' };
const loopMember = { ...byId('e2'), note: '\u6210\u5458\u7684\u7b14\u8bb0' };
const compoundMember = JSON.parse(JSON.stringify(flat.find(e=>Array.isArray(e.children) && e.id==='e7')));
if (compoundMember) compoundMember.children[1].note = '\u6210\u5458\u7684\u5b50\u6bb5\u7b14\u8bb0';
const entries = [e1, compound, { id:'seg1', kind:'segment', name:'\u5faa\u73afA', children:[loopMember, compoundMember].filter(Boolean) }];
await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil:'networkidle' });
await p.evaluate(({team,axes,activeId,version})=>{ localStorage.setItem('lunaris-team',JSON.stringify({version:1,units:team.units})); localStorage.setItem('lunaris-axes',JSON.stringify({version,axes,activeId})); }, { team: full.team, version:1, activeId:'ax1', axes:[{ id:'ax1', name:'t', entries }] });
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(2500);

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+'  '+x);} };

const compoundNotes = p.locator('[data-entry-group] [data-child-notes]');
ok('the collapsed compound row repeats its parts\' notes', await compoundNotes.count() === 1);
const text = await compoundNotes.innerText();
ok('both notes are on it', text.includes('\u7b2c\u4e00\u6bb5\u5e26\u62a4\u76fe\u624d\u7b97') && text.includes('\u6269\u6563\u5403\u4e0d\u5230\u6297\u6027'), text);
ok('with the part numbers', /1/.test(text) && /2/.test(text), text);
const tip = await compoundNotes.getAttribute('title');
ok('the tooltip lists them one per line', tip && tip.includes('\n'), JSON.stringify(tip));

const loopNotes = p.locator('[data-entry-loop] [data-child-notes]');
ok('the collapsed loop repeats its members\' notes', await loopNotes.count() === 1);
const ltext = await loopNotes.innerText();
ok('including a member\'s own note', ltext.includes('\u6210\u5458\u7684\u7b14\u8bb0'), ltext);
ok('and a member\'s PART note, labelled', ltext.includes('\u6210\u5458\u7684\u5b50\u6bb5\u7b14\u8bb0'), ltext);

// an ordinary row keeps its own note, and shows no child summary
ok('an ordinary row shows its own note only', await p.locator('[data-axis-entry] [data-entry-note]').count() === 1 && await p.locator('[data-axis-entry] [data-child-notes]').count() === 0);

// click opens the row
await compoundNotes.click();
await p.waitForTimeout(800);
ok('clicking the summary opens the row', await p.locator('[data-entry-group] [data-entry-child]').count() >= 2);
ok('the summary hides while the row is open', await p.locator('[data-entry-group] [data-child-notes]').count() === 0);

ok('no page errors', errs.length===0, errs.join(' | '));
console.log('\n'+pass+' pass, '+fail+' fail');
await p.screenshot({ path:'tests/child-notes.png', fullPage:true });
await browser.close(); chrome.kill(); await removeProfile(profile);
process.exit(fail?1:0);
