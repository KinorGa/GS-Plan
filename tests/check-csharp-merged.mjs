// Compare the C# merged artifact polynomial with the JavaScript implementation
// on a real axis, then on a mixed case with amplifying/transformative reactions,
// alternative scaling stats, formulas and a rotation segment.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  damageAt, evaluate, evaluateAmp, mergedExpression, variablesOf,
} from '../src/lib/merged-expression.js';
import { activeArtifacts } from '../src/lib/artifact-sets.js';
import { mergedExpressionRequest } from '../src/lib/axis-request.js';

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

const compareDict = (name, expected, actual) => {
  const left = expected || {};
  const right = actual || {};
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
    ok(name, false, `keys ${leftKeys.length} != ${rightKeys.length}`);
    return;
  }
  const bad = leftKeys.filter((key) => !nearlyEqual(left[key], right[key]));
  ok(name, bad.length === 0, bad.slice(0, 5).map((key) => `${key}: ${left[key]} != ${right[key]}`).join('; '));
};

const compareAmpGroups = (name, expected, actual) => {
  if ((expected?.length || 0) !== (actual?.length || 0)) {
    ok(name, false, `${expected?.length || 0} != ${actual?.length || 0}`);
    return;
  }
  (expected || []).forEach((group, index) => {
    const other = actual?.[index] || {};
    ok(
      `${name}[${index}] buffs`,
      nearlyEqual(group.emBuff, other.emBuff) && nearlyEqual(group.bonus, other.bonus)
    );
    compareDict(`${name}[${index}].coeffs`, group.coeffs, other.coeffs);
  });
};

const compareExpression = (name, expected, actual) => {
  if (!expected || !actual) {
    ok(name + ': present', false, `${Boolean(expected)} != ${Boolean(actual)}`);
    return;
  }
  ok(name + ': identity', expected.charId === actual.charId);
  ok(name + ': entries/parts', expected.entries === actual.entries && expected.parts === actual.parts,
    `${expected.entries}/${expected.parts} != ${actual.entries}/${actual.parts}`);
  ok(name + ': scaling bases', JSON.stringify(expected.scalingBases) === JSON.stringify(actual.scalingBases),
    JSON.stringify(actual.scalingBases));
  compareDict(name + ': base', expected.base, actual.base);
  compareDict(name + ': variables', expected.variables, actual.variables);
  compareDict(name + ': never', expected.coeffs.never, actual.coeffs.never);
  compareDict(name + ': crit', expected.coeffs.crit, actual.coeffs.crit);
  compareAmpGroups(name + ': amp never', expected.coeffs.ampNever, actual.coeffs.ampNever);
  compareAmpGroups(name + ': amp crit', expected.coeffs.ampCrit, actual.coeffs.ampCrit);

  const expAvg = expected.coeffs.avgGroups || [];
  const actAvg = actual.coeffs.avgGroups || [];
  ok(name + ': average groups', expAvg.length === actAvg.length, `${expAvg.length} != ${actAvg.length}`);
  expAvg.forEach((group, index) => {
    const other = actAvg[index] || {};
    ok(name + `: average [${index}] crit rate`, nearlyEqual(group.crBuff, other.crBuff),
      `${group.crBuff} != ${other.crBuff}`);
    compareDict(name + `: average [${index}] delta`, group.delta, other.delta);
    compareAmpGroups(name + `: average [${index}] amp`, group.amp, other.amp);
  });

  const expRx = expected.coeffs.transformative || [];
  const actRx = actual.coeffs.transformative || [];
  ok(name + ': transformative groups', expRx.length === actRx.length, `${expRx.length} != ${actRx.length}`);
  expRx.forEach((group, index) => {
    const other = actRx[index] || {};
    ok(
      name + `: transformative [${index}]`,
      nearlyEqual(group.emBuff, other.emBuff)
        && nearlyEqual(group.constant, other.constant)
        && nearlyEqual(group.em, other.em)
    );
  });
  ok(name + ': flags',
    expected.hasAmp === actual.hasAmp
      && expected.hasTransformative === actual.hasTransformative
      && expected.setSensitive === actual.setSensitive);
  ok(name + ': warnings',
    JSON.stringify((expected.warnings || []).map((w) => [w.code, (w.keys || []).slice().sort()]))
      === JSON.stringify((actual.warnings || []).map((w) => [w.code, (w.keys || []).slice().sort()])));
};

const evaluateInJs = (expr, panel) => {
  const variables = variablesOf(panel);
  const at = damageAt(expr, variables);
  const rate = variables.R;
  return {
    variables,
    never: at.never,
    crit: at.crit,
    avg: at.avg,
    groups: expr.coeffs.avgGroups.map((group) => {
      const mu = Math.min(rate + group.crBuff, 100) / 100;
      const delta = evaluate(group.delta, variables);
      const amp = evaluateAmp(group.amp, variables);
      const df = delta + amp;
      return { crBuff: group.crBuff, mu, delta, amp, df, contrib: mu * df };
    }),
  };
};

