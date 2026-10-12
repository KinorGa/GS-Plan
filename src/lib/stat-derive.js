// Derive the stat panel from the team: character + weapon + artifacts.
//
// WHY THIS EXISTS
//   The damage card's panel was hardcoded constants (hp 12981, atk 335, def 787)
//   that came from a demo character and applied to EVERYONE. So a team's artifacts
//   had no effect on the damage below it, and two different characters produced
//   identical numbers.
//
//   Everything needed to compute it properly is already in the data:
//     - per-level base HP/ATK/DEF and the ascension stat  (detail.info.attributes)
//     - weapon base ATK and its secondary stat            (weaponlist.ascensionStats)
//     - artifact main stats and substats                  (the artifact curves)
//
// PRECISION
//   Those two catalogue tables are ROUNDED for display -- a Lv95 Varka is stored
//   as atk 392, not 392.4743. When the compact stat factors are loaded (see
//   lib/stat-tables.js) the base numbers and the weapon's own stats are computed
//   as `base * curve(level) + ascension(phase)` instead, and the tables above are
//   only the FALLBACK for a character the factors do not cover (a handful of new
//   or non-Excel characters). `derivePanel` reports which one it used as
//   `precise`, so a surface that shows the number can say so.
//
// THE ONE THING THAT IS NOT A STRAIGHT SUM
//   The panel's `hp`/`atk`/`def` are the values a PERCENTAGE multiplies, so they
//   must be the character's base only -- flat HP from a flower cannot be folded
//   into them, because `hp * (1 + hpPct/100)` would then scale the flat part too.
//   A +20 flower grants 4780 flat HP; folding it in overstates total HP by
//   `4780 * hpPct/100`, which is about 10% on a normal build. Hence the separate
//   `flatHp`/`flatAtk`/`flatDef` fields and `base * (1 + pct) + flat`.
//
//   ATK% multiplies the character's base ATK PLUS the weapon's base ATK in-game,
//   so `atk` here is that sum, not the character's alone.
//
// A NOTE ON CRIT
//   `critRate` and `critDmg` in the panel are TOTALS, because the formula reads
//   them as such (`1 + rate * dmg`). The game's bases are 5% and 50%, and the old
//   default of `critDmg: 38.4` was Varka's ascension BONUS used as if it were the
//   total -- so every character's crit multiplier came out about 2.4% low.

import { ARTIFACT_LEVEL_MAX, ELEMENT_OF_DMG_KEY, SLOT_KEYS, SUB_STATS, mainStatValue } from './artifact-model';
import { charStatsAt, weaponMaxLevel, weaponStatsAt } from './stat-tables';

/** Base CRIT Rate, CRIT DMG and Energy Recharge every character starts with. */
export const BASE_CRIT_RATE = 5;
export const BASE_CRIT_DMG = 50;
export const BASE_ER = 100;

/** The panel keys this module fills, and nothing else. */
export const DERIVED_KEYS = [
  'hp', 'atk', 'def',
  'flatHp', 'flatAtk', 'flatDef',
  'hpPct', 'atkPct', 'defPct',
  'em', 'critRate', 'critDmg', 'er',
  // Every element, because the derivation can now RECORD a mismatched goblet
  // rather than discarding it.
  'pyroDmg', 'hydroDmg', 'cryoDmg', 'electroDmg', 'anemoDmg', 'geoDmg', 'dendroDmg',
  'dmgBonus', 'physBonus',
  // Healing Bonus is a Circlet main stat. It feeds no damage field, but it IS a
  // derived panel quantity, and the formula scope exposes every such quantity as
  // a `$` symbol -- so it is recorded rather than dropped. The damage formula
  // ignores it (see NEUTRAL_KEYS in components/buff-model.js).
  'healBonus',
];

/**
 * The ascension/weapon stat name -> panel key.
 *
 * The dataset spells these as display strings (`"CRIT DMG%"`, `"Elemental
 * Mastery"`, `"Geo DMG Bonus%"`), and the element one varies per character, so
 * the element case is matched by shape rather than enumerated.
 */
/**
 * The dataset spells some ascension stats in a SHORT form that this app never
 * handled.
 *
 * A character's own table says `EM`, `ER`, `Healing%`, `Physical%` and
 * `Geo%`; a weapon's says `Elemental Mastery`, `Energy Recharge%`,
 * `Physical DMG Bonus%`. Only the long forms are in the switch below, so every
 * character whose ascension stat is one of the short ones -- about thirteen of
 * them, Sucrose and Mona among them -- had that stat SILENTLY DROPPED from the
 * panel. Normalising first fixes the fallback path as well as the derived one.
 */
export function normaliseAscensionName(name) {
  const k = String(name || '').trim();
  switch (k) {
    case 'EM': return 'Elemental Mastery';
    case 'ER': return 'Energy Recharge%';
    case 'Healing%': return 'Healing Bonus%';
    case 'Physical%': return 'Physical DMG Bonus%';
    default: break;
  }
  // `Geo%` -> `Geo DMG Bonus%`. Only the seven damage elements, so `HP%` and
  // friends cannot be swept up by a looser pattern.
  const m = /^(Anemo|Geo|Electro|Dendro|Hydro|Pyro|Cryo)%$/.exec(k);
  if (m) return `${m[1]} DMG Bonus%`;
  return k;
}

