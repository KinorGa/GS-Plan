// Compare the C# legal-substat table with src/lib/substat-rolls.js for every
// stat and rarity, including tier decompositions and roll counts.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  SUBSTAT_UNIT, legalTotals, rollCountsOf, tierValues,
} from '../src/lib/substat-rolls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');

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

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (url, timeoutMs = 15000) => {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error?.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
};

const post = async (base, pathname, value) => {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let server;
try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: { ...process.env, GsPlan__Port: String(port) },
    stdio: 'ignore',
  });
  await waitFor(base + '/api/health');

  const meta = await fetch(base + '/api/core/meta').then((response) => response.json());
  ok('substat: meta advertises the route', meta.service === 'gs-plan-core' && meta.substatRolls === true);

  for (const rarity of [3, 4, 5]) {
    const result = await post(base, '/api/core/substat-rolls', { rarity });
    ok(`substat ${rarity}*: max rolls`, result.maxRolls === (rarity === 3 ? 2 : rarity === 4 ? 4 : 6));
    ok(`substat ${rarity}*: every stat is present`,
      same(Object.keys(result.stats).sort(), Object.keys(SUBSTAT_UNIT[rarity]).sort()));

    for (const key of Object.keys(SUBSTAT_UNIT[rarity])) {
      const expectedTotals = legalTotals(key, rarity);
      const actual = result.stats[key];
      ok(`substat ${rarity}* ${key}: tiers`, same(actual.tiers, tierValues(key, rarity)),
        `${JSON.stringify(actual.tiers)} != ${JSON.stringify(tierValues(key, rarity))}`);
      ok(`substat ${rarity}* ${key}: total count`, actual.totals.length === expectedTotals.length,
        `${actual.totals.length} != ${expectedTotals.length}`);

      const expected = expectedTotals.map((entry) => ({
        m: entry.m,
        value: entry.value,
        rollCounts: rollCountsOf(entry),
        entries: entry.entries,
      }));
      const got = actual.totals.map((entry) => ({
        m: entry.m,
        value: entry.value,
        rollCounts: entry.rollCounts,
        entries: entry.entries,
      }));
      ok(`substat ${rarity}* ${key}: totals and decompositions`, same(got, expected));
    }
  }

  const subset = await post(base, '/api/core/substat-rolls', {
    rarity: 5,
    keys: ['hp', 'critRate', 'not-a-stat'],
  });
  ok('substat: requested keys only', same(Object.keys(subset.stats).sort(), ['critRate', 'hp']));

  const badRarity = await fetch(base + '/api/core/substat-rolls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rarity":9}',
  });
  ok('substat: invalid rarity is 400', badRarity.status === 400);
  const badJson = await fetch(base + '/api/core/substat-rolls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('substat: invalid JSON is 400', badJson.status === 400);
  const wrongMethod = await fetch(base + '/api/core/substat-rolls');
  ok('substat: unsupported method is 405', wrongMethod.status === 405);
} catch (error) {
  fail += 1;
  console.log('FAIL  ' + String(error?.stack || error));
} finally {
  if (server) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (server.exitCode == null) {
      try { server.kill(); } catch { /* best effort */ }
    }
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
