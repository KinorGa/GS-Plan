// Is the cardOnly picker reachable with charId 'none'? That would render the
// demo card (Odette) under an entry that has no character.
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
const PORT = 9761;
const profile = makeProfile('check-none-entry');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage', '--disable-extensions', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p = await (await browser.newContext({ viewport: { width: 1600, height: 1100 } })).newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

await p.goto('http://127.0.0.1:5199/planner.html', { waitUntil: 'networkidle' });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(2200);

// Click 添加条目 — a brand-new entry: charId 'none', expanded true.
await p.locator('[data-add-entry]').click();
await p.waitForTimeout(1800);

const state = await p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('lunaris-axes') || '{}');
  const e = d?.axes?.[0]?.entries?.[0];
  return {
    charId: e?.charId,
    expanded: e?.expanded,
    hasChildren: !!e?.children?.length,
    domCardOnly: document.querySelectorAll('[data-card-only]').length,
    domGroups: document.querySelectorAll('[data-entry-group]').length,
  };
});
console.log('new entry state:', JSON.stringify(state));

// What does the entry's own card show?
const cardText = await p.evaluate(() => {
  const c = document.querySelector('[data-damage-card]');
  if (!c) return null;
  const p = [...c.querySelectorAll('p')].map((x) => x.textContent.trim());
  return { firstTexts: p.slice(0, 4), src: c.getAttribute('data-source-only') };
});
console.log('the card on screen:', JSON.stringify(cardText));

await browser.close();
chrome.kill();
await removeProfile(profile);
