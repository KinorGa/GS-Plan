// Compare GsPlan.Core with the JavaScript formula it was ported from. The
// endpoint is deliberately test-facing in this phase: the UI still calls JS, so
// this check is what prevents the two implementations from drifting.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { computeDamage } from '../src/lib/damage.js';
import { derivePanel } from '../src/lib/stat-derive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
const statsCompact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'stats-compact.json'), 'utf8'));

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

const nearlyEqual = (a, b) => {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-11;
};

const sameValue = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return nearlyEqual(a, b);
  return JSON.stringify(a) === JSON.stringify(b);
};

const compareDamage = (name, expected, actual) => {
  const bad = Object.entries(expected)
    .filter(([key, value]) => !sameValue(value, actual[key]))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)} != ${JSON.stringify(actual[key])}`);
  ok(name, bad.length === 0, bad.slice(0, 5).join('; '));
};

const comparePanel = (name, expected, actual) => {
  const bad = Object.entries(expected.values)
    .filter(([key, value]) => !sameValue(value, actual.values?.[key]))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)} != ${JSON.stringify(actual.values?.[key])}`);
  if (!sameValue(expected.notes, actual.notes)) bad.push('notes differ');
  if (expected.precise !== actual.precise) bad.push(`precise: ${expected.precise} != ${actual.precise}`);
  if (expected.base === null || actual.base === null) {
    if (expected.base !== actual.base) bad.push('base presence differs');
  } else {
    for (const key of ['level', 'hp', 'atk', 'def', 'ascensionName', 'ascensionValue', 'extras']) {
      if (!sameValue(expected.base[key], actual.base[key])) bad.push(`base.${key} differs`);
    }
  }
  ok(name, bad.length === 0, bad.slice(0, 6).join('; '));
};

const baseStats = {
  hp: 13061,
  atk: 392 + 608,
  def: 824,
  hpPct: 46.6,
  atkPct: 46.6,
  defPct: 0,
  flatHp: 4780,
  flatAtk: 311,
  flatDef: 0,
  em: 186.5,
  critRate: 72.4,
  critDmg: 168.3,
  er: 118.5,
  dmgBonus: 15,
  physBonus: 0,
  pyroDmg: 0,
  hydroDmg: 0,
  cryoDmg: 0,
  electroDmg: 0,
  anemoDmg: 46.6,
  geoDmg: 0,
  dendroDmg: 0,
  reactionBonus: 40,
  defShred: 30,
  defIgnore: 10,
  enemyLevel: 100,
  talentBonus: 13.5,
  flatDmg: 1200,
  resShred: 20,
  resShredPyro: 0,
  resShredHydro: 0,
  resShredCryo: 0,
  resShredElectro: 0,
  resShredAnemo: 15,
  resShredGeo: 0,
  resShredDendro: 0,
  resShredPhysical: 0,
  enemyResPyro: 10,
  enemyResHydro: 10,
  enemyResCryo: 10,
  enemyResElectro: 10,
  enemyResAnemo: 10,
  enemyResGeo: 10,
  enemyResDendro: 10,
  enemyResPhysical: 0,
};

const artifacts = {
  flower: {
    mainStat: 'hp', level: 20,
    subStats: [
      { key: 'atkPct', value: '10.5' }, { key: 'em', value: '23' },
      { key: 'critDmg', value: '25.6' }, { key: 'atk', value: '33' },
    ],
  },
  plume: {
    mainStat: 'atk', level: 20,
    subStats: [
      { key: 'atkPct', value: '16.3' }, { key: 'critRate', value: '6.6' },
      { key: 'critDmg', value: '21' }, { key: 'er', value: '6.5' },
    ],
  },
  sands: {
    mainStat: 'atkPct', level: 20,
    subStats: [
      { key: 'critRate', value: '10.1' }, { key: 'critDmg', value: '19.4' },
      { key: 'em', value: '42' }, { key: 'def', value: 19 },
    ],
  },
  goblet: {
    mainStat: 'anemoDmg', level: 20,
    subStats: [
      { key: 'defPct', value: '10.9' }, { key: 'critRate', value: '6.6' },
      { key: 'em', value: '21' }, { key: 'critDmg', value: '21' },
    ],
  },
  circlet: {
    mainStat: 'critDmg', level: 20,
    subStats: [
      { key: 'atkPct', value: '8.7' }, { key: 'critRate', value: '16.3' },
      { key: 'atk', value: '14' }, { key: 'em', value: '16' },
    ],
  },
};

