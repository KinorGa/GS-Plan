// Verify the source index and the buff library against real data.
//
// The index is the reference list a human reviews, so its SHAPE and its COUNT
// matter: a missing source is one nobody can ever fill in.
//
// Usage:
//   node tests/bundle-library.mjs && node tests/check-library.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

globalThis.fetch = async (url) => {
  const full = path.join(PUBLIC, String(url).replace(/^\//, ''));
  if (full.startsWith(PUBLIC) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    const body = fs.readFileSync(full, 'utf8');
    const json = full.endsWith('.json');
    return {
      ok: true, status: 200,
      headers: { get: () => (json ? 'application/json' : 'text/html') },
      json: async () => JSON.parse(body),
    };
  }
  // Mirror the server's SPA fallback: a 200 that is not JSON.
  return {
    ok: true, status: 200, headers: { get: () => 'text/html' },
    json: async () => { throw new SyntaxError("Unexpected token '<'"); },
  };
};

// localStorage shim: the library module reads it during render.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  loadSourceIndex, sourceKey, parseSourceKey, buffsFor, setBuffs,
  normaliseLibrary, serialiseLibrary, parseLibrary, libraryStats,
} = await import('../src/lib/buff-library.js');

let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const ok = (m) => console.log(`ok   ${m}`);

// ------------------------------------------------------------------ index --
console.log('1. the index covers every source');
const t0 = Date.now();
const index = await loadSourceIndex('chs');
const ms = Date.now() - t0;
console.log(`   built ${index.length} sources in ${ms}ms`);

const byKind = {};
for (const s of index) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
console.log(`   by kind: ${JSON.stringify(byKind)}`);

// Expected counts, from the dataset itself rather than from the index.
const charlist = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/charlist.json'), 'utf8'));
const weaponlist = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/weaponlist.json'), 'utf8'));
// The same placeholder rule the index applies, so the expected counts describe
// the roster the editor actually lists.
const isPlaceholder = (c) => c.element === 'Unknown' && c.qualityType === 'QUALITY_ORANGE_SP';
let expSkills = 0, expPassives = 0, expCons = 0, expChars = 0;
for (const id of Object.keys(charlist)) {
  if (isPlaceholder(charlist[id])) continue;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(PUBLIC, `data/char/chs/${id}.json`), 'utf8'));
    expChars++;
    expSkills += Object.keys(d.skills || {}).filter((k) => k !== 'leveling').length;
    expPassives += Object.values(d.passives || {}).filter((p) => p && (p.name || p.icon)).length;
    expCons += Object.keys(d.constellations || {}).length;
  } catch {}
}
console.log(`   roster: ${Object.keys(charlist).length} entries, ${expChars} playable`);
// Five rows per weapon: the index emits one per REFINEMENT (R1..R5), which is
// the unit a human has to fill in -- a weapon's passive scales with refinement.
const expWeapons = Object.keys(weaponlist).length * 5;
byKind.weapon === expWeapons
  ? ok(`${byKind.weapon} weapon rows (${Object.keys(weaponlist).length} x 5 refinements)`)
  : fail(`expected ${expWeapons} weapon rows, got ${byKind.weapon}`);
byKind.talent === expSkills + expPassives
  ? ok(`${byKind.talent} talent rows (${expSkills} skills + ${expPassives} passives)`)
  : fail(`expected ${expSkills + expPassives} talent rows, got ${byKind.talent}`);
byKind.constellation === expCons
  ? ok(`${byKind.constellation} constellations`) : fail(`expected ${expCons}, got ${byKind.constellation}`);
(byKind.artifact || 0) > 0 ? ok(`${byKind.artifact} artifact bonus rows`) : fail('no artifact rows');

// Every source must be addressable and unique.
const keys = index.map((s) => s.key);
new Set(keys).size === keys.length ? ok('every key is unique') : fail('duplicate keys');
index.every((s) => s.name?.chs) ? ok('every source is named') : fail('a source has no name');

// --- the placeholder characters must not be indexed ------------------------
const manekin = index.filter((s) => /10000117|10000118/.test(s.id || ''));
manekin.length === 0
  ? ok('奇偶 placeholders are not indexed')
  : fail(`${manekin.length} sources belong to a placeholder character`);

