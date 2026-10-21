// C# artifact summary and optimizer-plan parity.
//
// These are the remaining pure calculations in the artifact domain. The
// service must produce the same totals, set counts, piece shapes, feeding
// stats and structured request as the synchronous JS implementation.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  activeBonuses,
  artifactStatTotals,
  countBySet,
} from '../src/lib/artifact-model.js';
import {
  artifactOptimizeRequest,
  defaultPieces,
  feedingSubstatsFor,
  impliedHits,
  importPieces,
  pieceSpec,
} from '../src/lib/artifact-optimize.js';
import { variablesOf } from '../src/lib/merged-expression.js';

const ROOT = process.cwd();
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
let bad = 0;
const ok = (label) => console.log('ok   ' + label);
const fail = (label, detail) => { console.log('FAIL ' + label + (detail ? ': ' + detail : '')); bad += 1; };
const close = (a, b) => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

const build = {
  flower: {
    setId: 'set-a', mainStat: 'hp', level: 20,
    subStats: [{ key: 'critRate', value: '3.9' }, { key: 'critDmg', value: '7.8' }],
  },
  plume: {
    setId: 'set-a', mainStat: 'atk', level: 20,
    subStats: [{ key: 'atkPct', value: '5.83' }, { key: 'em', value: '23' }],
  },
  sands: {
    setId: 'set-b', mainStat: 'atkPct', level: 16,
    subStats: [{ key: 'critRate', value: '7.0' }, { key: 'critDmg', value: '14.0' }],
  },
  goblet: {
    setId: 'set-b', mainStat: 'pyroDmg', level: 8,
    subStats: [{ key: 'critRate', value: '3.1' }, { key: 'atkPct', value: '4.7' }],
  },
  circlet: {
    setId: 'set-b', mainStat: 'critDmg', level: 20,
    subStats: [{ key: 'critRate', value: '3.9' }, { key: 'atk', value: '19' }],
  },
};

const expr = {
  scalingBases: ['atk'],
  hasAmp: false,
  hasTransformative: false,
  coeffs: {
    never: { 1: 5 },
    crit: { 1: 10, C: 2 },
    avgGroups: [{ crBuff: 20, delta: { 1: 1, C: 1 }, amp: [] }],
    ampNever: [], ampCrit: [], transformative: [],
  },
};

const basePanel = {
  atk: 800, atkPct: 50, flatAtk: 300, hp: 10000, hpPct: 0, flatHp: 0,
  def: 500, defPct: 0, flatDef: 0, critRate: 5, critDmg: 50,
  anemoDmg: 0, pyroDmg: 0, dmgBonus: 0, em: 0,
};
const curPanel = {
  ...basePanel, atkPct: 80, flatAtk: 320, critRate: 40, critDmg: 120,
  em: 40, pyroDmg: 15,
};

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});
const stop = (child) => {
  if (child && process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
};
const post = async (baseUrl, route, body) => {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
};

function firstDiff(a, b, at = '') {
  if (close(a, b)) return null;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    return (at || '$') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return (at || '$') + ': array/object mismatch';
  if (Array.isArray(a)) {
    if (a.length !== b.length) return (at || '$') + ': length ' + a.length + ' != ' + b.length;
    for (let i = 0; i < a.length; i += 1) {
      const d = firstDiff(a[i], b[i], at + '[' + i + ']');
      if (d) return d;
    }
    return null;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!(key in a)) return at + '.' + key + ': missing on JS side';
    if (!(key in b)) return at + '.' + key + ': missing on C# side';
    const d = firstDiff(a[key], b[key], at + '.' + key);
    if (d) return d;
  }
  return null;
}

const samePieces = (left, right) => firstDiff(
  left.map((p) => ({ slot: p.slot, mainStat: p.mainStat ?? null, lines: p.lines, rolls: p.rolls, maxPerLine: p.maxPerLine, allows: p.allows })),
  right.map((p) => ({ slot: p.slot, mainStat: p.mainStat ?? null, lines: p.lines, rolls: p.rolls, maxPerLine: p.maxPerLine, allows: p.allows })),
);

