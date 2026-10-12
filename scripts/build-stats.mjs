#!/usr/bin/env node
/**
 * Pack the raw Excel tables in ./stats-src into ./public/data/stats-compact.json.
 *
 * WHY A GENERATED FILE, AND WHY THIS SHAPE
 *   The app has to turn a level into a number: `value = base * curve(level) +
 *   ascensionBonus(phase)`. That needs three factors per entity, and two of them
 *   are shared. Storing the FACTORS rather than the 100-level result keeps the
 *   file at ~250 KB instead of several megabytes, and -- the point of the whole
 *   exercise -- keeps full precision instead of the rounded display values in
 *   charlist/weaponlist.
 *
 *     charCurve / weaponCurve    curve name -> 100 numbers, stored ONCE
 *     charPromote / weaponPromote  promote id -> 7 (or 5) phases of {prop: value}
 *     chars                      id -> { promote, base:{hp,atk,def}, curve:{hp,atk,def},
                                         innate?:{em} }
 *     weapons                    id -> { promote, maxLevel, main:{prop,base,curve}, sub:? }
 *
 *   A character's DEFENSE uses the HP curve of its tier -- there is no DEFENSE
 *   curve in the data -- and a weapon's curve name says nothing about the stat
 *   (Skyward Harp's Energy Recharge runs on GROW_CURVE_CRITICAL_301), so the
 *   curve is always recorded per stat rather than inferred from its name.
 *
 * INCREMENTAL UPDATE
 *   This is a pure function of stats-src/, so `npm run stats:update` re-downloads
 *   whatever changed upstream, rebuilds this file, and prints the delta: the
 *   characters and weapons that were added, removed, or had a factor change.
 *   A new character six months from now is one line in that report.
 *
 * USAGE
 *   node scripts/build-stats.mjs            # write public/data/stats-compact.json
 *   node scripts/build-stats.mjs --check    # report the delta, write nothing
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'stats-src');
const DEST = path.join(ROOT, 'public', 'data', 'stats-compact.json');

const CHECK = process.argv.slice(2).includes('--check');

/** The obfuscated field the dumped Excel uses for every numeric value. */
const V = 'GGKIEIJLCJJ';

const read = (name) => JSON.parse(fs.readFileSync(path.join(SRC, `${name}.json`), 'utf8'));

/* --------------------------------------------------------------- packing */

/** curve name -> [value per level], indexed from level 1. */
function packCurves(rows) {
  const out = {};
  for (const row of rows) {
    for (const info of row.curveInfos) {
      (out[info.type] ??= [])[row.level - 1] = info[V];
    }
  }
  return out;
}

/**
 * promote id -> [ {prop: value} per phase ].
 *
 * Phases are padded to a uniform length so a consumer can index them by
 * ascension phase without checking. A phase whose props all carry no number
 * (the first phase, usually) becomes `{}`.
 */
function packPromote(rows, idKey) {
  const out = {};
  const phases = {};
  for (const row of rows) {
    const id = String(row[idKey]);
    if (!(id in out)) {
      out[id] = [];
      phases[id] = [];
    }
    phases[id].push(row.unlockMaxLevel);
    out[id].push(
      Object.fromEntries(row.addProps.filter((p) => p[V] != null).map((p) => [p.propType, p[V]]))
    );
  }
  for (const id of Object.keys(out)) {
    while (out[id].length < 7) out[id].push({});
  }
  return { promote: out, thresholds: phases };
}

/**
 * The level at which this entity's last ascension becomes available.
 * A weapon's is 90 for most and 70 for the ten 1-2 star ones; a character's is
 * always 90 (they can still be levelled to 100, which stays in the last phase).
 */
const maxLevelOf = (phases) => phases[phases.length - 1];

/* ------------------------------------------------------------------ build */

const avatar = read('AvatarExcelConfigData');
const avatarCurve = read('AvatarCurveExcelConfigData');
const avatarPromote = read('AvatarPromoteExcelConfigData');
const weaponExcel = read('WeaponExcelConfigData');
const weaponCurve = read('WeaponCurveExcelConfigData');
const weaponPromote = read('WeaponPromoteExcelConfigData');

const charCurve = packCurves(avatarCurve);
const weaponCurves = packCurves(weaponCurve);
const cp = packPromote(avatarPromote, 'avatarPromoteId');
const wp = packPromote(weaponPromote, 'weaponPromoteId');

const SHORT = {
  FIGHT_PROP_BASE_HP: 'hp',
  FIGHT_PROP_BASE_ATTACK: 'atk',
  FIGHT_PROP_BASE_DEFENSE: 'def',
};

const chars = {};
for (const a of avatar) {
  const curve = {};
  for (const p of a.propGrowCurves) {
    const key = SHORT[p.type];
    if (key) curve[key] = p.growCurve;
  }
  if (!curve.hp || !curve.atk || !curve.def) continue;
  const entry = {
    promote: String(a.avatarPromoteId),
    maxLevel: maxLevelOf(cp.thresholds[String(a.avatarPromoteId)] || [90]),
    base: { hp: a.hpBase, atk: a.attackBase, def: a.defenseBase },
    curve,
  };
  // A couple of characters carry a FLAT stat of their own, not tied to a level
  // or a phase -- Lauma and Nefer have Elemental Mastery 200 and 100. It lives in
  // the same table as the base values, so leaving it out would silently drop it
  // (the published per-level table shows it as a second ascension column).
  if (a.elementMastery) entry.innate = { em: a.elementMastery };
  chars[String(a.id)] = entry;
}