export function ascensionKeyToPanel(name, element) {
  const k = normaliseAscensionName(name);
  switch (k) {
    case 'CRIT DMG%': return 'critDmg';
    case 'CRIT Rate%': return 'critRate';
    case 'ATK%': return 'atkPct';
    case 'HP%': return 'hpPct';
    case 'DEF%': return 'defPct';
    case 'Elemental Mastery': return 'em';
    case 'Energy Recharge%': return 'er';
    case 'Physical DMG Bonus%': return 'physBonus';
    // Healing Bonus IS a panel field now (see DERIVED_KEYS): it is not a damage
    // stat, but it is a real derived quantity and the formula scope names it.
    case 'Healing Bonus%': return 'healBonus';
    default: break;
  }
  // "<Element> DMG Bonus%" -> that element's OWN field, matching or not. The
  // character's element is no longer needed here: the key names the element, and
  // the formula picks the hit's.
  const m = /^([A-Za-z]+) DMG Bonus%$/.exec(k);
  if (m) {
    const key = `${m[1].toLowerCase()}Dmg`;
    return ELEMENT_OF_DMG_KEY[key] ? key : null;
  }
  return null;
}

/**
 * A character's base stats at a level, plus their ascension stat.
 *
 * Falls back to the nearest LOWER row when the exact level is absent. The table
 * has real gaps -- levels 91-94 and 96-99 are missing for all 138 characters --
 * so an exact-match lookup would return nothing for a perfectly ordinary level.
 */
export function charBaseAtLevel(detail, level) {
  const rows = detail?.info?.attributes;
  if (!Array.isArray(rows) || !rows.length) return null;

  const want = Number(level);
  let row = rows.find((r) => r.level === want);
  if (!row) {
    const lower = rows.filter((r) => Number(r.level) <= want).sort((a, b) => b.level - a.level);
    row = lower[0] || rows[0];
  }

  // EVERY extra column, not just the first. Two characters (Nefer and Mitiya)
  // publish two -- a CRIT DMG% ascension stat AND an Elemental Mastery -- and
  // taking only the first silently dropped the second.
  const extras = Object.entries(row)
    .filter(([k]) => !['level', 'ascension', 'hp', 'atk', 'def'].includes(k))
    .map(([name, value]) => ({ name, value: Number(value) || 0 }));

  return {
    level: row.level,
    hp: Number(row.hp) || 0,
    atk: Number(row.atk) || 0,
    def: Number(row.def) || 0,
    ascensionName: extras[0]?.name ?? null,
    ascensionValue: extras[0]?.value ?? 0,
    innate: null,
    extras,
  };
}

/**
 * Every artifact contribution, split into base-multipliers and flat additions.
 *
 * MAIN AND SUBSTATS ARE SUMMED THE SAME WAY; they differ only in where the number
 * comes from -- a main stat's value is derived from the piece's level through the
 * curve, a substat's is whatever the user typed.
 */
export function artifactTotals(artifacts, element) {
  const out = { flat: {}, pct: {}, notes: [] };
  const add = (panelKey, value) => {
    if (!panelKey || !value) return;
    const bucket = panelKey.startsWith('flat') ? out.flat : out.pct;
    bucket[panelKey] = (bucket[panelKey] || 0) + value;
  };

  for (const slotKey of SLOT_KEYS) {
    const piece = artifacts?.[slotKey];
    if (!piece) continue;

    // Main stat: the key names the stat, the level gives the number.
    if (piece.mainStat) {
      const v = mainStatValue(piece.mainStat, piece.level ?? ARTIFACT_LEVEL_MAX);
      add(artifactKeyToPanel(piece.mainStat, element, out.notes), v);
    }

    for (const sub of piece.subStats || []) {
      if (!sub?.key) continue;
      // A substat's value is free text, so it is parsed rather than trusted.
      const n = parseFloat(String(sub.value ?? '').replace(/[^0-9.+-]/g, ''));
      if (Number.isFinite(n)) add(artifactKeyToPanel(sub.key, element, out.notes), n);
    }
  }

  return out;
}

/**
 * An ARTIFACT stat key -> a PANEL key.
 *
 * The naming collides on purpose and the collision is the trap: an artifact's
 * `hp` is FLAT HP (a flower's main stat), while the panel's `hp` is the BASE that
 * a percentage multiplies. Mapping `hp` to `hp` would add 4780 to the base and
 * then scale it by HP%, overstating total HP by roughly 10%.
 */
