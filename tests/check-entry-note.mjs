import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
sweepProfiles();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9770;
const profile = makeProfile('note');
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
for (let i=0;i<160;i++){ try{ if((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; }catch{} await new Promise(r=>setTimeout(r,250)); }
let browser=null; for(let a=1;a<=4 && !browser;a++){ try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 }); } catch(e){ await new Promise(r=>setTimeout(r,2000)); } }
const ctx = await browser.newContext({ viewport:{width:1720,height:1100}, deviceScaleFactor:2 });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,300)));
const full = JSON.parse(fs.readFileSync('data/法布尼-ft.json','utf8'));
const all = full.axes.find(a=>a.id===full.activeId).entries;
const flat = []; const collect=(es)=>{for(const e of es){ if(e.kind==='segment') collect(e.children); else flat.push(e); }}; collect(all);
const byId = id => flat.find(e=>e.id===id);
const e1 = byId('e1');
const compound = flat.find(e=>e.id==='e3' && Array.isArray(e.children));
const loopMembers = [byId('e2'), byId('e5')].filter(Boolean);
const axisEntries = [e1, compound, { id:'seg1', kind:'segment', name:'\u5faa\u73afA', children: loopMembers }].filter(Boolean);
await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil:'networkidle' });
await p.evaluate(({team,axes,activeId,version})=>{ localStorage.setItem('lunaris-team',JSON.stringify({version:1,units:team.units})); localStorage.setItem('lunaris-axes',JSON.stringify({version,axes,activeId})); }, { team: full.team, version:1, activeId:'ax1', axes:[{ id:'ax1', name:'t', entries: axisEntries }] });
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(2500);

let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('PASS  '+n);} else {fail++;console.log('FAIL  '+n+'  '+x);} };
const ls = () => p.evaluate(()=>JSON.parse(localStorage.getItem('lunaris-axes')||'{}'));
const noteOf = (axes, eid) => { const walk=(es)=>{for(const e of es||[]){ if(e.id===eid) return e.note; if(e.children){const r=walk(e.children); if(r!==undefined) return r;}}}; return walk(axes.axes[0].entries); };

ok('an ordinary row shows a note control', await p.locator('[data-axis-entry] [data-entry-note]').count() === 1);
ok('the compound parent header has none (it is a container)', await p.locator('[data-entry-group] [data-entry-note]').count() === 0);

// --- type a note on the ordinary row -------------------------------------
await p.locator('[data-axis-entry] [data-entry-note]').click();
await p.waitForTimeout(200);
ok('clicking opens a textarea', await p.locator('[data-entry-note-input]').count() === 1);
await p.locator('[data-entry-note-input]').fill('\u6d4b\u8bd5\u7b14\u8bb0');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
let axes = await ls();
ok('the note was saved to the entry', noteOf(axes,'e1') === '\u6d4b\u8bd5\u7b14\u8bb0', JSON.stringify(noteOf(axes,'e1')));
ok('the row now shows it', (await p.locator('[data-axis-entry] [data-entry-note]').innerText()).includes('\u6d4b\u8bd5\u7b14\u8bb0'));

// --- a compound row's PARTS each get one ---------------------------------
await p.locator('[data-entry-group] button[title="展开"]').first().click();
await p.waitForTimeout(900);
const partNotes = await p.locator('[data-entry-child] [data-entry-note]').count();
ok('each part of the compound row has its own note control', partNotes >= 2, 'got '+partNotes);
const second = p.locator('[data-entry-child] [data-entry-note]').nth(1);
await second.click();
await p.waitForTimeout(200);
await p.locator('[data-entry-note-input]').fill('\u5b50\u6bb5\u7b14\u8bb0');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
axes = await ls();
const childIds = (axes.axes[0].entries.find(e=>Array.isArray(e.children)) || {}).children || [];
ok('the note landed on a PART, not the parent', childIds.some(c=>c.note === '\u5b50\u6bb5\u7b14\u8bb0') && noteOf(axes,'e3') === undefined, JSON.stringify(childIds.map(c=>[c.id,c.note])));

// --- a loop member gets one too ------------------------------------------
await p.locator('[data-entry-loop] button[title="展开"]').first().click();
await p.waitForTimeout(900);
const memberNotes = await p.locator('[data-loop-body] [data-entry-note]').count();
ok('loop members have note controls', memberNotes >= 2, 'got '+memberNotes);
await p.locator('[data-loop-body] [data-entry-note]').first().click();
await p.waitForTimeout(200);
await p.locator('[data-entry-note-input]').fill('\u5faa\u73af\u6210\u5458\u7b14\u8bb0');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
axes = await ls();
const seg = axes.axes[0].entries.find(e=>e.kind==='segment');
ok('a loop member carries its own note', (seg.children||[]).some(c=>c.note === '\u5faa\u73af\u6210\u5458\u7b14\u8bb0'), JSON.stringify((seg.children||[]).map(c=>[c.id,c.note])));

// --- survives a reload ----------------------------------------------------
await p.reload({ waitUntil:'networkidle' });
await p.waitForTimeout(2500);
const after = await p.locator('[data-axis-entry] [data-entry-note]').innerText();
ok('the note is still there after a reload', after.includes('\u6d4b\u8bd5\u7b14\u8bb0'), after);

ok('no page errors', errs.length===0, errs.join(' | '));
console.log('\n'+pass+' pass, '+fail+' fail');
await p.screenshot({ path:'tests/entry-note.png', fullPage:true });
await browser.close(); chrome.kill(); await removeProfile(profile);
process.exit(fail?1:0);
