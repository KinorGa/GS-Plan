// Do the weapon icons the editor asks for actually exist on disk?
import fs from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(process.cwd(), 'public');
const weapons = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/weaponlist.json'), 'utf8'));

/** The rename rule from game.js: UI_EquipIcon_X is stored as UI_Gacha_EquipIcon_X. */
const weaponIconName = (icon) => String(icon || '').replace(/^UI_(EquipIcon_)/, 'UI_Gacha_$1');

console.log('--- the three from the screenshot ---');
for (const n of ['无锋剑', '银剑', '冷刃']) {
  const hit = Object.entries(weapons).find(([, v]) => v.chsName === n);
  if (!hit) { console.log(`${n}: not in weaponlist`); continue; }
  const [id, v] = hit;
  const file = weaponIconName(v.weaponIcon);
  console.log(`${n} | id ${id}`);
  console.log(`  weaponIcon      : ${v.weaponIcon}`);
  console.log(`  expected file   : img/weapon/${file}.webp`);
  console.log(`  exists          : ${fs.existsSync(path.join(PUBLIC, 'img', 'weapon', `${file}.webp`))}`);
}

// How widespread is it?
let total = 0, named = 0, prefixOk = 0;
const dir = path.join(PUBLIC, 'img', 'weapon');
const onDisk = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => f.replace(/\.webp$/, '')) : []);
for (const [, v] of Object.entries(weapons)) {
  total++;
  if (!v.weaponIcon) continue;
  named++;
  if (/^UI_EquipIcon_/.test(v.weaponIcon)) prefixOk++;
}

console.log('\n--- across all 257 weapons ---');
console.log(`total weapons          : ${total}`);
console.log(`carry a weaponIcon     : ${named}`);
console.log(`with the UI_EquipIcon_ prefix (the rule expects it): ${prefixOk}`);
console.log(`files on disk          : ${onDisk.size}`);

// What actually IS in img/weapon, and does it match any naming rule?
const sample = [...onDisk].slice(0, 5);
console.log(`sample on-disk names   : ${sample.join(', ')}`);

// Which weapons resolve?
let resolves = 0;
const misses = [];
for (const [id, v] of Object.entries(weapons)) {
  const file = weaponIconName(v.weaponIcon);
  if (onDisk.has(file)) resolves++;
  else if (misses.length < 5) misses.push(`${id} ${v.chsName} -> ${file}`);
}
console.log(`resolve to a real file : ${resolves} / ${total}`);
if (misses.length) console.log(`first misses:\n  ${misses.join('\n  ')}`);
