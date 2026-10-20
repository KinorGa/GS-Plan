// The C# artifact optimizer protocol, checked against the JS implementation.
//
// Two boundaries matter here:
//   - the problem text must be byte-identical, because it is the contract with
//     the unchanged C++ binary;
//   - the CSV parser must produce the same named rows the UI already consumes.
// The structured run is checked end-to-end when the binary is present.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  artifactOptimizeRequest, buildProblem, defaultPieces, parseResult, pieceSpec,
  stripSubstats,
} from '../src/lib/artifact-optimize.js';
import { mergedExpression, panelOf, variablesOf } from '../src/lib/merged-expression.js';
import { activeArtifacts } from '../src/lib/artifact-sets.js';

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
      last = 'HTTP ' + response.status;
    } catch (error) {
      last = String(error?.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('timed out waiting for ' + url + ': ' + last);
};

const post = async (base, pathname, value) => {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const text = await response.text();
  return { response, text };
};

const postJson = async (base, pathname, value) => {
  const result = await post(base, pathname, value);
  if (!result.response.ok) {
    throw new Error(pathname + ': HTTP ' + result.response.status + ' ' + result.text);
  }
  return JSON.parse(result.text);
};

const firstDifference = (left, right) => {
  const a = String(left).split('\n');
  const b = String(right).split('\n');
  const count = Math.max(a.length, b.length);
  for (let index = 0; index < count; index += 1) {
    if (a[index] !== b[index]) {
      return 'line ' + (index + 1) + ': ' + JSON.stringify(a[index]) + ' != ' + JSON.stringify(b[index]);
    }
  }
  return '';
};

const sameHits = (left, right) => {
  const a = left || {};
  const b = right || {};
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return JSON.stringify(ak) === JSON.stringify(bk) && ak.every((key) => a[key] === b[key]);
};

const sameRow = (left, right) => (
  sameHits(left.hits, right.hits)
  && left.hasHits === right.hasHits
  && left.total === right.total
  && left.A === right.A
  && left.H === right.H
  && left.D === right.D
  && left.M === right.M
  && left.C === right.C
  && left.R === right.R
  && left.E === right.E
  && left.never === right.never
  && left.crit === right.crit
  && left.avg === right.avg
  && left.isCurrent === right.isCurrent
);

const expr = {
  coeffs: {
    never: { 1: 5 },
    crit: { 1: 10, C: 2 },
    avgGroups: [{ crBuff: 20, delta: { 1: 1, C: 1 } }],
  },
};
const panel = {
  atk: 800, atkPct: 50, flatAtk: 300, critRate: 5, critDmg: 50,
  anemoDmg: 0, pyroDmg: 0, dmgBonus: 0,
};
const pieces = [
  pieceSpec({ slotKey: 'flower', mainStat: 'hp', upgrades: 5 }),
  pieceSpec({
    slotKey: 'plume', mainStat: 'atk', upgrades: 4, lines: 4, maxPerLine: 6,
    allows: [
      { key: 'atkPct', state: 2 }, { key: 'critRate', state: 1 },
      { key: 'critDmg', state: 0 }, { key: 'em', state: 1 }, { key: 'hp', state: 1 },
    ],
  }),
];
const ref = { A: 1500, C: 200, R: 60 };
const request = artifactOptimizeRequest({
  expr, panel, ref, pieces, hitScale: 0.85,
});
const jsProblem = buildProblem({
  expr, panel, ref, pieces, hitScale: 0.85,
});

const csv = [
  'critRate,critDmg,total,A,C,R,E,dmg_never,dmg_crit,dmg_avg,is_current',
  '3,1,4,1234.5,150.25,41.5,120,100,200,180.5,0',
  ',,,1700,120,40,200,1000,2000,1800,1',
].join('\n');

let server;
try {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: { ...process.env, GsPlan__Port: String(port) },
    stdio: 'ignore',
  });
  await waitFor(base + '/api/health');

  const meta = await fetch(base + '/api/core/meta').then((response) => response.json());
  ok('optimize: meta advertises the structured route', meta.artifactOptimize === true);

  const problemResult = await post(base, '/api/optimize/artifact/problem', request);
  ok('problem: response is text', problemResult.response.status === 200
    && (problemResult.response.headers.get('content-type') || '').includes('text/plain'));
  ok('problem: byte-identical to the JS builder', problemResult.text === jsProblem,
    firstDifference(problemResult.text, jsProblem));

  const parsed = await postJson(base, '/api/optimize/artifact/parse', { csv });
  const jsParsed = parseResult(csv);
  ok('parse: stat header matches', JSON.stringify(parsed.stats) === JSON.stringify(jsParsed.stats));
  ok('parse: row count matches', parsed.rows.length === jsParsed.rows.length);
  ok('parse: every row matches', parsed.rows.every((row, index) => sameRow(jsParsed.rows[index], row)));

  const legacyCsv = [
    'critRate,critDmg,A,C,R,dmg_never,dmg_crit,dmg_avg,is_current',
    '2,1,100,50,5,1,2,1.5,0',
  ].join('\n');
  const legacy = await postJson(base, '/api/optimize/artifact/parse', { csv: legacyCsv });
  const jsLegacy = parseResult(legacyCsv);
  ok('parse: a header without total still reads',
    legacy.stats.join(',') === jsLegacy.stats.join(',') && legacy.rows[0].total === 3);
  ok('parse: a header without EM still reads', legacy.rows[0].E === 0);

  // Real expression: this is the case that catches a coefficient vector whose
  // monomial order or number formatting drifted from the browser's builder.
  const config = read('data/lunaris-config-2026-10-07.json');
  const charlist = read('public/data/charlist.json');
  const weapons = read('public/data/weaponlist.json');
  const stats = read('public/data/stats-compact.json');
  const talentDamage = read('public/data/talent-damage.json');
  const details = {};
  for (const unit of config.team.units) {
    const id = unit.char?.id;
    if (!id || details[id] !== undefined) continue;
    const file = path.join(ROOT, 'public', 'data', 'char', 'chs', id + '.json');
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
  const unit = config.team.units.find((item) => item.char?.id === charId);
  const build = activeArtifacts(unit);
  const entries = structuredClone(config.axes[0].entries);
  const realExpr = mergedExpression({
    entries, team, catalogue, talentDamage, charId,
  });
  const basePanel = panelOf(team, catalogue, charId, stripSubstats(build));
  const curPanel = panelOf(team, catalogue, charId);
  const realPieces = defaultPieces(build);
  const realRef = variablesOf(curPanel);
  const realRequest = artifactOptimizeRequest({
    expr: realExpr, panel: basePanel, ref: realRef, pieces: realPieces, hitScale: 0.8,
  });
  const realJsProblem = buildProblem({
    expr: realExpr, panel: basePanel, ref: realRef, pieces: realPieces, hitScale: 0.8,
  });
  const realProblem = await post(base, '/api/optimize/artifact/problem', realRequest);
  ok('problem: real merged expression is byte-identical',
    realProblem.text === realJsProblem,
    firstDifference(realProblem.text, realJsProblem));

  const EXE = path.join(ROOT, 'native', 'optimize', 'optimize.exe');
  if (fs.existsSync(EXE)) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsplan-optimize-test-'));
    try {
      const file = path.join(temp, 'problem.txt');
      fs.writeFileSync(file, jsProblem, 'utf8');
      const expected = parseResult(execFileSync(EXE, [file], { encoding: 'utf8' }));
      const actual = await postJson(base, '/api/optimize/artifact', request);
      ok('run: problem is returned unchanged', actual.problem === jsProblem);
      ok('run: stat header matches', JSON.stringify(actual.stats) === JSON.stringify(expected.stats));
      ok('run: row count matches', actual.rows.length === expected.rows.length);
      ok('run: every row matches',
        actual.rows.length === expected.rows.length
          && actual.rows.every((row, index) => sameRow(expected.rows[index], row)));
      ok('run: elapsed time is reported', Number.isFinite(actual.elapsedMs) && actual.elapsedMs >= 0);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } else {
    console.log('SKIP  run: native/optimize/optimize.exe is not built');
  }

  const missingPieces = await post(base, '/api/optimize/artifact/problem', {
    coeffs: expr.coeffs,
    panel,
    pieces: [],
  });
  ok('problem: empty piece list is 400', missingPieces.response.status === 400);

  const missingCsv = await post(base, '/api/optimize/artifact/parse', {});
  ok('parse: missing csv is 400', missingCsv.response.status === 400);

  const badHeader = await post(base, '/api/optimize/artifact/parse', { csv: 'nope\n1' });
  ok('parse: bad header is 400', badHeader.response.status === 400);

  const wrongMethod = await fetch(base + '/api/optimize/artifact');
  ok('optimize: unsupported method is 405', wrongMethod.status === 405);
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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