export function artifactKeyToPanel(key, element, notes) {
  switch (key) {
    case 'hp': return 'flatHp';
    case 'atk': return 'flatAtk';
    case 'def': return 'flatDef';
    // Healing Bonus IS a panel field now (see DERIVED_KEYS). It does not move
    // the damage number, but it IS a derived quantity, so a Circlet's healing
    // main stat is recorded instead of silently discarded.
    case 'healBonus': return 'healBonus';
    default: break;
  }
  if (key === 'physBonus') return 'physBonus';

  // A per-element bonus goes to ITS OWN field, whether or not it matches the
  // character.
  //
  // It used to be folded into the single `dmgBonus` ONLY when the element
  // matched, and discarded otherwise -- which was the honest choice while the
  // panel could hold one element's worth of bonus, but lost information: a Pyro
  // goblet on a Cryo character simply vanished. Now the panel has a field per
  // element, so it is recorded where it belongs and the formula picks the hit's.
  //
  // Matched against `ELEMENT_OF_DMG_KEY`, a WHITELIST built from `DMG_ELEMENTS`.
  // A regex cannot do this job: `/^([a-z]+)Dmg$/` also matches `critDmg`
  // ("crit" + "Dmg"), which silently discarded every CRIT DMG artifact stat as a
  // mismatched element. `artifact-curves.js` documents this exact trap and
  // excludes `crit`; a whitelist cannot fall into it at all.
  if (ELEMENT_OF_DMG_KEY[key]) return key;

  if (SUB_STATS.includes(key)) return key;
  return null;
}

/**
 * The whole derived panel.
 *
 * @param {object} input
 * @param {object} input.detail     The character detail file (per-level stats).
 * @param {number} input.level      The unit's character level.
 * @param {string} input.element    The character's element, for goblet matching.
 * @param {object} input.weapon     The weapon catalogue entry, or null.
 * @param {object} input.artifacts  The unit's five slots.
 * @returns {{values: object, notes: Array, base: object|null}}
 */
export function derivePanel({ charId, detail, level, element, weaponId, weapon, artifacts, stats }) {
  const values = Object.fromEntries(DERIVED_KEYS.map((k) => [k, 0]));
  const notes = [];

  // The formula, when the factors are loaded; the rounded per-level table
  // otherwise. Both return the same shape, so nothing below cares which one.
  const derived = charId != null && stats ? charStatsAt(stats, charId, level) : null;
  const base = derived || charBaseAtLevel(detail, level);
  const precise = Boolean(derived);
  if (!base) {
    // No stat table: leave everything at zero and SAY SO, rather than inventing
    // a plausible-looking panel the way the old hardcoded defaults did.
    notes.push({ kind: 'no-stat-table' });
    return { values, notes, base: null, precise: false };
  }
  if (!precise && charId != null && stats) {
    // The factors exist but do not cover this character -- reported rather than
    // silently presented as exact, because the number below is a rounded one.
    notes.push({ kind: 'stat-fallback' });
  }

  // The ATK% base is character + weapon, which is what the game multiplies.
  //
  // The weapon is taken at its MAXIMUM level, which is what the catalogue's own
  // `ascensionStats` always was -- the model has no weapon level to consult.
  const wStats = weaponId != null && stats
    ? weaponStatsAt(stats, weaponId, weaponMaxLevel(stats, weaponId) ?? 90)
    : null;
  const weaponAtk = wStats ? wStats.atk : Number(weapon?.ascensionStats?.atk) || 0;
  values.hp = base.hp;
  values.atk = base.atk + weaponAtk;
  values.def = base.def;

  // The character's ascension stat, plus any flat stat they always have
  // (Lauma/Nefer's Elemental Mastery). Applied as a LIST because two characters
  // have two of them, and they sum rather than replace.
  const extras = base.extras?.length
    ? base.extras
    : base.ascensionName
      ? [{ name: base.ascensionName, value: base.ascensionValue }]
      : [];
  for (const { name, value } of extras) {
    const key = ascensionKeyToPanel(name, element);
    if (key && value) values[key] += value;
    else if (value && !key) notes.push({ kind: 'ascension-unmapped', name });
  }

  // The weapon's secondary stat, which is the same vocabulary as the ascension.
  if (wStats) {
    if (wStats.subName && wStats.subValue) {
      const key = ascensionKeyToPanel(wStats.subName, element);
      if (key) values[key] += wStats.subValue;
      else notes.push({ kind: 'weapon-stat-unmapped', name: wStats.subName });
    }
  } else {
    for (const [name, raw] of Object.entries(weapon?.ascensionStats || {})) {
      if (name === 'atk') continue;   // already counted as base ATK
      const key = ascensionKeyToPanel(name, element);
      const n = Number(raw) || 0;
      if (key && n) values[key] += n;
      else if (n) notes.push({ kind: 'weapon-stat-unmapped', name });
    }
  }

  // Artifacts.
  const art = artifactTotals(artifacts, element);
  for (const [k, v] of Object.entries(art.flat || {})) values[k] = (values[k] || 0) + v;
  for (const [k, v] of Object.entries(art.pct || {})) values[k] = (values[k] || 0) + v;
  notes.push(...art.notes);

  // The three TOTALS the formula reads directly: their bases are part of the
  // panel, not something the formula adds.
  values.critRate += BASE_CRIT_RATE;
  values.critDmg += BASE_CRIT_DMG;
  values.er += BASE_ER;

  return { values, notes, base, precise };
}
