// Does a normalDmg / dmgBonus buff move a PHYSICAL hit? Per the code it should
// (the comment says the generic field "adds to whichever element the hit uses"),
// but dmgBonusFor returns early for Physical.
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
const PORT = 9809;
const profile = makeProfile('check-physical');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p = await (await browser.newContext({ viewport: { width: 1700, height: 1100 } })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));

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

const read = () => p.evaluate(() => {
  const card = document.querySelector('[data-damage-card]');
  if (!card) return null;
  const label = [...card.querySelectorAll('p')].find((e) => /单段伤害|Damage per Hit/.test(e.textContent));
  const t = label?.nextElementSibling?.textContent?.trim().replace(/,/g, '');
  const m = /(直伤|蒸发|融化|超导|扩散)/.exec(card.textContent);
  return { perHit: t && /^\d+$/.test(t) ? Number(t) : null, element: m ? m[1] : null };
});

const setField = (key, v) => p.evaluate(({ key, v }) => {
  const f = [...document.querySelectorAll('[data-stat-field]')].find((x) => x.getAttribute('data-stat-field') === key);
  const input = f?.querySelector('input');
  if (!input) return 'no input ' + key;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, String(v));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  return 'ok';
}, { key, v });

console.log('physical hit (法尔伽 普攻 一段):');
console.log('  base            :', JSON.stringify(await read()));

await setField('dmgBonus', 100);
await p.waitForTimeout(1500);
console.log('  dmgBonus=100    :', JSON.stringify(await read()), ' <- generic bonus on a PHYSICAL hit');

await setField('physBonus', 100);
await p.waitForTimeout(1500);
console.log('  physBonus=100   :', JSON.stringify(await read()), ' <- physical bonus (should apply)');

await browser.close();
chrome.kill();
await removeProfile(profile);
