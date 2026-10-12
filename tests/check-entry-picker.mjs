// Open the damage entry's character picker and measure it.
//
// This is the one statically-flagged `absolute` popover that is NOT portalled
// (DamageEntry.jsx:330), so it is the prime suspect for the same clipping bug.
// The audit could not open it, which means it is unverified either way.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';

// Collect anything an earlier run could not delete -- a killed run cannot tidy up
// after itself, and this is the only moment guaranteed to happen.
sweepProfiles();

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9431;
const profile = makeProfile('check-entry-picker');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));

await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

await p.locator('button:has-text("添加角色")').click();
await p.waitForTimeout(800);
await p.locator('button[title="法尔伽"]').click();
await p.waitForFunction(() => !document.querySelector('.fixed.inset-0.z-\\[60\\]'), null, { timeout: 10000 });
await p.waitForTimeout(800);

// Add several entries so a LATER one is low on the page -- the case where a
// downward popover runs out of room.
await p.locator('[data-add-entry]').click();
await p.waitForTimeout(1500);

// What does the entry's picker button look like?
const candidates = await p.evaluate(() =>
  [...document.querySelectorAll('button')]
    .filter((b) => /选择角色|Pick character|法尔伽|温迪/.test(b.textContent))
    .map((b) => ({
      text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 24),
      inEntry: !!b.closest('[data-axis-entry]'),
      cls: String(b.className).slice(0, 50),
    })));
console.log('picker candidates:');
for (const c of candidates) console.log(`  inEntry=${c.inEntry}  "${c.text}"  ${c.cls}`);

// Click the in-entry one.
const clicked = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find((b) => b.closest('[data-axis-entry]') && /选择角色|Pick character|法尔伽|温迪/.test(b.textContent));
  if (!btn) return 'not found';
  btn.click();
  return 'clicked';
});
await p.waitForTimeout(900);
console.log(`\n${clicked}`);
if (clicked !== 'clicked') {
  // Show what IS in the entry header.
  const header = await p.evaluate(() => {
    const e = document.querySelector('[data-axis-entry]');
    return e ? e.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : 'no entry';
  });
  console.log('entry header:', header);
}

const report = await p.evaluate(() => {
  // The picker is the 180px popover.
  const menu = [...document.querySelectorAll('div')]
    .find((d) => /w-\[180px\]/.test(String(d.className)));
  if (!menu) return { error: 'menu not found' };
  const r = menu.getBoundingClientRect();

  const culprits = [];
  let el = menu.parentElement;
  let d = 0;
  while (el && d++ < 12) {
    const cs = getComputedStyle(el);
    const clips = /hidden|auto|scroll|clip/.test(cs.overflowX) || /hidden|auto|scroll|clip/.test(cs.overflowY);
    const traps = cs.transform !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none';
    if (clips || traps) {
      const nr = el.getBoundingClientRect();
      culprits.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 60),
        overflow: `${cs.overflowX}/${cs.overflowY}`,
        trap: traps ? 'yes' : '',
        cutBottom: Math.round(r.bottom - nr.bottom),
        cutRight: Math.round(r.right - nr.right),
      });
    }
    el = el.parentElement;
  }

  const opts = [...menu.querySelectorAll('button')];
  const visible = opts.filter((o) => {
    const or = o.getBoundingClientRect();
    return or.top >= r.top - 1 && or.bottom <= r.bottom + 1;
  }).length;

  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    parent: menu.parentElement?.tagName,
    inViewport: r.top >= 0 && r.bottom <= innerHeight,
    options: opts.length,
    visible,
    culprits,
  };
});

if (report.error) console.log(report.error);
else {
  console.log(`\nmenu ${report.w}x${report.h}, y ${report.top}..${report.bottom}, parent <${report.parent}>`);
  console.log(`options ${report.visible}/${report.options} visible; in viewport: ${report.inViewport}`);
  console.log('\nancestors that clip or trap it:');
  if (!report.culprits.length) console.log('  (none)');
  for (const c of report.culprits) {
    console.log(`  <${c.tag}> overflow=${c.overflow}${c.trap ? ' TRAPS' : ''}  ${c.cls}`);
    if (c.cutBottom > 0) console.log(`      cuts ${c.cutBottom}px off the bottom`);
    if (c.cutRight > 0) console.log(`      cuts ${c.cutRight}px off the right`);
  }
}

await p.screenshot({ path: 'tests/entry-picker.png' });
await browser.close();
chrome.kill();
await removeProfile(profile);