let server;
try {
  if (!fs.existsSync(DLL)) throw new Error('build the API first: npm run build:csharp');
  const port = await freePort();
  const baseUrl = 'http://127.0.0.1:' + port;
  server = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: { ...process.env, GsPlan__Port: String(port) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i += 1) {
    try { const response = await fetch(baseUrl + '/api/health'); if (response.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  /* Summary */
  const jsSummary = {
    totals: artifactStatTotals(build),
    counts: countBySet(build),
    bonuses: activeBonuses(build),
  };
  const summaryResponse = await post(baseUrl, '/api/core/artifact-summary', { build });
  if (!summaryResponse.response.ok) fail('summary: request succeeds', summaryResponse.text);
  else {
    const summary = JSON.parse(summaryResponse.text);
    const diff = firstDiff(jsSummary, summary);
    if (diff) fail('summary: matches JS', diff); else ok('summary: totals, counts and set bonuses match JS');
  }

  const emptySummary = await post(baseUrl, '/api/core/artifact-summary', {});
  if (!emptySummary.response.ok) fail('summary: empty build succeeds', emptySummary.text);
  else if (firstDiff({ totals: {}, counts: {}, bonuses: [] }, JSON.parse(emptySummary.text))) {
    fail('summary: empty build is empty');
  } else ok('summary: empty build is empty');

  // The editor and optimiser keep null substat placeholders. They are an empty
  // slot, not a request error, and the summary must ignore them.
  const strippedBuild = Object.fromEntries(Object.entries(build).map(([slot, piece]) => [
    slot,
    piece ? { ...piece, subStats: (piece.subStats || []).map(() => null) } : piece,
  ]));
  const strippedSummary = await post(baseUrl, '/api/core/artifact-summary', { build: strippedBuild });
  const strippedExpected = {
    totals: artifactStatTotals(strippedBuild),
    counts: countBySet(strippedBuild),
    bonuses: activeBonuses(strippedBuild),
  };
  if (!strippedSummary.response.ok) fail('summary: null substat slots succeed', strippedSummary.text);
  else {
    const diff = firstDiff(strippedExpected, JSON.parse(strippedSummary.text));
    if (diff) fail('summary: null substat slots are ignored', diff);
    else ok('summary: null substat slots are ignored');
  }

  const summaryGet = await fetch(baseUrl + '/api/core/artifact-summary');
  if (summaryGet.status === 405) ok('summary: GET is 405'); else fail('summary: GET is 405', summaryGet.status);

  /* Plan: automatic import */
  const planBody = {
    expr, build, basePanel, currentPanel: curPanel,
    mode: 'auto', upgrades: 5, hitScale: 0.8,
  };
  const planResponse = await post(baseUrl, '/api/optimize/artifact/plan', planBody);
  if (!planResponse.response.ok) fail('plan: request succeeds', planResponse.text);
  else {
    const plan = JSON.parse(planResponse.text);
    const expectedPieces = importPieces(build);
    const pieceDiff = samePieces(expectedPieces, plan.pieces);
    if (pieceDiff) fail('plan: imported pieces match JS', pieceDiff); else ok('plan: imported pieces match JS');

    const expectedFeeding = feedingSubstatsFor(expr);
    if (firstDiff(expectedFeeding, plan.feedingSubstats)) fail('plan: feeding substats match JS', firstDiff(expectedFeeding, plan.feedingSubstats));
    else ok('plan: feeding substats match JS');

    const expectedHits = impliedHits(basePanel, curPanel, expectedFeeding);
    if (!close(expectedHits, plan.impliedHits)) fail('plan: implied hits match JS', expectedHits + ' != ' + plan.impliedHits);
    else ok('plan: implied hits match JS');

    const expVars = variablesOf(curPanel);
    if (firstDiff(expVars, plan.variables)) fail('plan: variables match JS', firstDiff(expVars, plan.variables));
    else ok('plan: variables match JS');

    const expectedRequest = artifactOptimizeRequest({
      expr, panel: basePanel, ref: expVars, pieces: expectedPieces, hitScale: 0.8,
    });
    if (firstDiff(expectedRequest.coeffs, plan.request.coeffs)) fail('plan: coefficients reach the request');
    else ok('plan: coefficients reach the request');
    if (firstDiff(expectedRequest.panel, plan.request.panel)) fail('plan: baseline panel reaches the request', firstDiff(expectedRequest.panel, plan.request.panel));
    else ok('plan: baseline panel reaches the request');
    const protocolRef = {
      A: expVars.A, H: expVars.H, D: expVars.D,
      M: expVars.M, C: expVars.C, R: expVars.R, E: expVars.E,
    };
    if (firstDiff(protocolRef, plan.request.ref)) fail('plan: reference variables reach the request', firstDiff(protocolRef, plan.request.ref));
    else ok('plan: reference variables reach the request');
    if (firstDiff(expectedRequest.pieces, plan.request.pieces)) fail('plan: request pieces match JS', firstDiff(expectedRequest.pieces, plan.request.pieces));
    else ok('plan: request pieces match JS');
  }

  /* Plan: explicit default mode and a custom piece shape */
  const defaultPlanResponse = await post(baseUrl, '/api/optimize/artifact/plan', {
    expr, build, basePanel, currentPanel: curPanel, mode: 'default',
    upgrades: 5, hitScale: 0.8,
  });
  if (!defaultPlanResponse.response.ok) fail('plan: default mode succeeds', defaultPlanResponse.text);
  else {
    const diff = samePieces(defaultPieces(build), JSON.parse(defaultPlanResponse.text).pieces);
    if (diff) fail('plan: default pieces match JS', diff); else ok('plan: default pieces match JS');
  }

  const imported = importPieces(build);
  const custom = imported.map((piece, index) => (index === 0
    ? pieceSpec({
      slotKey: piece.slot,
      mainStat: 'critDmg',
      upgrades: 3,
      allows: [
        { key: 'critRate', state: 2 },
        { key: 'atkPct', state: 0 },
        { key: 'em', state: 1 },
      ],
    })
    : piece));
  const customResponse = await post(baseUrl, '/api/optimize/artifact/plan', {
    expr, build, basePanel, currentPanel: curPanel, pieces: custom,
    mode: 'default', upgrades: 3, hitScale: 0.8,
  });
  if (!customResponse.response.ok) fail('plan: custom pieces succeed', customResponse.text);
  else {
    const diff = samePieces(custom, JSON.parse(customResponse.text).pieces);
    if (diff) fail('plan: custom pieces preserve order and state', diff);
    else ok('plan: custom pieces preserve order and state');
  }

  const missingExpr = await post(baseUrl, '/api/optimize/artifact/plan', { build });
  if (missingExpr.response.status === 400) ok('plan: missing expression is 400');
  else fail('plan: missing expression is 400', missingExpr.response.status);

  const planGet = await fetch(baseUrl + '/api/optimize/artifact/plan');
  if (planGet.status === 405) ok('plan: GET is 405'); else fail('plan: GET is 405', planGet.status);
} catch (error) {
  fail('check crashed', String(error?.stack || error));
} finally {
  stop(server);
}

console.log(bad ? bad + ' PROBLEMS' : 'all checks passed');
process.exit(bad ? 1 : 0);
