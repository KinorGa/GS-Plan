// Which catalogue entries cannot be configured at all?
//
// The 奇偶 placeholders are already filtered. This asks the wider question: is
// there any OTHER entry that a user can pick but cannot use -- no element, no
// detail file, a weapon type that does not exist?
//
// The current filter requires BOTH `element === 'Unknown'` AND
// `qualityType === 'QUALITY_ORANGE_SP'`. This tests whether that is the right
// rule, or whether it misses something.
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(process.cwd(), 'public');
const list = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/charlist.json'), 'utf8'));

const hasDetail = (id) => fs.existsSync(path.join(PUBLIC, 'data', 'char', 'chs', `${id}.json`));
const hasArt = (id) => fs.existsSync(path.join(PUBLIC, 'img', 'char', `${id}.webp`));

// The weapon types the UI can draw a glyph for, from src/game.js.
const game = fs.readFileSync('src/game.js', 'utf8');
const WEAPON_KEYS = new Set(
  [...game.match(/export const WEAPONS = \{([\s\S]*?)\n\};/)[1].matchAll(/([A-Z_]+):/g)].map((m) => m[1])
);

const rows = Object.entries(list).map(([id, c]) => ({
  id,
  name: c.chsName,
  en: c.enName,
  element: c.element,
  quality: c.qualityType,
  weapon: c.weaponType,
  detail: hasDetail(id),
  art: hasArt(id),
  weaponKnown: WEAPON_KEYS.has(c.weaponType),
}));

console.log(`catalogue: ${rows.length} entries\n`);

// --- 1. the entries that cannot be configured, by each possible signal -------
const nonConfigurable = rows.filter((r) => !r.detail || r.element === 'Unknown' || !r.weaponKnown);
console.log('entries with a gap (no detail file, no element, or an unknown weapon type):');
for (const r of nonConfigurable) {
  const why = [
    !r.detail && 'no detail file',
    r.element === 'Unknown' && 'element Unknown',
    !r.weaponKnown && `weapon ${r.weapon}`,
  ].filter(Boolean).join(', ');
  console.log(`  ${r.id.padEnd(16)} ${String(r.name).padEnd(10)} ${r.quality.padEnd(18)} -- ${why}`);
}

// --- 2. what each candidate rule would drop --------------------------------
const rules = {
  'current: Unknown AND ORANGE_SP': (r) => r.element === 'Unknown' && r.quality === 'QUALITY_ORANGE_SP',
  'Unknown alone': (r) => r.element === 'Unknown',
  'ORANGE_SP alone': (r) => r.quality === 'QUALITY_ORANGE_SP',
  'no detail file': (r) => !r.detail,
};

console.log('\nwhat each rule drops:');
for (const [label, fn] of Object.entries(rules)) {
  const dropped = rows.filter(fn);
  const keepsReal = rows.filter((r) => !fn(r) && r.element !== 'Unknown');
  console.log(`\n  ${label}  ->  drops ${dropped.length}`);
  for (const d of dropped) console.log(`      ${d.id.padEnd(16)} ${String(d.name).padEnd(10)} element=${d.element} quality=${d.quality} detail=${d.detail}`);
  console.log(`      keeps ${keepsReal.length} entries with a real element`);
}

// --- 3. the question that matters: is any REAL character dropped? ----------
console.log('\n--- is a genuinely playable character ever dropped? ---');
for (const [label, fn] of Object.entries(rules)) {
  const droppedButReal = rows.filter((r) => fn(r) && r.detail && r.element !== 'Unknown');
  console.log(`  ${label.padEnd(34)} ${droppedButReal.length ? 'DROPS REAL: ' + droppedButReal.map((d) => d.name).join(', ') : 'no'}`);
}

// --- 4. how many Travelers survive each rule ------------------------------
console.log('\n--- Traveler entries kept ---');
for (const [label, fn] of Object.entries(rules)) {
  const kept = rows.filter((r) => /旅行者|Traveler/.test(r.name) && !fn(r));
  console.log(`  ${label.padEnd(34)} ${kept.length}: ${kept.map((k) => k.id).join(', ')}`);
}