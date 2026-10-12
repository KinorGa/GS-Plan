// Artifact RULES: the shape of a build, and what the game allows in each slot.
//
// Pure data and pure functions -- no React, no network, no display formatting.
// Everything here is either a rule of the game or the canonical shape of the
// model, so it can be used by a future stat calculator, a save-file importer or
// a test without pulling in the catalogue or the UI.
//
// WHAT IS A BUILD
//   Five slots, each INDEPENDENT: its own set, its own main stat, its own level
//   and its own four substats. "4-piece X + 1 off-piece" is the normal case, so
//   the five slots cannot share one set selection.
//
// The display metadata (icons, labels, input hints) lives in `artifact-meta.js`
// and the catalogue loading in `artifact-catalogue.js`, so this file stays
// readable as the answer to "what is a legal artifact build?".

import { curveValue } from './artifact-curves';

/** The five slots, in the order the game and every stats screen lists them. */
export const SLOTS = [
  { key: 'flower', icon: 'UI_RelicIcon_10001_4' },
  { key: 'plume', icon: 'UI_RelicIcon_10001_2' },
  { key: 'sands', icon: 'UI_RelicIcon_10001_5' },
  { key: 'goblet', icon: 'UI_RelicIcon_10001_1' },
  { key: 'circlet', icon: 'UI_RelicIcon_10001_3' },
];

/** Just the slot keys, in the same order. */
export const SLOT_KEYS = SLOTS.map((s) => s.key);

/**
 * The elements a Goblet's DMG Bonus can roll.
 *
 * A goblet does NOT roll a generic "elemental DMG bonus" -- it rolls ONE
 * element, and the icon must say which. Presenting a single `dmgBonus` option
 * meant every goblet showed the same Pyro flame regardless of its real element,
 * which is actively misleading on a Pyro-less build.
 *
 * The seven elements plus Physical make the eight options a goblet really has.
 * Physical is listed separately below because it is not an element.
 */
export const DMG_ELEMENTS = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro'];

/** `<element>Dmg` -> the element it belongs to, for splitting a key back apart. */
export const ELEMENT_OF_DMG_KEY = Object.fromEntries(
  DMG_ELEMENTS.map((e) => [`${e}Dmg`, e])
);

/**
 * Which main stats each slot can roll.
 *
 * This is a rule of the game, not a preference: a Flower is ALWAYS flat HP and
 * a Plume is ALWAYS flat ATK, so those two slots have exactly one option. The
 * other three have a real choice, and their pools differ (only a Circlet can
 * roll CRIT, only a Goblet can roll elemental DMG).
 *
 * A Goblet lists its DMG bonus per ELEMENT (`pyroDmg` .. `dendroDmg`) plus
 * `physBonus`, because that is what a goblet actually rolls.
 *
 * Keys match `STAT_META` in buff-model.js so the icons and labels come from the
 * same table the buff cards use; the per-element keys are resolved through
 * `artifact-meta.js`, which knows how to label and glyph them.
 */
export const MAIN_STATS = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['hpPct', 'atkPct', 'defPct', 'em', 'er'],
  goblet: ['hpPct', 'atkPct', 'defPct', 'em', ...DMG_ELEMENTS.map((e) => `${e}Dmg`), 'physBonus'],
  circlet: ['hpPct', 'atkPct', 'defPct', 'em', 'critRate', 'critDmg', 'healBonus'],
};

/**
 * Substats any slot can roll.
 *
 * Flat HP/ATK/DEF are included because substats, unlike main stats, are not
 * slot-restricted. CRIT Rate and CRIT DMG appear on both main and sub pools and
 * that is correct -- a Circlet can have CRIT DMG as its main while a feather
 * rolls CRIT Rate as a sub.
 */
export const SUB_STATS = [
  'hp', 'atk', 'def',
  'hpPct', 'atkPct', 'defPct',
  'em', 'er', 'critRate', 'critDmg',
];

/** How many substats an artifact can carry. */
export const SUB_COUNT = 4;

/** Artifact levels: +0 to +20 in steps of 4 (the game's breakpoints). */
export const ARTIFACT_LEVEL_MIN = 0;
export const ARTIFACT_LEVEL_MAX = 20;
export const ARTIFACT_LEVEL_STEP = 4;

/**
 * A main stat's value at `level`, or `null` when it cannot be determined.
 *
 * The curves live in `artifact-curves.js`, one per stat -- they are NOT one
 * shared percentage curve. Defense% runs 8.7 -> 58.3 where HP% runs 7.0 -> 46.6,
 * Energy Recharge 7.8 -> 51.8, Healing 5.4 -> 35.9, and Physical DMG follows
 * Defense% rather than the elemental curve. Collapsing them into a single curve
 * gave wrong numbers for five of the thirteen stats.
 *
 * Returning `null` rather than guessing is deliberate: a wrong number in a
 * damage calculator is worse than an empty field.
 */
