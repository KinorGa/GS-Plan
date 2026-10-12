// Read a character's or a weapon's stats out of `public/data/stats-compact.json`.
//
// WHY THIS REPLACES THE TABLES THE APP USED TO READ
//   `charlist`/`weaponlist` store DISPLAY values: a Lv95 Varka is `atk: 392`, a
//   Lv90 Wolf's Gravestone is `atk: 608`. Those are the exact numbers rounded for
//   a tooltip, so a panel built from them is up to 0.5 off per stat -- and the
//   error is multiplied by every ATK% on the build. The underlying data is
//
//     value = base * curve(level) + ascensionBonus(phase)
//
//   and all three factors are published in the game's own Excel tables. This
//   module is the pure reader over the packed form of those factors; see
//   scripts/build-stats.mjs for the packing and docs/STATS.md for provenance.
//
// WHAT THE COMPACT FILE HOLDS (nothing here computes a table at load time)
//   charCurve[name]     100 numbers, one per level, shared by every entity that
//                       names it -- 4 character curves and 18 weapon curves
//   charPromote[id]     one { prop: value } per ascension phase (7 of them, or 5
//                       for the low-rarity weapons), shared between entities with
//                       the same promote id
//   chars[id]           { promote, maxLevel, base:{hp,atk,def}, curve:{hp,atk,def} }
//   weapons[id]         { promote, maxLevel, main:{prop,base,curve}, sub:? }
//
// TWO TRAPS IN THE SOURCE DATA, BOTH HANDLED HERE
//   1. A curve name does not name a stat. A character's DEFENSE runs on the HP
//      curve of its tier (there is no DEFENSE curve at all), and Skyward Harp's
//      Energy Recharge runs on GROW_CURVE_CRITICAL_301. So the curve is always
//      read from the entity's own factor, never guessed from the name.
//   2. The Excel stores percentages as FRACTIONS (0.384) while every consumer in
//      this app works in display units (38.4). The conversion is per-prop and
//      lives in `ASCENSION_PROP`; a flat stat like Elemental Mastery is passed
//      through untouched.

/**
 * The props an ascension/weapon stat can be, as `[displayName, isPercent]`.
 *
 * The display names are the dataset's own vocabulary -- the same strings
 * `ascensionKeyToPanel` already switches on (`"CRIT DMG%"`, `"ATK%"`, ...) -- so
 * a value derived here goes through the EXISTING mapping rather than a second
 * one that could drift from it.
 */
export const ASCENSION_PROP = {
  FIGHT_PROP_CRITICAL: ['CRIT Rate%', true],
  FIGHT_PROP_CRITICAL_HURT: ['CRIT DMG%', true],
  FIGHT_PROP_ATTACK_PERCENT: ['ATK%', true],
  FIGHT_PROP_HP_PERCENT: ['HP%', true],
  FIGHT_PROP_DEFENSE_PERCENT: ['DEF%', true],
  FIGHT_PROP_ELEMENT_MASTERY: ['Elemental Mastery', false],
  FIGHT_PROP_CHARGE_EFFICIENCY: ['Energy Recharge%', true],
  FIGHT_PROP_PHYSICAL_ADD_HURT: ['Physical DMG Bonus%', true],
  FIGHT_PROP_HEAL_ADD: ['Healing Bonus%', true],
  FIGHT_PROP_FIRE_ADD_HURT: ['Pyro DMG Bonus%', true],
  FIGHT_PROP_WATER_ADD_HURT: ['Hydro DMG Bonus%', true],
  FIGHT_PROP_ICE_ADD_HURT: ['Cryo DMG Bonus%', true],
  FIGHT_PROP_ELEC_ADD_HURT: ['Electro DMG Bonus%', true],
  FIGHT_PROP_WIND_ADD_HURT: ['Anemo DMG Bonus%', true],
  FIGHT_PROP_ROCK_ADD_HURT: ['Geo DMG Bonus%', true],
  FIGHT_PROP_GRASS_ADD_HURT: ['Dendro DMG Bonus%', true],
};

/** The three base props, which are folded into hp/atk/def rather than reported. */
const BASE_PROP = {
  FIGHT_PROP_BASE_HP: 'hp',
  FIGHT_PROP_BASE_ATTACK: 'atk',
  FIGHT_PROP_BASE_DEFENSE: 'def',
};

/** The levels an ascension unlocks at. Phase 0 is level 1-20, phase 1 is 21-40, ... */
const PHASE_UNLOCKS = [20, 40, 50, 60, 70, 80, 90];

/** Keep derived display values free of float noise (0.192 * 100 = 19.2000...03). */
const round = (n, digits = 6) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Which ascension phase a level is in.
 *
 * The number of phases is the entity's own: 7 for a character and most weapons,
 * 5 for the ten 1-2 star weapons, whose last phase caps at level 70. The phase is
 * the count of unlock levels strictly below the level asked for, so Lv20 is still
 * phase 0 and Lv21 is phase 1.
 */
export function ascensionPhase(phases, level) {
  const count = Array.isArray(phases) ? phases.length : 0;
  if (!count) return 0;
  const thresholds = PHASE_UNLOCKS.slice(0, count - 1);
  let phase = 0;
  for (const t of thresholds) if (t < level) phase++;
  return Math.min(phase, count - 1);
}

/** The curve value for a level, falling back to 1 (the Lv1 value) if unknown. */
function curveAt(curves, name, level) {
  const arr = name ? curves?.[name] : null;
  if (!Array.isArray(arr)) return 1;
  return arr[Math.round(level) - 1] ?? 1;
}

