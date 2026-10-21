// Compares the C# gcsim importer with the JS one on a synthetic sample that
// exercises the branches a real log does: a multi-part cast, mixed crits, a
// reaction, an unmapped ability, a state card and a 4-piece artifact source.
//
// The body is sent as a ZLIB stream because that is what gcsim exports; the
// gzip and plain-JSON paths get one request each as well.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deflateSync, gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
const { importGcsim } = await import('../scripts/gcsim-import.mjs');

let bad = 0;
const ok = (label) => console.log('ok   ' + label);
const fail = (label, detail) => {
  console.log('FAIL ' + label + (detail ? ': ' + detail : ''));
  bad += 1;
};

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', p), 'utf8'));
const catalogues = {
  char: read('data/charlist.json'),
  weapon: read('data/weaponlist.json'),
  artifact: read('data/artifactlist.json'),
  stats: read('data/stats-compact.json'),
};
const mapping = read('data/gcsim-abilities.json');
const talentDamage = read('data/talent-damage.json');
const charId = '10000128';
const charData = { [charId]: read('data/char/chs/' + charId + '.json') };
const artifactInfo = read('data/artifact/chs/15044.json');
const setBonuses = { 15044: artifactInfo?.info?.setBonuses };

const sample = {
  character_details: [{
    name: 'varka', element: 'anemo', cons: 6, level: 95,
    talents: { attack: 10, skill: 10, burst: 10 },
    weapon: { name: 'gestofthemightywolf', refine: 1, level: 90 },
    sets: { adaycarvedfromrisingwinds: 4 },
    stats: [
      0, 0.109, 18.5, 4780, 0, 357.7, 1.288, 0.065, 102.6, 0.397, 1.492,
      0, 0.3, 0, 0, 0, 0.466, 0, 0, 0, 0, 0.1, 0, 0, 0,
    ],
  }],
  target_details: [{ level: 110 }],
  logs: [
    { event: 'damage', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 100 } },
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 50 } },
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: false, damage: 60 } },
    { event: 'damage', char_index: 0, frame: 12, logs: { abil: 'swirl-pyro', ele: 'pyro', crit: false, damage: 30 } },
    { event: 'damage', char_index: 0, frame: 13, logs: { abil: 'Varka C2', ele: 'anemo', crit: true, damage: 70 } },
    { event: 'damage', char_index: 0, frame: 14, logs: { abil: 'Made Up Ability', ele: 'anemo', crit: true, damage: 10 } },
    { event: 'calc', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', talent: 5.916 } },
  ],
};

const js = importGcsim({ sample, mapping, catalogues, charData, talentDamage, setBonuses });

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
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

const stop = (child) => {
  if (!child) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { child.kill(); } catch { /* best effort */ }
};

const firstDiff = (a, b, at = '') => {
  if (Object.is(a, b)) return null;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') {
    return (at || '$') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return (at || '$') + ': array/object mismatch';
  }
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
};

let server;
try {
  if (!fs.existsSync(DLL)) throw new Error('build the API first: npm run build:csharp');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn('dotnet', [DLL], {
    cwd: ROOT,
    env: { ...process.env, GsPlan__Port: String(port) },
    stdio: 'ignore',
  });
  await waitFor(base + '/api/health');

  const post = async (bytes) => {
    const response = await fetch(base + '/api/gcsim/import?lang=chs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/json' },
      body: bytes,
    });
    return { response, payload: await response.json() };
  };

  const raw = Buffer.from(JSON.stringify(sample));
  for (const [label, bytes] of [
    ['zlib', deflateSync(raw)],
    ['gzip', gzipSync(raw)],
    ['plain JSON', raw],
  ]) {
    const { response, payload } = await post(bytes);
    if (response.status !== 200) {
      fail(label + ' import status', response.status + ' ' + JSON.stringify(payload));
      continue;
    }
    const docDiff = firstDiff(js.doc, payload.doc);
    const reportDiff = firstDiff(js.report, payload.report);
    if (!docDiff && !reportDiff) ok(label + ' import matches JS');
    else fail(label + ' import matches JS', docDiff || reportDiff);
  }

  const badResponse = await fetch(base + '/api/gcsim/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('not a sample'),
  });
  const badPayload = await badResponse.json();
  if (badResponse.status === 400 && badPayload?.error) ok('malformed sample is a readable 400');
  else fail('malformed sample is a readable 400', badResponse.status + ' ' + JSON.stringify(badPayload));

  const wrongMethod = await fetch(base + '/api/gcsim/import');
  if (wrongMethod.status === 405) ok('GET is 405, not the SPA fallback');
  else fail('GET is 405', wrongMethod.status);

  if (!isDeepStrictEqual(js.doc, js.doc)) fail('JS self comparison');
} catch (error) {
  fail('check crashed', String(error?.stack || error));
} finally {
  stop(server);
}

console.log(bad ? bad + ' PROBLEMS' : 'all checks passed');
process.exit(bad ? 1 : 0);
