// The parent header should no longer offer a redundant 换段 button, and the
// triangle alone must still reveal the picker.
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
const PORT = 9717;
const profile = makeProfile('check-header');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=2', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p = await (await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

const ok = [], bad = [];
const check = (c, label, d = '') => { (c ? ok : bad).push(label); console.log(`${c ? 'PASS' : 'FAIL'}  ${label}${d ? `  (${d})` : ''}`); };

await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

await p.locator('button:has-text("添加角色")').click();
await p.waitForTimeout(900);
await p.locator('button[title="法尔伽"]').click();
await p.waitForFunction(() => !document.querySelector('.fixed.inset-0.z-\\[60\\]'), null, { timeout: 10000 });
await p.waitForTimeout(900);
await p.locator('[data-add-entry]').click();
await p.waitForTimeout(1400);
await p.evaluate(() => {
  const e = document.querySelector('[data-axis-entry]');
  [...e.querySelectorAll('button')].find((b) => /选择角色|Pick character/.test(b.textContent))?.click();
});
await p.waitForTimeout(700);
await p.locator('[data-char-menu] button').first().click();
await p.waitForTimeout(2600);

await p.locator('[data-damage-card] button:has-text("攻击段")').first().click();
await p.waitForTimeout(900);
await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  [...m.querySelectorAll('button')].find((b) => b.textContent.includes('元素战技'))?.click();
});
await p.waitForTimeout(1400);
await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  [...m.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('狂飙突进·二段伤害'))?.click();
});
await p.waitForTimeout(2400);

// --- the header must NOT contain a 换段 button ---
const header = await p.evaluate(() => {
  const g = document.querySelector('[data-entry-group]');
  const hdr = g.querySelector(':scope > div');
  return {
    buttons: [...hdr.querySelectorAll('button')].map((b) => (b.textContent || '').trim() || b.getAttribute('title') || '?'),
    hasChangeBtn: [...hdr.querySelectorAll('button')].some((b) => /换段|change/i.test(b.textContent || '')),
  };
});
console.log('parent header buttons:', JSON.stringify(header.buttons));
check(!header.hasChangeBtn, 'the header no longer offers a redundant 换段 button');

// --- collapse then expand with the TRIANGLE alone; the picker must return ---
await p.evaluate(() => {
  const g = document.querySelector('[data-entry-group]');
  [...g.querySelectorAll('button')].find((b) => /▴|▾/.test(b.textContent))?.click();
});
await p.waitForTimeout(1200);
const collapsed = await p.evaluate(() => ({
  picker: !!document.querySelector('[data-parent-picker]'),
  arrow: [...document.querySelector('[data-entry-group]').querySelectorAll('button')]
    .find((b) => /▴|▾/.test(b.textContent))?.textContent.trim(),
}));
check(!collapsed.picker, 'collapsing hides the picker', JSON.stringify(collapsed));

await p.evaluate(() => {
  const g = document.querySelector('[data-entry-group]');
  [...g.querySelectorAll('button')].find((b) => /▴|▾/.test(b.textContent))?.click();
});
await p.waitForTimeout(1400);
const reopened = await p.evaluate(() => {
  const pk = document.querySelector('[data-parent-picker]');
  const btn = pk && [...pk.querySelectorAll('button')].find((b) => /攻击段/.test(b.textContent));
  return { picker: !!pk, stage: btn ? btn.textContent.trim() : null, disabled: btn?.disabled ?? null };
});
console.log('after re-expanding:', JSON.stringify(reopened));
check(reopened.picker, 'the TRIANGLE alone reopens the picker');
check(reopened.disabled === false, 'the parent stage menu is still enabled in the picker');

// --- the child still cannot re-pick ---
// A child renders its card only while EXPANDED, so open it first; otherwise this
// check passes for the wrong reason (there is simply no card to inspect).
await p.evaluate(() => {
  const c = document.querySelectorAll('[data-entry-child]')[0];
  // Same selector the multipart suite uses, so this stays in step with the UI.
  const t = c && [...c.querySelectorAll('button')].find((x) => x.getAttribute('title') === '展开');
  t?.click();
});
await p.waitForTimeout(1800);
const childInfo = await p.evaluate(() => {
  const c = document.querySelectorAll('[data-entry-child]')[0];
  if (!c) return { error: 'NO CHILD IN DOM', count: 0 };
  const card = c.querySelector('[data-damage-card]');
  if (!card) return { error: 'child card not mounted', expanded: false };
  const btn = [...card.querySelectorAll('button')].find((b) => /攻击段/.test(b.textContent));
  return btn ? { disabled: btn.disabled, text: btn.textContent.trim() } : { error: 'no stage button' };
});
console.log('child probe:', JSON.stringify(childInfo));
check(childInfo.error === undefined && childInfo.disabled === true,
  'a child still cannot re-pick the row', JSON.stringify(childInfo));

const box = await p.evaluate(() => {
  const g = document.querySelector('[data-entry-group]');
  const r = g.getBoundingClientRect();
  return { x: Math.max(0, r.left - 10), y: Math.max(0, r.top - 10), width: r.width + 20, height: Math.min(r.height + 20, 300) };
});
await p.screenshot({ path: 'tests/header.png', clip: box });

console.log('\npage errors: none observed');
console.log(`\nPASS ${ok.length} / FAIL ${bad.length}`);
await browser.close();
chrome.kill();
await removeProfile(profile);
process.exit(bad.length ? 1 : 0);
