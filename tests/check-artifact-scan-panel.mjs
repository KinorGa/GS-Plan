// The scan panel, driven in a real browser: a screenshot in, totals out.
//
// WHAT THIS PINS DOWN THAT THE OTHER TWO CANNOT
//   `check-artifact-scan.mjs` proves the MAPPING and `check-artifact-scan-screen.mjs`
//   proves it against the real catalogue, but both stop at a row object. A row is
//   not a build: the panel has to sit in the artifact row, the review has to
//   render it, the tick has to reach `artifacts`, and the STAT TOTALS beside the
//   slots have to move -- which is the only thing the user actually looks at.
//   That chain runs through React state, so it needs a browser.
//
// THE MODEL IS STUBBED, SO THIS IS DETERMINISTIC
//   `/api/vision` is replaced in the page with a canned reply -- and its GET with a
//   canned "yes, the variable is set" -- which is why this needs no key, no
//   environment variable and no network. The reading itself is the model's
//   business (and is what the screenshots in the other check are transcribed
//   from); what is under test here is everything after it.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeProfile, sweepProfiles, removeProfile } from './_profiles.mjs';

sweepProfiles();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9721;
const SERVER = 'http://127.0.0.1:5199/planner.html';
// A large committed PNG, so the page's own downscale runs (a screenshot straight
// off a 1440p monitor is the case that needs it).
const IMAGE = path.join(ROOT, 'tests', 'entry-note.png');

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

const profile = makeProfile('check-artifact-scan-panel');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', '--hide-scrollbars', '--disable-dev-shm-usage',
  '--disable-extensions', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