const fallbackDetail = {
  info: {
    attributes: [
      { level: 1, ascension: 0, hp: 1000, atk: 20, def: 60, 'CRIT DMG%': '0' },
      {
        level: 90, ascension: 6, hp: 12000, atk: 350, def: 800,
        'CRIT DMG%': '38.4', 'Elemental Mastery': '100',
      },
    ],
  },
};

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
  ok('core meta identifies the service', meta.ok === true && meta.service === 'gs-plan-core');
  ok('core meta advertises batch routes', meta.batchDamage === true && meta.batchDerivePanel === true);

  const damageCases = [
    {
      name: 'damage: amplifying average',
      stats: { ...baseStats },
      options: {
        stage: { mult: 2.1, hits: 3, bonus: 0.1 },
        reaction: { amp: true, base: 1.5 },
        element: 'Anemo', critMode: 'avg', atkLevel: 95,
        zoneMult: 1.3, multZone: 1.15, basis: 'atk',
      },
    },
    {
      name: 'damage: guaranteed crit',
      stats: { ...baseStats, critRate: 112, critDmg: 280 },
      options: {
        stage: { mult: 1.8, hits: 2 },
        reaction: { amp: false, base: 1 },
        element: 'Anemo', critMode: 'crit', atkLevel: 90,
      },
    },
    {
      name: 'damage: average caps crit rate at 100',
      stats: { ...baseStats, critRate: 112, critDmg: 280 },
      options: {
        stage: { mult: 1.8, hits: 2 },
        reaction: { amp: false, base: 1 },
        element: 'Anemo', critMode: 'avg', atkLevel: 90,
      },
    },
    {
      name: 'damage: never crit',
      stats: { ...baseStats, critRate: 112, critDmg: 280 },
      options: {
        stage: { mult: 1.8, hits: 2 },
        reaction: { amp: false, base: 1 },
        element: 'Anemo', critMode: 'never', atkLevel: 90,
      },
    },
    {
      name: 'damage: swirl transformative hit',
      stats: { ...baseStats },
      options: {
        stage: { mult: 1.2, hits: 4, bonus: 0.2 },
        reaction: {
          transformative: true, coefficient: 0.6, key: 'swirl',
          pair: ['Pyro', 'Hydro'],
        },
        element: 'Anemo', critMode: 'avg', atkLevel: 90,
      },
    },
    {
      name: 'damage: overload defence zone is ignored',
      stats: { ...baseStats },
      options: {
        stage: { mult: 1.2, hits: 1 },
        reaction: { transformative: true, coefficient: 2.75, key: 'overload' },
        element: 'Pyro', critMode: 'crit', atkLevel: 90,
      },
    },
    {
      name: 'damage: physical explicit zero resistance',
      stats: { ...baseStats, physBonus: 58.3, enemyResPhysical: 0 },
      options: {
        stage: { mult: 1.4, hits: 2 },
        reaction: { amp: false, base: 1 },
        element: 'Physical', critMode: 'avg', atkLevel: 90,
      },
    },
    {
      name: 'damage: absent resistance uses standard 10%',
      stats: (() => {
        const value = { ...baseStats };
        delete value.enemyResAnemo;
        return value;
      })(),
      options: {
        stage: { mult: 1.4, hits: 1 },
        reaction: { amp: false, base: 1 },
        element: 'Anemo', critMode: 'avg', atkLevel: 90,
      },
    },
  ];

  for (const basis of ['hp', 'def', 'em']) {
    damageCases.push({
      name: `damage: ${basis} scaling basis`,
      stats: { ...baseStats },
      options: {
        stage: { mult: 0.14, hits: 3, bonus: 0.05 },
        reaction: { amp: false, base: 1 },
        element: 'Anemo', critMode: 'avg', atkLevel: 90,
        basis,
      },
    });
  }

  const damageRequests = [];
  const damageExpected = [];
  for (const item of damageCases) {
    const expected = computeDamage(item.stats, item.options);
    const request = {
      stats: item.stats,
      ...item.options,
    };
    const actual = await post(base, '/api/core/damage', request);
    compareDamage(item.name, expected, actual);
    damageRequests.push(request);
    damageExpected.push(expected);
  }

  const damageBatch = await post(base, '/api/core/damage-batch', { requests: damageRequests });
  ok('damage batch returns every result in order', damageBatch.results?.length === damageRequests.length);
  damageExpected.forEach((expected, index) => {
    compareDamage(`damage batch: ${damageCases[index].name.replace(/^damage: /, '')}`,
      expected, damageBatch.results[index]);
  });

  const preciseInput = {
    charId: '10000128', detail: null, level: 95, element: 'Anemo',
    weaponId: '12515', weapon: null, artifacts, useStats: true,
  };
  const preciseExpected = derivePanel({ ...preciseInput, stats: statsCompact });
  const preciseActual = await post(base, '/api/core/derive-panel', preciseInput);
  comparePanel('panel: compact factors + weapon + artifacts', preciseExpected, preciseActual);

  // The optimizer strips substats by leaving null PLACEHOLDERS, not by deleting
  // the list. A null slot must contribute nothing, exactly like the JS loop.
  const strippedInput = {
    ...preciseInput,
    artifacts: {
      ...artifacts,
      flower: { ...artifacts.flower, subStats: [null, null, null, null] },
    },
  };
  const strippedExpected = derivePanel({ ...strippedInput, stats: statsCompact });
  const strippedActual = await post(base, '/api/core/derive-panel', strippedInput);
  comparePanel('panel: null substat slots are ignored', strippedExpected, strippedActual);

  const fallbackInput = {
    charId: 'fallback-character', detail: fallbackDetail, level: 95, element: 'Anemo',
    weaponId: 'fallback-weapon',
    weapon: { ascensionStats: { atk: 454, 'CRIT Rate%': '12.3' } },
    artifacts: {
      flower: {
        mainStat: 'hp', level: 20,
        subStats: [{ key: 'critDmg', value: '31.1' }, { key: 'unknownStat', value: '99' }],
      },
    },
    useStats: false,
  };
  const fallbackExpected = derivePanel({ ...fallbackInput, stats: null });
  const fallbackActual = await post(base, '/api/core/derive-panel', fallbackInput);
  comparePanel('panel: rounded detail fallback + weapon fallback', fallbackExpected, fallbackActual);

  const missingInput = {
    charId: 'missing-character', detail: null, level: 90, element: 'Cryo',
    weaponId: null, weapon: null, artifacts: {}, useStats: true,
  };
  const missingExpected = derivePanel({ ...missingInput, stats: statsCompact });
  const missingActual = await post(base, '/api/core/derive-panel', missingInput);
  comparePanel('panel: missing stat table reports no-stat-table', missingExpected, missingActual);

  const panelRequests = [preciseInput, fallbackInput, missingInput];
  const panelExpected = [preciseExpected, fallbackExpected, missingExpected];
  const panelBatch = await post(base, '/api/core/derive-panel-batch', { requests: panelRequests });
  ok('panel batch returns every result in order', panelBatch.results?.length === panelRequests.length);
  panelExpected.forEach((expected, index) => {
    comparePanel(`panel batch: request ${index + 1}`, expected, panelBatch.results[index]);
  });

  const badDamage = await fetch(base + '/api/core/damage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('damage: invalid JSON is 400', badDamage.status === 400);
  const missingStats = await fetch(base + '/api/core/damage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  ok('damage: missing stats is 400', missingStats.status === 400);
  const wrongMethod = await fetch(base + '/api/core/derive-panel');
  ok('core endpoint: unsupported method is 405', wrongMethod.status === 405);
  const badBatch = await fetch(base + '/api/core/damage-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"requests":[{}]}',
  });
  ok('damage batch: missing stats is 400', badBatch.status === 400);
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
