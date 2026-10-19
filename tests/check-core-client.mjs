// Verify the browser actually uses the batched C# core when it is served by it,
// and falls back cleanly when the adapter is disabled. The ordinary Node server
// has no /api/core/meta, so this check belongs beside the other browser tests.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';

if (process.platform !== 'win32') {
  console.log('SKIP: this browser check uses the local Chrome installation');
  process.exit(0);
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9774;
const BASE = 'http://127.0.0.1:5199';
const cfg = JSON.parse(fs.readFileSync('data/lunaris-config-2026-10-07.json', 'utf8'));

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log('PASS  ' + name);
  } else {
    fail += 1;
    console.log('FAIL  ' + name + (detail ? '  ' + detail : ''));
  }
};

sweepProfiles();
const profile = makeProfile('core-client');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
  '--disable-extensions', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

let browser = null;
try {
  for (let i = 0; i < 160; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break;
    } catch { /* Chrome is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (let i = 0; i < 4 && !browser; i += 1) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (!browser) throw new Error('CDP connection failed');

  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  let damageBatches = [];
  let panelBatches = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/core/')) return;
    try {
      if (url.endsWith('/api/core/damage-batch') && response.ok()) {
        const body = await response.json();
        damageBatches.push(body.results?.length || 0);
      } else if (url.endsWith('/api/core/derive-panel-batch') && response.ok()) {
        const body = await response.json();
        panelBatches.push(body.results?.length || 0);
      }
    } catch { /* A malformed response is caught by the assertions below. */ }
  });

  await page.goto(BASE + '/planner.html', { waitUntil: 'networkidle' });
  await page.evaluate(({ team, axes, activeId, version }) => {
    localStorage.removeItem('gsplan.core');
    localStorage.setItem('lunaris-team', JSON.stringify({ version: 1, units: team.units }));
    localStorage.setItem('lunaris-axes', JSON.stringify({ version, axes, activeId }));
  }, cfg);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const readRows = () => page.evaluate(() => (
    [...document.querySelectorAll('[data-entry-header]')]
      .map((row) => row.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  ));
  const coreRows = await readRows();
  ok('core mode sent a damage batch', damageBatches.length > 0, JSON.stringify(damageBatches));
  ok('damage batch contained multiple requests', damageBatches.some((count) => count > 1), JSON.stringify(damageBatches));
  ok('core mode sent a panel batch', panelBatches.length > 0, JSON.stringify(panelBatches));
  ok('planner rows contain rendered numbers', coreRows.some((text) => /\d[\d,]*/.test(text)), JSON.stringify(coreRows.slice(0, 2)));
  ok('core mode produced no page errors', errors.length === 0, errors.join('|'));

  damageBatches = [];
  panelBatches = [];
  await page.evaluate(() => localStorage.setItem('gsplan.core', 'js'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const fallbackRows = await readRows();
  ok('js mode sends no core requests', damageBatches.length === 0 && panelBatches.length === 0,
    JSON.stringify({ damageBatches, panelBatches }));
  ok('js fallback leaves the same rows visible', fallbackRows.length === coreRows.length,
    `${coreRows.length} != ${fallbackRows.length}`);
  ok('js fallback contains rendered numbers', fallbackRows.some((text) => /\d[\d,]*/.test(text)));
} catch (error) {
  fail += 1;
  console.log('FAIL  ' + String(error?.stack || error));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (chrome.exitCode == null) {
    try { chrome.kill(); } catch { /* best effort */ }
  }
  await removeProfile(profile).catch(() => {});
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
