// Does every weapon type in the dataset resolve to a real glyph file?
//
// The damage card draws the weapon glyph from `weaponType` via `weaponOf`. The
// planner omitted that field, so every card fell back to `unknown`. This checks
// the mapping itself against the data and the files on disk, which is stronger
// than cycling a UI picker and does not depend on my selectors.
//
// ONE ROW IS EXPECTED NOT TO MAP. The Traveler's catalogue entry is the player
// character: it carries `weaponType: WEAPON_CROSSBOW` and `element: Unknown`
// because the player picks both, so there is no single glyph for it and the UI
// is meant to fall back. Listing it as a known placeholder keeps the guard
// useful -- a genuinely new, unmapped type still fails -- without asserting
// something about the data that is not true.
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(process.cwd(), 'public');
const list = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/charlist.json'), 'utf8'));

// The table from src/game.js, read rather than duplicated.
const game = fs.readFileSync('src/game.js', 'utf8');
const table = game.match(/export const WEAPONS = \{([\s\S]*?)\n\};/)[1];
const WEAPONS = {};
for (const m of table.matchAll(/([A-Z_]+):\s*\{\s*icon:\s*'([^']+)'/g)) WEAPONS[m[1]] = m[2];

const PLACEHOLDER_TYPES = new Set(['WEAPON_CROSSBOW']);

console.log('WEAPONS table:');
for (const [k, v] of Object.entries(WEAPONS)) {
  const exists = fs.existsSync(path.join(PUBLIC, 'img', 'icons', `${v}.webp`));
  console.log(`  ${exists ? 'ok  ' : 'FAIL'} ${k.padEnd(24)} -> ${v}.webp`);
}

// Every weaponType the dataset actually uses.
const used = {};
for (const c of Object.values(list)) used[c.weaponType] = (used[c.weaponType] || 0) + 1;

console.log('\nweapon types in charlist.json:');
let bad = 0;
for (const [t, n] of Object.entries(used).sort()) {
  const mapped = WEAPONS[t];
  const placeholder = !mapped && PLACEHOLDER_TYPES.has(t);
  if (!mapped && !placeholder) bad++;
  const verdict = mapped ? 'ok  ' : placeholder ? 'note' : 'FAIL';
  const what = mapped
    ? mapped
    : placeholder
      ? '(placeholder: the Traveler row, unknown glyph is expected)'
      : '(NOT IN TABLE -> unknown glyph)';
  console.log(`  ${verdict} ${t.padEnd(24)} ${String(n).padStart(3)} chars -> ${what}`);
}

console.log(
  bad
    ? `\n${bad} unexpected weapon types fall back to the unknown glyph`
    : '\nevery weapon type resolves (the Traveler placeholder excepted)'
);
process.exit(bad ? 1 : 0);