const compareEvaluation = (name, expected, actual) => {
  compareDict(name + ': variables', expected.variables, actual?.variables);
  ok(name + ': totals',
    nearlyEqual(expected.never, actual?.never)
      && nearlyEqual(expected.crit, actual?.crit)
      && nearlyEqual(expected.avg, actual?.avg),
    `${expected.never}/${expected.crit}/${expected.avg} != ${actual?.never}/${actual?.crit}/${actual?.avg}`);
  ok(name + ': group count',
    expected.groups.length === (actual?.groups?.length || 0),
    `${expected.groups.length} != ${actual?.groups?.length || 0}`);
  expected.groups.forEach((group, index) => {
    const other = actual?.groups?.[index] || {};
    ok(`${name}: group ${index}`,
      nearlyEqual(group.crBuff, other.crBuff)
        && nearlyEqual(group.mu, other.mu)
        && nearlyEqual(group.delta, other.delta)
        && nearlyEqual(group.amp, other.amp)
        && nearlyEqual(group.df, other.df)
        && nearlyEqual(group.contrib, other.contrib),
      JSON.stringify(group) + ' != ' + JSON.stringify(other));
  });
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

const catalogue = { chars: charlist, weapons, stats };
const charId = '10000128';
const baseEntries = structuredClone(config.axes[0].entries);
const base = baseEntries.find((entry) => !entry.children?.length && entry.charId === charId);

const mixedEntries = structuredClone(baseEntries);
mixedEntries.push(
  {
    ...structuredClone(base),
    id: 'merged-amp',
    element: 'Pyro',
    reactionKey: 'vaporize',
    critMode: 'avg',
  },
  {
    ...structuredClone(base),
    id: 'merged-rx',
    element: 'Pyro',
    reactionKey: 'overloaded',
    critMode: 'crit',
  },
  {
    ...structuredClone(base),
    id: 'merged-hp',
    scalingBasis: 'hp',
  },
  {
    ...structuredClone(base),
    id: 'merged-def',
    scalingBasis: 'def',
  },
  {
    ...structuredClone(base),
    id: 'merged-em',
    scalingBasis: 'em',
    drops: [{
      source: { owner: { id: charId } },
      buffs: [
        { key: 'critDmg', value: '=$总攻击力*0.01' },
        { key: 'dmgBonus', value: '20' },
        { key: 'aPower', value: '1.5' },
        { key: 'multZone', value: '2' },
        { key: '潮涌', value: '10' },
      ],
    }],
  },
  {
    id: 'merged-loop',
    kind: 'segment',
    children: [
      { ...structuredClone(base), id: 'merged-loop-a' },
      { ...structuredClone(base), id: 'merged-loop-b', statOverrides: { critRate: 73 } },
    ],
  }
);

const cases = [
  { name: 'merged: real axis', entries: baseEntries },
  { name: 'merged: mixed rows', entries: mixedEntries },
];

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
  ok('merged: meta advertises the routes',
    meta.service === 'gs-plan-core' && meta.mergedExpression === true && meta.mergedEvaluation === true);

  for (const item of cases) {
    const expected = mergedExpression({
      entries: item.entries,
      team,
      catalogue,
      talentDamage,
      charId,
    });
    const actual = await post(
      baseUrl,
      '/api/core/merged-expression',
      mergedExpressionRequest(item.entries, team, charId, 'chs')
    );
    compareExpression(item.name, expected, actual);

    const panels = [
      ['base', actual.base],
      ['shifted panel', {
        ...actual.base,
        atkPct: actual.base.atkPct + 38,
        flatAtk: actual.base.flatAtk + 120,
        hpPct: (actual.base.hpPct || 0) + 20,
        defPct: (actual.base.defPct || 0) + 15,
        critRate: Math.min(100, actual.base.critRate + 23),
        critDmg: actual.base.critDmg + 44,
        dmgBonus: actual.base.dmgBonus + 18,
        em: (actual.base.em || 0) + 160,
      }],
    ];
    for (const [label, panel] of panels) {
      const jsEvaluation = evaluateInJs(actual, panel);
      const csEvaluation = await post(
        baseUrl,
        '/api/core/merged-evaluate',
        { expr: actual, panel }
      );
      compareEvaluation(item.name + ': ' + label, jsEvaluation, csEvaluation);
    }
  }

  const missingExpr = await fetch(baseUrl + '/api/core/merged-evaluate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  ok('merged evaluation: missing expr is 400', missingExpr.status === 400);
  const badEvalJson = await fetch(baseUrl + '/api/core/merged-evaluate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('merged evaluation: invalid JSON is 400', badEvalJson.status === 400);
  const wrongEvalMethod = await fetch(baseUrl + '/api/core/merged-evaluate');
  ok('merged evaluation: unsupported method is 405', wrongEvalMethod.status === 405);

  const badJson = await fetch(baseUrl + '/api/core/merged-expression', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('merged: invalid JSON is 400', badJson.status === 400);
  const missing = await fetch(baseUrl + '/api/core/merged-expression', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  ok('merged: missing charId is 400', missing.status === 400);
  const wrongMethod = await fetch(baseUrl + '/api/core/merged-expression');
  ok('merged: unsupported method is 405', wrongMethod.status === 405);
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