// --- spot-check a known source --------------------------------------------
const varka = index.find((s) => s.kind === 'constellation' && s.id === '10000128' && s.slot === 'c1');
varka ? ok(`found Varka C1: "${varka.name.chs.slice(0, 20)}…"`) : fail('Varka C1 missing');
varka?.desc ? ok('it carries its description') : fail('no description on C1');

const gobletSet = index.find((s) => s.kind === 'artifact' && s.id === '15044' && s.slot === '2');
gobletSet ? ok(`found 15044 2-pc: "${gobletSet.name.chs}"`) : fail('15044 2-pc missing');

// ---------------------------------------------------------------- library --
console.log('\n2. the library stores buffs per source key');
let lib = normaliseLibrary({ entries: {} });
buffsFor(lib, 'weapon:11515').length === 0 ? ok('a new source has no buffs') : fail('unexpected buffs');

lib = setBuffs(lib, 'weapon:11515', [{ key: 'atkPct', value: 28, tag: '通用' }]);
buffsFor(lib, 'weapon:11515').length === 1 ? ok('a buff round-trips') : fail('buff not stored');

// An empty list must DELETE the entry, not store an empty array.
lib = setBuffs(lib, 'weapon:11515', []);
Object.keys(lib.entries).length === 0
  ? ok('clearing a source removes its entry') : fail('empty entry retained');

// --- key shape -------------------------------------------------------------
sourceKey({ kind: 'weapon', id: '11515' }) === 'weapon:11515'
  ? ok('weapon key') : fail('weapon key wrong');
sourceKey({ kind: 'artifact', id: '15044', slot: 2 }) === 'artifact:15044:2'
  ? ok('artifact key carries the piece count') : fail('artifact key wrong');
sourceKey({ kind: 'constellation', id: '10000128', slot: 'c1' }) === 'constellation:10000128:c1'
  ? ok('constellation key') : fail('constellation key wrong');
const parsed = parseSourceKey('artifact:15044:2');
parsed.kind === 'artifact' && parsed.id === '15044' && parsed.slot === '2'
  ? ok('keys parse back') : fail('parseSourceKey wrong');

// --- round trip ------------------------------------------------------------
lib = setBuffs(lib, 'weapon:11515', [{ key: 'atkPct', value: 28, tag: '通用' }]);
lib = setBuffs(lib, 'constellation:10000128:c1', [
  { key: 'critDmg', value: 40, tag: '冰属性' },
  { key: 'normalDmg', value: 16, tag: '普攻' },
]);
const text = serialiseLibrary(lib);
const back = parseLibrary(text);
serialiseLibrary(back) === text ? ok('round trip is byte-identical') : fail('round trip differs');
libraryStats(back).sources === 2 && libraryStats(back).buffs === 3
  ? ok(`stats: ${libraryStats(back).sources} sources, ${libraryStats(back).buffs} buffs`)
  : fail(`stats wrong: ${JSON.stringify(libraryStats(back))}`);

// --- malformed input -------------------------------------------------------
const cases = [
  ['not json', '{ nope'],
  ['array at top level', '[]'],
  ['entries not an object', '{"entries": 5}'],
];
for (const [label, bad2] of cases) {
  let threw = false;
  try { parseLibrary(bad2); } catch { threw = true; }
  threw ? ok(`rejects ${label}`) : fail(`accepted ${label}`);
}
// A partially valid entry is repaired rather than rejected.
//
// The key is a NON-weapon one on purpose: `normaliseLibrary` migrates a bare
// `weapon:<id>` up to `weapon:<id>:r1`, which would move the entry and make the
// lookup below miss for a reason that has nothing to do with row repair.
const repaired = normaliseLibrary({ entries: { 'constellation:1:c1': [{ key: 'atk', value: 5 }, { value: 9 }, null, { key: 'er', value: 'x' }] } });
repaired.entries['constellation:1:c1'].length === 2
  ? ok('nameless buff rows are dropped, valid ones kept') : fail(`repaired to ${repaired.entries['constellation:1:c1'].length} rows`);
repaired.entries['constellation:1:c1'][1].tag === ''
  ? ok('a missing tag defaults to empty') : fail('tag default wrong');

console.log(bad ? `\n${bad} PROBLEMS` : '\nall checks passed');
process.exit(bad ? 1 : 0);
