// Compares the C# artifact scan parser with the JS one on real catalogue data.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { indexArtifacts } from '../src/lib/artifact-catalogue.js';
import { buildScanRows, parseScanResponse } from '../src/lib/artifact-scan.js';

const ROOT = process.cwd();
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const index = read('public/data/artifactlist.json');
const details = {};
for (const id of Object.keys(index)) {
  const file = path.join(ROOT, 'public/data/artifact/chs', id + '.json');
  if (fs.existsSync(file)) details[id] = JSON.parse(fs.readFileSync(file, 'utf8'));
}
const { list, sets } = indexArtifacts(index, details);

let bad = 0;
const ok = (label) => console.log('ok   ' + label);
const fail = (label, detail) => { console.log('FAIL ' + label + (detail ? ': ' + detail : '')); bad += 1; };

const firstDiff = (a, b, at = '') => {
  if (Object.is(a, b)) return null;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return (at || '$') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return (at || '$') + ': array/object mismatch';
  if (Array.isArray(a)) { if (a.length !== b.length) return (at || '$') + ': length ' + a.length + ' != ' + b.length; for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], at + '[' + i + ']'); if (d) return d; } return null; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) { if (!(key in a)) return at + '.' + key + ': missing on JS side'; if (!(key in b)) return at + '.' + key + ': missing on C# side'; const d = firstDiff(a[key], b[key], at + '.' + key); if (d) return d; }
  return null;
};

const replies = [
  JSON.stringify({"pieces":[{"pieceName":"风花的箴铭","set":"风起之日","slot":"生之花","level":0,"main":{"name":"生命值","value":717},"subs":[{"name":"暴击率","value":3.5},{"name":"防御力","value":5.8},{"name":"暴击伤害","value":7.8},{"name":"生命值","value":239}]}]}),
  '好的，结果如下：\n```json\n' + JSON.stringify({ pieces: [{ set: 'A Day Carved From Rising Winds', slot: 'Sands of Eon', level: 8, main: { name: 'ATK', value: 22.8 }, subs: [{ name: 'CRIT Rate', value: 3.5 }, { name: 'Energy Recharge', value: 6.5 }] }] }) + '\n```',
  JSON.stringify({ pieces: [{ pieceName: '完全不存在', set: '不存在套装', slot: '奇怪部位', level: 'x', main: { name: '不存在词条', value: 1 } }] }),
];

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const stop = (child) => { if (child && process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); };

let server;
try {
  if (!fs.existsSync(DLL)) throw new Error('build the API first: npm run build:csharp');
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn('dotnet', [DLL], { cwd: ROOT, env: { ...process.env, GsPlan__Port: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  for (const [i, reply] of replies.entries()) {
    const js = buildScanRows(parseScanResponse(reply), { list, sets });
    const response = await fetch(base + '/api/artifact/scan?lang=chs', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ reply }) });
    const payload = await response.json();
    if (response.status !== 200) { fail('reply ' + i + ' status', response.status + ' ' + JSON.stringify(payload)); continue; }
    const diff = firstDiff(js, payload.rows);
    if (diff) fail('reply ' + i + ' matches JS', diff); else ok('reply ' + i + ' matches JS');
  }
  const malformed = await fetch(base + '/api/artifact/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: '没有 JSON' }) });
  const malformedPayload = await malformed.json();
  if (malformed.status === 400 && malformedPayload?.error) ok('malformed reply is a readable 400'); else fail('malformed reply is a readable 400', malformed.status + ' ' + JSON.stringify(malformedPayload));
  const wrongMethod = await fetch(base + '/api/artifact/scan');
  if (wrongMethod.status === 405) ok('GET is 405'); else fail('GET is 405', wrongMethod.status);
} catch (error) { fail('check crashed', String(error?.stack || error)); } finally { stop(server); }

console.log(bad ? bad + ' PROBLEMS' : 'all checks passed');
process.exit(bad ? 1 : 0);