try {
  await page.goto(SERVER, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  /* ------------------------------------------------- a character to build for */
  await page.locator('button:has-text("添加角色")').click();
  await page.waitForTimeout(800);
  await page.locator('button[title="法尔伽"]').click();
  await page.waitForTimeout(1200);

  ok('the scan panel is in the artifact row', await page.locator('[data-artifact-row] [data-artifact-scan]').count() === 1);
  ok('it renders AFTER the stat totals', await page.evaluate(() => {
    const slots = document.querySelector('[data-artifact-slots]');
    const kids = [...slots.children];
    return kids.indexOf(document.querySelector('[data-artifact-totals]'))
      < kids.indexOf(document.querySelector('[data-artifact-scan]'));
  }));

  await page.locator('[data-scan-open]').click();
  await page.waitForTimeout(400);

  ok('the key field names a variable, and defaults rather than starting empty',
    await page.locator('input[placeholder^="USTC_API_KEY"]').inputValue() === 'USTC_API_KEY');
  ok('the panel reports back that the server can see the variable',
    await page.locator('[data-scan-env="set"]').count() === 1);
  ok('the read button is disabled with no endpoint', await page.locator('[data-scan-run]').isDisabled());
  await page.locator('input[placeholder="https://api.openai.com/v1"]').fill('https://api.example.com/v1');
  await page.locator('input[placeholder="gpt-4o-mini"]').fill('stub-model');
  await page.waitForTimeout(200);
  ok('and still disabled with no image', await page.locator('[data-scan-run]').isDisabled());

  /* ------------------------------------------------------------ the reply */
  const reply = {
    pieces: [
      { pieceName: '献与月的酹祭', set: '晨星与月的晓歌', slot: '空之杯', level: 0,
        main: { name: '水元素伤害加成', value: 7.0 },
        subs: [{ name: '暴击率', value: 3.5 }, { name: '防御力', value: 5.8 },
          { name: '暴击伤害', value: 7.8 }, { name: '生命值', value: 239 }] },
      // A Flower, because a main stat and a substat adding up under ONE key is
      // what the totals panel exists for (`生命值` 717 + 239).
      { pieceName: '风花的箴铭', set: '风起之日: (5)', slot: '生之花', level: 0,
        main: { name: '生命值', value: 717 }, subs: [] },
      { set: '未来才会出的套装', slot: '死之羽', level: 20,
        main: { name: '攻击力', value: 311 },
        subs: [{ name: '暴击率', value: 5.0 }] },
    ],
  };
  await page.evaluate((text) => {
    const original = window.fetch;
    const json = (body) => Promise.resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    // Every scan body is kept, so the test can read what actually went out.
    window.__scanBodies = [];
    window.fetch = (url, opts) => {
      if (!String(url).includes('/api/vision')) return original(url, opts);
      // A POST is the scan itself; anything else is the panel's question about
      // whether the server can see the key's environment variable.
      if (opts && opts.method === 'POST') {
        window.__scanBodies.push(opts.body);
        return json({ text });
      }
      return json({ ok: true, keyEnv: 'USTC_API_KEY', keyPresent: true });
    };
  }, JSON.stringify(reply));

  await page.setInputFiles('input[type="file"][accept="image/*"]', IMAGE);
  await page.waitForTimeout(1000);
  // The image is re-encoded to a 1600px JPEG before it is sent: the file is
  // 1.6 MB and what the page holds must be a fraction of that.
  const shown = await page.locator('[data-artifact-scan] ~ *').first().textContent().catch(() => '');
  const sizeText = await page.locator('p:has-text("KB")').first().textContent().catch(() => '');
  ok('the image is shrunk before sending', /KB/.test(sizeText) && Number(sizeText.match(/(\d+) KB/)?.[1]) < 600, `${sizeText} / ${shown.slice(0, 40)}`);

  await page.locator('[data-scan-run]').click();
  await page.waitForSelector('[data-scan-piece]', { timeout: 20000 });
  await page.waitForTimeout(400);

  // The secret stays out of the request: the body names the variable, and there is
  // nothing in it for a page to leak.
  const sent = await page.evaluate(() => (window.__scanBodies || []).map((b) => JSON.parse(b)));
  ok('the request carries the variable name and no key',
    sent.length === 1 && sent[0].keyEnv === 'USTC_API_KEY' && sent[0].key === undefined,
    JSON.stringify(sent[0] || {}).slice(0, 90));

  /* ------------------------------------------------------- the review table */
  const pieces = page.locator('[data-scan-piece]');
  ok('one row per recognized piece', await pieces.count() === 3, String(await pieces.count()));
  ok('the goblet row landed on the goblet', await page.locator('[data-scan-piece="goblet"]').count() === 1);
  ok('the flower row landed on the flower', await page.locator('[data-scan-piece="flower"]').count() === 1);
  ok('the plume row landed on the plume', await page.locator('[data-scan-piece="plume"]').count() === 1);

  const goblet = page.locator('[data-scan-piece="goblet"]');
  ok('the recognized set is shown', (await goblet.innerText()).includes('晨星与月的晓歌'));
  ok('the raw words are shown beside it', (await goblet.innerText()).includes('献与月的酹祭'));
  // The exact total behind the game's rounded print: 3.5% is really 3.501.
  ok('a rounded substat shows the exact total it will store', (await goblet.innerText()).includes('3.501'));
  ok('a matched row carries no warning', !(await goblet.innerText()).includes('⚠'));

  const plume = page.locator('[data-scan-piece="plume"]');
  ok('an unmatched set is warned about, not guessed', (await plume.innerText()).includes('套装没认出'));
  ok('and its set shows as unchosen', (await plume.innerText()).includes('选择套装'));

  /* --------------------------------------------------------------- applying */
  ok('every row starts ticked', await page.locator('[data-scan-include]:checked').count() === 3, String(await page.locator('[data-scan-include]:checked').count()));
  await page.locator('[data-scan-piece="plume"] [data-scan-include]').uncheck();
  ok('unticking one leaves the others', await page.locator('[data-scan-include]:checked').count() === 2);

  await page.locator('[data-scan-apply]').click();
  await page.waitForTimeout(600);

  ok('the dialog closed on apply', await page.locator('[data-scan-apply]').count() === 0);
  ok('the goblet is now the scanned set', (await page.locator('[data-artifact-slot="goblet"]').innerText()).includes('晨星与月的晓歌'));
  ok('the flower is now the scanned set', (await page.locator('[data-artifact-slot="flower"]').innerText()).includes('风起之日'));
  ok('the unticked plume was NOT written', !(await page.locator('[data-artifact-slot="plume"]').innerText()).includes('未来才会出的套装'));

  /* ------------------------------------- the point of the whole thing: totals */
  const total = async (key) => (await page.locator(`[data-total-row="${key}"]`).innerText()).replace(/\s+/g, '');
  ok('flat HP totals the main stat and the substat (717+239)', (await total('hp')).includes('956'), await total('hp'));
  ok('CRIT Rate totals the one substat', (await total('critRate')).includes('3.5'), await total('critRate'));
  ok('DEF% totals its substat', (await total('defPct')).includes('5.8'), await total('defPct'));
  ok('CRIT DMG totals its substat', (await total('critDmg')).includes('7.8'), await total('critDmg'));
  ok('the goblet main stat totals as elemental DMG', (await total('hydroDmg')).includes('7'), await total('hydroDmg'));
  ok('an empty slot contributed nothing', await page.locator('[data-total-row="atk"]').count() === 0);

  /* ------------------------------------------- the settings outlive the tab */
  ok('the endpoint settings were remembered', await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('lunaris-vision') || '{}');
    return saved.baseUrl === 'https://api.example.com/v1' && saved.model === 'stub-model'
      && saved.keyEnv === 'USTC_API_KEY' && !('key' in saved);
  }));
  // ...and nowhere else: the key is not part of the exported config document.
  ok('the key is not in the project data file', await page.evaluate(async () => {
    const r = await fetch('/api/data', { cache: 'no-store' });
    return !(await r.text()).includes('api.example.com');
  }));

  ok('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  chrome.kill();
  await removeProfile(profile);
}

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
