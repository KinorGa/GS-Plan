// Compare the C# whole-axis calculator with the JavaScript implementation on a
// real configuration, then exercise formula-valued buffs and custom zones.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { computeAxis } from '../src/lib/axis-compute.js';
import { activeArtifacts } from '../src/lib/artifact-sets.js';
import { axisRequest } from '../src/lib/axis-request.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));

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
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-10;
};

const compareEntry = (name, expected, actual) => {
  const bad = [];
  for (const key of ['perHit', 'total', 'hits']) {
    if (!nearlyEqual(expected[key], actual?.[key])) {
      bad.push(`${key}: ${expected[key]} != ${actual?.[key]}`);
    }
  }
  if (Boolean(expected.loop) !== Boolean(actual?.loop)) bad.push('loop differs');
  if (expected.parts?.length || actual?.parts?.length) {
    if (expected.parts?.length !== actual?.parts?.length) {
      bad.push(`parts: ${expected.parts?.length} != ${actual?.parts?.length}`);
    } else {
      expected.parts.forEach((part, index) => {
        const other = actual.parts[index];
        for (const key of ['partIndex', 'element', 'perHit', 'total', 'hits', 'mult', 'scalingBasis']) {
          const same = typeof part[key] === 'number'
            ? nearlyEqual(part[key], other?.[key])
            : part[key] === other?.[key];
          if (!same) bad.push(`part[${index}].${key}: ${part[key]} != ${other?.[key]}`);
        }
      });
    }
  }
  if (expected.children?.length || actual?.children?.length) {
    if (expected.children?.length !== actual?.children?.length) {
      bad.push(`children: ${expected.children?.length} != ${actual?.children?.length}`);
    } else {
      expected.children.forEach((child, index) => {
        const nested = [];
        for (const key of ['perHit', 'total', 'hits']) {
          if (!nearlyEqual(child[key], actual.children[index]?.[key])) nested.push(key);
        }
        if (nested.length) bad.push(`child[${index}].${nested.join(',')}`);
      });
    }
  }
  ok(name, bad.length === 0, bad.slice(0, 6).join('; '));
};

const config = read('data/lunaris-config-2026-10-07.json');
const charlist = read('public/data/charlist.json');
const weapons = read('public/data/weaponlist.json');
const stats = read('public/data/stats-compact.json');
const talentDamage = read('public/data/talent-damage.json');
const details = {};
for (const unit of config.team.units) {
  const id = unit.char?.id;
  if (!id || details[id] !== undefined) continue;
  const file = path.join(ROOT, 'public', 'data', 'char', 'chs', `${id}.json`);
  details[id] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

const team = config.team.units.map((unit) => {
  const id = unit.char?.id;
  return {
    id,
    unitId: unit.id,
    element: charlist[id]?.element,
    qualityType: charlist[id]?.qualityType,
    level: unit.char?.level ?? 90,
    constellation: unit.char?.constellation ?? 0,
    refine: unit.weapon?.refine ?? 1,
    talents: unit.char?.talents || null,
    weaponId: unit.weapon?.id ?? null,
    artifacts: activeArtifacts(unit),
    detail: details[id] || null,
  };
});

const entries = structuredClone(config.axes[0].entries);
const base = entries.find((entry) => !entry.children?.length && entry.charId !== 'none');
entries.push({
  id: 'csharp-axis-formula',
  charId: base.charId,
  summary: { sourceKey: 'elementalskill', stageIndex: 0, partIndex: 0, element: base.summary?.element },
  picked: { sourceKey: 'elementalskill', stageIndex: 0 },
  statOverrides: { enemyLevel: 90 },
  critMode: 'avg',
  reactionKey: 'vaporize',
  drops: [{
    source: { owner: { id: base.charId } },
    buffs: [
      { key: 'critDmg', value: '=$总攻击力*0.01' },
      { key: 'dmgBonus', value: '20' },
      { key: 'aPower', value: '1.5' },
      { key: 'multZone', value: '2' },
      { key: '潮涌', value: '10' },
      { key: 'speed', value: '99' },
    ],
  }],
  children: undefined,
});

const catalogue = { chars: charlist, weapons, stats };
const expected = computeAxis(entries, team, catalogue, talentDamage);
const request = axisRequest(entries, team, 'chs');

let server;
try {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  server = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: { ...process.env, GsPlan__Port: String(port) },
    stdio: 'ignore',
  });
  await waitFor(baseUrl + '/api/health');

  const meta = await fetch(baseUrl + '/api/core/meta').then((response) => response.json());
  ok('axis: meta advertises the route', meta.service === 'gs-plan-core' && meta.axis === true);

  const actual = await post(baseUrl, '/api/core/axis', request);
  ok('axis: total matches JS', nearlyEqual(expected.total, actual.total),
    `${expected.total} != ${actual.total}`);
  ok('axis: per-hit total matches JS', nearlyEqual(expected.perHit, actual.perHit),
    `${expected.perHit} != ${actual.perHit}`);
  ok('axis: computed count matches JS', expected.computed === actual.computed,
    `${expected.computed} != ${actual.computed}`);
  ok('axis: entry count matches JS', expected.entries === actual.entries);

  const expectedIds = [...expected.byId.keys()].sort();
  const actualIds = Object.keys(actual.byId || {}).sort();
  ok('axis: byId keys match JS', JSON.stringify(expectedIds) === JSON.stringify(actualIds),
    `${expectedIds.length} != ${actualIds.length}`);

  for (const id of expectedIds) {
    compareEntry(`axis: ${id}`, expected.byId.get(id), actual.byId?.[id]);
  }

  const badJson = await fetch(baseUrl + '/api/core/axis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('axis: invalid JSON is 400', badJson.status === 400);
  const wrongMethod = await fetch(baseUrl + '/api/core/axis');
  ok('axis: unsupported method is 405', wrongMethod.status === 405);
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