export function mainStatValue(stat, level) {
  return curveValue(stat, level);
}

/**
 * A substat's value as a number, tolerating the strings a text input produces.
 *
 * Returns `null` for an unparsable value so a half-typed entry is preserved as
 * typed rather than silently becoming 0 in the model.
 */
export function subValue(sub) {
  if (!sub) return null;
  const n = parseFloat(String(sub.value).replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * A blank slot: nothing chosen at all.
 *
 * "BLANK" MEANS EMPTY, NOT PREFILLED. This used to seed the slot's first legal
 * main stat at +20, so a brand-new build arrived showing 4780 HP, 311 ATK,
 * 46.6% -- numbers that LOOK entered and are silently included in any damage
 * total built from them. Nothing had been chosen and nothing had been levelled;
 * the values were a display convenience that became real data.
 *
 *   mainStat  null   no main stat yet; the UI shows a `+` like a substat row
 *   level     0      nothing has been levelled, and the control is meaningless
 *                    until a main stat exists
 *   subStats  nulls  empty rows, as before
 *
 * `setId` stays null: the slot has no set until one is picked, and that already
 * meant "unset" rather than "a default set".
 */
export const blankPiece = () => ({
  setId: null,
  mainStat: null,
  level: 0,
  // `null` means "empty row", not "a stat with no value" -- the UI shows a `+`
  // there instead of a stat until one is chosen.
  subStats: Array(SUB_COUNT).fill(null),
});

/** All five slots blank. */
export const blankSet = () =>
  Object.fromEntries(SLOTS.map((s) => [s.key, blankPiece()]));

/* --------------------------------------------------------------- derivation */

/** How many of the five slots share each set, for the 2-pc / 4-pc readout. */
export function countBySet(build) {
  const counts = {};
  for (const slot of SLOTS) {
    const id = build?.[slot.key]?.setId;
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

/** Which set bonuses are active: 2-piece and 4-piece, per set. */
export function activeBonuses(build) {
  const counts = countBySet(build);
  const out = [];
  for (const [setId, n] of Object.entries(counts)) {
    if (n >= 2) out.push({ setId, pieces: 2 });
    if (n >= 4) out.push({ setId, pieces: 4 });
  }
  return out;
}

/** Replace one slot of a build, returning a new build. */
export const withPiece = (build, slotKey, piece) => ({ ...build, [slotKey]: piece });

/**
 * Replace one substat row of a piece, returning a new piece.
 *
 * The array is re-indexed to `SUB_COUNT` entries, so a piece loaded from
 * somewhere else with a short `subStats` array cannot produce a ragged model.
 */
export function withSubstat(piece, index, sub) {
  const next = Array.from({ length: SUB_COUNT }, (_, i) => piece.subStats[i] ?? null);
  next[index] = sub;
  return { ...piece, subStats: next };
}

/** No two substats may repeat on one piece; the main stat is exclusive too. */
export const substatOptionsFor = (piece) => SUB_STATS.filter((s) => s !== piece?.mainStat);

/* ------------------------------------------------------------------- totals */

/**
 * The ORDER a summary lists stats in: the panel order, flats first and the
 * element bonuses last, so a total does not jump around as stats are added.
 */
export const TOTAL_ORDER = [
  'hp', 'atk', 'def',
  'hpPct', 'atkPct', 'defPct',
  'em', 'er', 'critRate', 'critDmg', 'healBonus',
  ...DMG_ELEMENTS.map((e) => `${e}Dmg`),
  'physBonus',
];

/**
 * Every artifact stat on a build, SUMMED BY STAT KEY.
 *
 * The main stat and the substats are added the same way; they differ only in
 * where the number comes from -- a main stat is derived from the piece's level
 * through the curve, a substat is whatever the user typed. This is the same
 * reading `stat-derive.artifactTotals` makes, stopped one step earlier: it keeps
 * the ARTIFACT keys (`hp` = flat HP) rather than mapping them onto the damage
 * panel's keys, because a summary of "what my pieces rolled" is exactly that
 * vocabulary and not the panel's.
 *
 * A zero or unparsable value contributes nothing, so a half-typed substat never
 * shows up as a real total. Returned as a plain `{ key: value }` map; the caller
 * decides what to show and in what order (see `TOTAL_ORDER`).
 */
export function artifactStatTotals(build) {
  const totals = {};
  const bump = (key, value) => {
    if (!key || !Number.isFinite(value) || value === 0) return;
    totals[key] = (totals[key] || 0) + value;
  };

  for (const slot of SLOTS) {
    const piece = build?.[slot.key];
    if (!piece) continue;

    if (piece.mainStat) {
      bump(piece.mainStat, mainStatValue(piece.mainStat, piece.level ?? ARTIFACT_LEVEL_MAX));
    }
    for (const sub of piece.subStats || []) {
      if (!sub?.key) continue;
      bump(sub.key, subValue(sub));
    }
  }

  return totals;
}
