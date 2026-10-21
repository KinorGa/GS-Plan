// Compares the C# formula parser with src/lib/buff-formula.js.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { analyse, evaluate, resolve } from '../src/lib/buff-formula.js';

const ROOT = process.cwd();
const DLL = path.join(ROOT, 'server', 'GsPlan.Api', 'bin', 'Debug', 'net8.0', 'GsPlan.Api.dll');
let bad = 0;
const ok = (label) => console.log('ok   ' + label);
const fail = (label, detail) => { console.log('FAIL ' + label + (detail ? ': ' + detail : '')); bad += 1; };
const same = (a, b) => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

const scope = { '生命值': 1000, '攻击力': 300, '总攻击力': 900, '暴击率': 50, '元素精通': 120, '等级': 90, '命座': 2 };
const cases = [
  '=$总攻击力*0.15',
  '=$攻击力 * 0.15 + 12',
  '=-$暴击率/2',
  '=($攻击力+100)/2',
  '=--$攻击力',
  '=$元素精通/0',
  '=$不存在*2',
  '=1+',
  '=1 2',
  '=12abc3',
  '12abc3',
  '12',
  '',
  '  = $攻击力 + 1',
  '==1',
  '=((1+2)*3)',
  '=$等级+1',
  '=$稀有度',
  '=$总攻击力*0.15+$总攻击力',
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
  for (const text of cases) {
    const a = analyse(text);
    const ar = await fetch(base + '/api/core/formula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mode: 'analyse' }) });
    const ap = await ar.json();
    const ad = firstDiff({ ok: a.ok, symbols: a.symbols, error: a.error ?? null, at: a.at ?? 0 }, { ok: ap.ok, symbols: ap.symbols, error: ap.error ?? null, at: ap.at ?? 0 });
    if (ad) fail('analyse ' + JSON.stringify(text), ad); else ok('analyse ' + JSON.stringify(text));

    const rj = resolve(text, scope);
    const rr = await fetch(base + '/api/core/formula', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, scope }) });
    const rp = await rr.json();
    const rd = firstDiff({ ok: rj.ok, value: rj.value, error: rj.error ?? null, unknown: rj.unknown }, { ok: rp.ok, value: rp.value, error: rp.error ?? null, unknown: rp.unknown });
    if (rd) fail('resolve ' + JSON.stringify(text), rd); else ok('resolve ' + JSON.stringify(text));
    if (text.startsWith('=') && !rj.unknown.length) {
      const ej = evaluate(text, scope);
      if (!same(ej.value, rj.value) || ej.ok !== rj.ok) fail('evaluate agrees with resolve ' + JSON.stringify(text));
    }
  }
  const wrongMethod = await fetch(base + '/api/core/formula');
  if (wrongMethod.status === 405) ok('GET is 405'); else fail('GET is 405', wrongMethod.status);
} catch (error) { fail('check crashed', String(error?.stack || error)); } finally { stop(server); }

function firstDiff(a, b, at = '') {
  if (Object.is(a, b)) return null;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return (at || '$') + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b);
  if (Array.isArray(a) !== Array.isArray(b)) return (at || '$') + ': array/object mismatch';
  if (Array.isArray(a)) { if (a.length !== b.length) return (at || '$') + ': length ' + a.length + ' != ' + b.length; for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], at + '[' + i + ']'); if (d) return d; } return null; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) { if (!(key in a)) return at + '.' + key + ': missing on JS side'; if (!(key in b)) return at + '.' + key + ': missing on C# side'; const d = firstDiff(a[key], b[key], at + '.' + key); if (d) return d; }
  return null;
}

console.log(bad ? bad + ' PROBLEMS' : 'all checks passed');
process.exit(bad ? 1 : 0);