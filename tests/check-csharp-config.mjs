// Compare the C# configuration file boundary with src/lib/config-file.js.
//
// The file is not just JSON: importing repairs teams, migrates the old bare
// artifact build, guarantees axis/entry ids, expands pools and drops rows it
// cannot render. A second implementation is only safe if every one of those
// rules produces the same document.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfigFile, parseConfigFile } from '../src/lib/config-file.js';

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

const firstDiff = (a, b, at = '$') => {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a == null || b == null) return `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${at}: array shape differs`;
    if (a.length !== b.length) return `${at}.length: ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i += 1) {
      const found = firstDiff(a[i], b[i], `${at}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a); const bk = Object.keys(b);
    if (ak.join('|') !== bk.join('|')) return `${at}: keys ${JSON.stringify(ak)} != ${JSON.stringify(bk)}`;
    for (const key of ak) {
      const found = firstDiff(a[key], b[key], `${at}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
};

const firstTextDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return `at ${i}: ${JSON.stringify(a.slice(i, i + 80))} != ${JSON.stringify(b.slice(i, i + 80))}`;
  return `length ${a.length} != ${b.length}`;
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
};

const postText = async (base, pathname, value) => {
  const response = await fetch(base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const text = await response.text();
  return { response, text };
};

const postJson = async (base, pathname, value) => {
  const { response, text } = await postText(base, pathname, value);
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
};

const source = {
  kind: 'artifact2',
  name: { chs: '天之美赐', en: 'Gift' },
  owner: { id: 'c1' },
  libKey: 'artifact:1:2',
};
const otherSource = { ...source, libKey: 'artifact:2:2' };
const label = { ...source, stages: [{ chs: '技能伤害', mult: 1.5, hits: 1 }] };
const drop = (id, src, buffs) => ({ id, source: { ...src }, buffs: buffs.map((b) => ({ ...b })) });

const fixture = {
  team: {
    units: [{
      id: 'u1',
      char: { id: '10000128', level: 95, constellation: 8, talents: { normal: 99, skill: 10, burst: 2 } },
      weapon: { id: '12515', refine: 2, extra: 'kept' },
      artifacts: {
        flower: {
          setId: '15044', mainStat: 'hp', level: 20,
          subStats: [
            { key: 'atkPct', value: 10.5 }, null, { key: 'critRate', value: 6.2 }, { key: 'em', value: '23' },
          ],
          unknownPieceField: true,
        },
        plume: { setId: '15044', mainStat: 'atk', level: 20 },
        sands: { setId: '15044', mainStat: 'atkPct', level: 20 },
        goblet: { setId: '15044', mainStat: 'anemoDmg', level: 20 },
        circlet: { setId: '15044', mainStat: 'critDmg', level: 20 },
      },
      unknownUnitField: ['kept'],
    }],
    unknownTeamField: 'kept',
  },
  axes: [{
    id: 'ax1',
    name: '',
    unknownAxisField: 1,
    entries: [
      {
        id: 'e1', charId: 'c1', scalingBasis: '攻击力',
        drops: [
          drop('d1', source, [{ key: 'atkPct', value: 25, tag: '' }]),
          drop('d2', source, [{ key: 'atkPct', value: 25, tag: '' }]),
        ],
        statOverrides: { enemyRes: 30, critRate: 99 },
        summary: { sourceKey: 'k', sourceLabel: label },
        note: 'kept', unknownEntryField: true,
      },
      {
        id: 'e2', charId: 'c1',
        drops: [
          drop('d3', source, [{ key: 'atkPct', value: 18, tag: '' }]),
          drop('d4', source, [{ key: 'atkPct', value: '15', tag: '' }]),
          drop('d5', source, [{ key: 'atkPct', value: 15, tag: '' }]),
        ],
        summary: { sourceKey: 'k', sourceLabel: label },
      },
      { id: 'e1', charId: 'c3', drops: [] },
      {
        id: 'e3', kind: 'segment', name: '循环', expanded: true, discardMe: true,
        children: [{ id: 'e4', charId: 'c2', drops: [drop('d6', otherSource, [])] }],
      },
      {
        id: 'e4', charId: 'c1', picked: { sourceKey: 'k', stageIndex: 0 },
        drops: [drop('d7', source, [])],
        children: [
          { id: 'cp2', partIndex: 2, element: 'Pyro', drops: [drop('d8', source, [])] },
          { id: 'cp0', partIndex: 0, element: '', drops: [drop('d9', source, [])] },
          { id: 'cpbad', partIndex: 1.5, drops: [] },
        ],
      },
    ],
  }],
  activeId: 'missing',
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

  const jsText = buildConfigFile(fixture);
  const exported = await postText(base, '/api/config/export', fixture);
  ok('export succeeds', exported.response.status === 200, `HTTP ${exported.response.status} ${exported.text}`);
  ok('exported text matches JS byte for byte', exported.text === jsText, firstTextDiff(exported.text, jsText));

  const jsDoc = JSON.parse(jsText);
  const csDoc = JSON.parse(exported.text);
  ok('exported document matches JS', JSON.stringify(csDoc) === JSON.stringify(jsDoc), firstDiff(csDoc, jsDoc));
  ok('pool keeps value and string apart',
    new Set(csDoc.pools.buffs.map((b) => JSON.stringify(b.value))).size === 4);
  ok('legacy enemyRes spreads to all eight types',
    csDoc.axes[0].entries[0].statOverrides.enemyResPhysical === 30
      && csDoc.axes[0].entries[0].statOverrides.enemyResPyro === 30);
  ok('old bare artifact build becomes a one-set container',
    csDoc.team.units[0].artifacts.active === 'a1'
      && csDoc.team.units[0].artifacts.sets[0].slots.flower.unknownPieceField === true);
  ok('unknown document fields survive', csDoc.team.unknownTeamField === 'kept'
    && csDoc.team.units[0].unknownUnitField[0] === 'kept'
    && csDoc.axes[0].unknownAxisField === 1
      && csDoc.axes[0].entries[0].unknownEntryField === true);
  const entryIds = csDoc.axes[0].entries.map((entry) => entry.id);
  ok('duplicate entry ids are repaired',
    new Set(entryIds).size === entryIds.length && entryIds[2] !== 'e1');

  const jsParsed = parseConfigFile(exported.text);
  const csParsed = await postJson(base, '/api/config/import', { text: exported.text });
  ok('import matches JS parse', JSON.stringify(csParsed) === JSON.stringify(jsParsed), firstDiff(csParsed, jsParsed));

  const inline = JSON.stringify({
    kind: 'lunaris-config', version: 1, team: fixture.team, axes: fixture.axes, activeId: 'ax1',
  });
  const jsInline = parseConfigFile(inline);
  const csInline = await postJson(base, '/api/config/import', { text: inline });
  ok('inline pre-pool file matches JS parse', JSON.stringify(csInline) === JSON.stringify(jsInline), firstDiff(csInline, jsInline));

  const legacy = JSON.stringify({ version: 1, units: fixture.team.units });
  const jsLegacy = parseConfigFile(legacy);
  const csLegacy = await postJson(base, '/api/config/import', { text: legacy });
  ok('bare team document matches JS parse', JSON.stringify(csLegacy) === JSON.stringify(jsLegacy), firstDiff(csLegacy, jsLegacy));

  const badKind = await postText(base, '/api/config/import', {
    text: JSON.stringify({ kind: 'buff-library', entries: {} }),
  });
  const badKindBody = JSON.parse(badKind.text);
  ok('wrong kind is a readable 400', badKind.response.status === 400
    && badKindBody.error === '这是「buff-library」文件，不是配置文件');

  const broken = await postText(base, '/api/config/import', { text: '{bad' });
  ok('malformed JSON is 400', broken.response.status === 400);

  const real = path.join(ROOT, 'data', 'gcsim-config.json');
  if (fs.existsSync(real)) {
    const text = fs.readFileSync(real, 'utf8');
    const jsReal = parseConfigFile(text);
    const csReal = await postJson(base, '/api/config/import', { text });
    ok('the real imported rotation matches JS parse', JSON.stringify(csReal) === JSON.stringify(jsReal), firstDiff(csReal, jsReal));

    const realExport = await postText(base, '/api/config/export', {
      team: jsReal.team, axes: jsReal.axes, activeId: jsReal.activeId,
    });
    const jsRealExport = buildConfigFile({
      team: jsReal.team, axes: jsReal.axes, activeId: jsReal.activeId,
    });
    ok('the real rotation exports byte for byte', realExport.text === jsRealExport,
      firstTextDiff(realExport.text, jsRealExport));
  } else {
    console.log('SKIP  data/gcsim-config.json is not present');
  }
} catch (error) {
  fail += 1;
  console.log('FAIL  ' + String(error?.stack || error));
} finally {
  if (server) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
