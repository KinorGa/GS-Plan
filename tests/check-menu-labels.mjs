// Does the stage menu now show the full multiplier text for compound rows?
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
const PORT = 9713;
const profile = makeProfile('check-menu-labels');

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

// open the stage menu and expand 元素战技
await p.locator('[data-damage-card] button:has-text("攻击段")').first().click();
await p.waitForTimeout(900);
await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  [...m.querySelectorAll('button')].find((b) => b.textContent.includes('元素战技'))?.click();
});
await p.waitForTimeout(1400);

const rows = await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  return [...m.querySelectorAll('button')].map((b) => b.textContent.trim());
});

// Which rows contain a '+' (compound) and does the label show it?
const compound = rows.filter((r) => /\d+\.\d+%\+/.test(r));
console.log('menu rows:');
rows.forEach((r) => console.log('   ', r));
console.log('\nrows showing a FULL compound label (+):', compound.length);
compound.forEach((r) => console.log('   ', r));

// cross-check against the raw data
const expected = ['狂飙突进·二段伤害', '狂飙突进·三段伤害', '狂飙突进·四段伤害',
  '狂飙突进·五段伤害', '狂飙突进·重击伤害', '四风将起伤害', '苍噬伤害'];
const missing = expected.filter((n) => !rows.some((r) => r.startsWith(n) && /\+/.test(r)));
console.log('\nexpected compound rows:', expected.length, '| missing a "+" label:', JSON.stringify(missing));

// Scroll the menu so the compound rows are in view, then capture.
await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  const target = [...m.querySelectorAll('button')].find((b) => b.textContent.includes('狂飙突进·二段伤害'));
  target?.scrollIntoView({ block: 'center' });
});
await p.waitForTimeout(500);
const box = await p.evaluate(() => {
  const m = document.querySelector('[data-stage-menu]');
  const r = m.getBoundingClientRect();
  return { x: Math.max(0, r.left - 20), y: Math.max(0, r.top - 20), width: r.width + 40, height: Math.min(r.height + 40, 900) };
});
await p.screenshot({ path: 'tests/menu-full.png', clip: box });
console.log('wrote tests/menu-full.png');

await browser.close();
chrome.kill();
await removeProfile(profile);
process.exit(missing.length ? 1 : 0);