/**
 * A character's base stats at a level, plus their ascension stat.
 *
 * The returned shape is IDENTICAL to the one `charBaseAtLevel` read out of the
 * per-level table in the detail file, so `derivePanel` can consume either:
 *
 *   { level, hp, atk, def, ascensionName, ascensionValue, innate }
 *
 * `ascensionValue` is in display units (38.4, not 0.384) and `ascensionName` is
 * the dataset's name for the stat, so `ascensionKeyToPanel` maps it as before.
 * `innate` is a flat, level-independent stat the character simply has (Elemental
 * Mastery on Lauma and Nefer), or null.
 */
export function charStatsAt(stats, charId, level) {
  // The catalogue names the Traveler per element (`10000005_ANEMO`), while the
  // Excel has one record per body (`10000005`). The variant's own table is
  // identical to the base record's -- verified against every level of all
  // fourteen variants -- so the suffix is dropped rather than the character
  // silently falling back to rounded values.
  const key = String(charId);
  const c = stats?.chars?.[key] ?? stats?.chars?.[key.split('_')[0]];
  if (!c) return null;

  const phases = stats.charPromote?.[c.promote] || [{}];
  const phase = ascensionPhase(phases, level);
  const bonus = phases[phase] || {};

  const hp = c.base.hp * curveAt(stats.charCurve, c.curve.hp, level) + (bonus.FIGHT_PROP_BASE_HP || 0);
  const atk = c.base.atk * curveAt(stats.charCurve, c.curve.atk, level) + (bonus.FIGHT_PROP_BASE_ATTACK || 0);
  const def = c.base.def * curveAt(stats.charCurve, c.curve.def, level) + (bonus.FIGHT_PROP_BASE_DEFENSE || 0);

  // WHICH stat the ascension grants is a property of the CHARACTER, not of the
  // phase -- phase 0 grants nothing, so its entry is empty. The name is therefore
  // read from any phase that has one, and only the VALUE comes from this phase.
  // Otherwise a Lv1 character would report no ascension stat at all, while the
  // dataset's own table names it with a value of 0.
  let ascensionName = null;
  for (const phaseBonus of phases) {
    for (const prop of Object.keys(phaseBonus)) {
      if (BASE_PROP[prop] || !ASCENSION_PROP[prop]) continue;
      ascensionName = ASCENSION_PROP[prop][0];
      break;
    }
    if (ascensionName) break;
  }

  let ascensionValue = 0;
  const extras = [];
  for (const [prop, value] of Object.entries(bonus)) {
    if (BASE_PROP[prop]) continue;
    const label = ASCENSION_PROP[prop];
    if (!label) continue;
    const shown = round(label[1] ? value * 100 : value);
    if (!ascensionName) {
      ascensionName = label[0];
      ascensionValue = shown;
    }
    extras.push({ name: label[0], value: shown });
  }
  // A flat stat the character simply has, independent of level and phase.
  if (c.innate) {
    for (const [key, value] of Object.entries(c.innate)) {
      if (key === 'em') extras.push({ name: 'Elemental Mastery', value });
    }
  }

  // `extras` is EVERY non-base stat this character has at this level -- the
  // phase's ascension stat plus any flat innate one (Lauma/Nefer's Elemental
  // Mastery). Two characters do have two of them, so a caller must apply all of
  // them; `ascensionName`/`ascensionValue` is kept as the first for display.
  return {
    level: Math.round(level), hp, atk, def,
    ascensionName, ascensionValue,
    innate: c.innate || null,
    extras,
  };
}

/**
 * A weapon's stats at a level.
 *
 *   { level, maxLevel, atk, subName, subValue, subProp }
 *
 * `atk` is the main (base ATK) stat. The substat's `subName` is in the same
 * vocabulary as a character's ascension stat -- `ascensionKeyToPanel` maps it --
 * and is `null` for the handful of weapons that have no secondary prop.
 *
 * The game adds NO ascension bonus to a weapon substat: every non-base entry in
 * WeaponPromoteExcelConfigData is a value-less placeholder, so a substat is
 * exactly `base * curve`.
 */
export function weaponStatsAt(stats, weaponId, level) {
  const w = stats?.weapons?.[String(weaponId)];
  if (!w) return null;

  const phases = stats.weaponPromote?.[w.promote] || [{}];
  const lv = Math.round(level);
  const phase = ascensionPhase(phases, lv);
  const bonus = phases[phase] || {};

  const atk = w.main.base * curveAt(stats.weaponCurve, w.main.curve, lv) + (bonus.FIGHT_PROP_BASE_ATTACK || 0);

  let subName = null;
  let subProp = null;
  let subValue = 0;
  if (w.sub) {
    const label = ASCENSION_PROP[w.sub.prop];
    const raw = w.sub.base * curveAt(stats.weaponCurve, w.sub.curve, lv);
    subProp = w.sub.prop;
    subName = label ? label[0] : w.sub.prop;
    subValue = round(label && label[1] ? raw * 100 : raw);
  }

  return { level: lv, maxLevel: w.maxLevel, atk, subName, subValue, subProp };
}

/** The highest level a weapon can reach (90, or 70 for the 1-2 star ones). */
export function weaponMaxLevel(stats, weaponId) {
  return stats?.weapons?.[String(weaponId)]?.maxLevel ?? null;
}
