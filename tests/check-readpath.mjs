// Where does a buff's formatted reading actually appear?
//
// The picker check could not get the editor card to collapse. Rather than keep
// fighting the open/close mechanics, this asks the easier question: does the
// READ path (the planner's pool, which is never editable) format the value?
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
const PORT = 9401;
const profile = makeProfile('check-readpath');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();

// Seed a library with a critDmg buff on a weapon, then look at the pool.
await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  localStorage.setItem('lunaris-buff-library', JSON.stringify({
    version: 2,
    entries: { 'weapon:12502:r1': [{ key: 'critDmg', value: 32, tag: '测试' }] },
  }));
  localStorage.removeItem('lunaris-team');
});
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2000);

await p.locator('button:has-text("添加角色")').click();
await p.waitForTimeout(800);
await p.locator('button[title="法尔伽"]').click();
await p.waitForFunction(() => !document.querySelector('.fixed.inset-0.z-\\[60\\]'), null, { timeout: 10000 });
await p.waitForTimeout(700);

await p.locator('[data-unit-card]').first().locator('button:has-text("选择武器")').click();
await p.waitForTimeout(1400);
await p.locator('button[title="狼的末路"]').first().click();
await p.waitForTimeout(1600);

const poolCard = await p.evaluate(() =>
  ([...document.querySelectorAll('[draggable="true"]')].find((c) => /武器/.test(c.textContent)) || {}).textContent?.replace(/\s+/g, ' ').trim() || '');

console.log(`pool weapon card: ${poolCard}`);
console.log(`shows +32%: ${/\+32%/.test(poolCard)}`);
console.log(`shows the tag: ${/测试/.test(poolCard)}`);

// And in the editor, hover (not click) so nothing is pinned.
await p.goto('http://127.0.0.1:5199/buffs.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500);
await p.locator('input[placeholder*="搜索"]').fill('狼的末路');
await p.waitForTimeout(1200);
const card = p.locator('[data-source-card]').first();

// Hover only: the card opens on hover, and nothing gets pinned.
await card.hover();
await p.waitForTimeout(900);
const hovered = await card.textContent();
console.log(`\neditor card (hovered): ${hovered.replace(/\s+/g, ' ').slice(0, 90)}`);
console.log(`shows +32%: ${/\+32%/.test(hovered)}`);

await p.screenshot({ path: 'tests/readpath.png' });
await browser.close();
chrome.kill();
await removeProfile(profile);