const weapons = {};
for (const w of weaponExcel) {
  const [main, sub] = w.weaponProp || [];
  if (!main) continue;
  weapons[String(w.id)] = {
    promote: String(w.weaponPromoteId),
    maxLevel: maxLevelOf(wp.thresholds[String(w.weaponPromoteId)] || [90]),
    main: { prop: main.propType, base: main.initValue, curve: main.type },
    sub: sub && sub.propType ? { prop: sub.propType, base: sub.initValue, curve: sub.type } : null,
  };
}

const out = {
  source: {
    project: 'Dimbreath/AnimeGameData2',
    path: 'ExcelBinOutput/{Avatar,Weapon}{Excel,Curve,Promote}ExcelConfigData.json',
    note: 'Generated by scripts/build-stats.mjs. Values = base * curve(level) + promote(phase).',
    builtAt: new Date().toISOString(),
  },
  charCurve,
  weaponCurve: weaponCurves,
  charPromote: cp.promote,
  weaponPromote: wp.promote,
  chars,
  weapons,
};

/* ------------------------------------------------------------- validation */

const problems = [];
for (const [id, c] of Object.entries(chars)) {
  for (const [stat, name] of Object.entries(c.curve)) {
    if (!charCurve[name]) problems.push(`char ${id}: curve ${name} (${stat}) missing`);
  }
  if (!cp.promote[c.promote]) problems.push(`char ${id}: promote ${c.promote} missing`);
}
for (const [id, w] of Object.entries(weapons)) {
  for (const part of [w.main, w.sub]) {
    if (part && !weaponCurves[part.curve]) problems.push(`weapon ${id}: curve ${part.curve} missing`);
  }
  if (!wp.promote[w.promote]) problems.push(`weapon ${id}: promote ${w.promote} missing`);
}
if (problems.length) {
  console.error(`\n${problems.length} broken reference(s):`);
  for (const p of problems.slice(0, 20)) console.error('  ' + p);
  process.exitCode = 1;
}

/* ------------------------------------------------------------------ diff */

/** What changed since the file on disk, so an update says what it brought in. */
function diff(oldData, next) {
  if (!oldData) return null;
  const added = (a, b) => Object.keys(b).filter((k) => !(k in a));
  const removed = (a, b) => Object.keys(a).filter((k) => !(k in b));
  // The WHOLE factor is compared, not just the base number: a curve name, an
  // ascension value or an innate stat can change without the base moving, and a
  // report that only watched `base` would call that "no change".
  const changed = (oldMap, nextMap) =>
    Object.keys(nextMap).filter(
      (k) => oldMap?.[k] && JSON.stringify(oldMap[k]) !== JSON.stringify(nextMap[k])
    );
  const changedBase = changed(oldData.chars, next.chars);
  const changedWeapon = changed(oldData.weapons, next.weapons);
  return {
    charsAdded: added(oldData.chars || {}, next.chars),
    charsRemoved: removed(oldData.chars || {}, next.chars),
    weaponsAdded: added(oldData.weapons || {}, next.weapons),
    weaponsRemoved: removed(oldData.weapons || {}, next.weapons),
    charsChanged: changedBase,
    weaponsChanged: changedWeapon,
  };
}

let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(DEST, 'utf8'));
} catch {
  previous = null;
}

const d = diff(previous, out);
console.log(`chars ${Object.keys(chars).length}, weapons ${Object.keys(weapons).length}`);
console.log(
  `curves char ${Object.keys(charCurve).length} / weapon ${Object.keys(weaponCurves).length}, ` +
    `promote char ${Object.keys(cp.promote).length} / weapon ${Object.keys(wp.promote).length}`
);
if (d) {
  const line = (label, arr) => (arr.length ? `  ${label}: ${arr.length} (${arr.slice(0, 12).join(', ')}${arr.length > 12 ? ', …' : ''})` : null);
  const lines = [
    line('characters added', d.charsAdded),
    line('characters removed', d.charsRemoved),
    line('characters whose base changed', d.charsChanged),
    line('weapons added', d.weaponsAdded),
    line('weapons removed', d.weaponsRemoved),
    line('weapons whose main stat changed', d.weaponsChanged),
  ].filter(Boolean);
  console.log(lines.length ? 'changes vs the file on disk:' : 'no change vs the file on disk');
  for (const l of lines) console.log(l);
}

if (CHECK) {
  console.log('\n--check: nothing written');
  process.exit(process.exitCode || 0);
}

const json = JSON.stringify(out);
fs.mkdirSync(path.dirname(DEST), { recursive: true });
fs.writeFileSync(DEST, json);
console.log(`\nwrote ${path.relative(ROOT, DEST)} (${(json.length / 1024).toFixed(1)} KB)`);
