// Compare the C# service with the current Node server on the routes the page
// actually uses. The C# DLL is a build output, so the test runner skips this
// check until `dotnet build server/GsPlan.Api/GsPlan.Api.csproj` has run.
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

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
      if (response.ok) return true;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = String(error?.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
};

const request = async (base, pathname, init) => {
  const response = await fetch(base + pathname, { cache: 'no-store', ...init });
  const text = await response.text();
  return { response, text };
};

const children = [];
const stop = (child) => {
  if (!child || child.exitCode != null) return;
  try { child.kill(); } catch { /* best effort */ }
};

let nodeServer;
let csharpServer;

try {
  const [nodePort, csharpPort] = await Promise.all([freePort(), freePort()]);
  const nodeBase = `http://127.0.0.1:${nodePort}`;
  const csharpBase = `http://127.0.0.1:${csharpPort}`;

  nodeServer = spawn(process.execPath, ['serve.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(nodePort) },
    stdio: 'ignore',
  });
  children.push(nodeServer);

  csharpServer = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: {
      ...process.env,
      GsPlan__Port: String(csharpPort),
      GsPlan__DataFile: path.join(ROOT, 'data', 'config', 'buff-library.json'),
    },
    stdio: 'ignore',
  });
  children.push(csharpServer);

  await Promise.all([
    waitFor(nodeBase + '/api/data'),
    waitFor(csharpBase + '/api/health'),
  ]);

  const nodeData = await request(nodeBase, '/api/data');
  const csharpData = await request(csharpBase, '/api/data');
  ok('GET /api/data matches Node', nodeData.response.status === csharpData.response.status && nodeData.text === csharpData.text);

  const nodeVision = await request(nodeBase, '/api/vision?keyEnv=USTC_API_KEY');
  const csharpVision = await request(csharpBase, '/api/vision?keyEnv=USTC_API_KEY');
  ok('GET /api/vision matches Node', nodeVision.response.status === csharpVision.response.status && nodeVision.text === csharpVision.text,
    `${nodeVision.text} != ${csharpVision.text}`);

  const nodePlanner = await request(nodeBase, '/planner.html');
  const csharpPlanner = await request(csharpBase, '/planner.html');
  ok('planner.html matches Node', nodePlanner.response.status === csharpPlanner.response.status && nodePlanner.text === csharpPlanner.text);

  const nodeFallback = await request(nodeBase, '/not-a-real-page');
  const csharpFallback = await request(csharpBase, '/not-a-real-page');
  ok('SPA fallback matches Node', nodeFallback.response.status === csharpFallback.response.status && nodeFallback.text === csharpFallback.text);

  const { buildProblem, pieceSpec } = await import('../src/lib/artifact-optimize.js');
  const expression = {
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
  const problem = buildProblem({
    expr: expression, panel, ref: { A: 1500, C: 200, R: 60 }, pieces, hitScale: 0.85,
  });
  const body = JSON.stringify({ problem });
  const nodeOptimize = await request(nodeBase, '/api/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  const csharpOptimize = await request(csharpBase, '/api/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  ok('POST /api/optimize returns the same CSV',
    nodeOptimize.response.status === csharpOptimize.response.status
      && nodeOptimize.text.trimEnd() === csharpOptimize.text.trimEnd(),
    `status ${nodeOptimize.response.status}/${csharpOptimize.response.status}`);
  ok('POST /api/optimize reports X-Optimize-Ms',
    Number.isFinite(Number(csharpOptimize.response.headers.get('x-optimize-ms'))));

  const nodeBad = await request(nodeBase, '/api/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  const csharpBad = await request(csharpBase, '/api/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
  });
  ok('invalid optimize body is 400 in both',
    nodeBad.response.status === 400 && csharpBad.response.status === 400);

  const nodeMethod = await request(nodeBase, '/api/data', { method: 'DELETE' });
  const csharpMethod = await request(csharpBase, '/api/data', { method: 'DELETE' });
  ok('unsupported method is 405 in both',
    nodeMethod.response.status === 405 && csharpMethod.response.status === 405);
} catch (error) {
  fail += 1;
  console.log('FAIL  ' + String(error?.stack || error));
} finally {
  stop(csharpServer);
  stop(nodeServer);
  for (const child of children) stop(child);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
