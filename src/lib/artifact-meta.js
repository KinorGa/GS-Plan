// Presentation metadata for artifact stats and slots.
//
// Separated from `artifact-model.js` because none of this is a rule of the
// game: it is how the row PICTS a stat -- which file holds its glyph, which
// slot name it carries, and what number a newly added substat should start at.
// A future stat calculator wants the model and not this file; the row wants
// both.
//
// `STAT_META` (the `{ chs, en, suffix }` labels) is NOT redefined here: it lives
// in `components/buff-model.js` and is shared with the buff cards, so both views
// name a stat identically. `statMeta()` extends it with the per-element goblet
// keys, which the buff cards have no reason to know about.

import { STAT_META } from '../components/buff-model';
import { DEFAULT_RARITY, nearestLegal } from './substat-rolls';
import { ELEMENT_OF_DMG_KEY } from './artifact-model';

/* --------------------------------------------------------------------- slots */

/**
 * Slot names, in game wording.
 *
 * The row normally draws these from the piece's own name once a set is chosen,
 * and falls back to this while the slot is empty.
 */
export const SLOT_LABEL = {
  flower: { chs: '生之花', en: 'Flower of Life' },
  plume: { chs: '死之羽', en: 'Plume of Death' },
  sands: { chs: '时之沙', en: 'Sands of Eon' },
  goblet: { chs: '空之杯', en: 'Goblet of Eonothem' },
  circlet: { chs: '理之冠', en: 'Circlet of Logos' },
};

/* --------------------------------------------------------------- stat glyphs */

/**
 * The glyph file for each stat.
 *
 * `img/icons/` ships two variants for HP/ATK/DEF, and the naming is the
 * opposite of what it looks like (verified by rendering them side by side):
 *
 *   hp.webp        a droplet WITH a % mark  -> the PERCENTAGE stat
 *   hp_base.webp   a plain droplet          -> the FLAT stat
 *
 * so `_base` is the flat value and the bare name is the percentage. Mapping
 * these the other way round is not visible as a bug -- both are a droplet --
 * which is exactly why it is worth stating here.
 */
export const STAT_ICONS = {
  hp: 'hp_base',        // flat HP
  atk: 'atk_base',      // flat ATK
  def: 'def_base',      // flat DEF
  hpPct: 'hp',          // HP%
  atkPct: 'atk',        // ATK%
  defPct: 'def',        // DEF%
  em: 'em',
  er: 'er',
  critRate: 'critrate',
  critDmg: 'critdmg',
  physBonus: 'physical',
  healBonus: 'healing',
  // Each element has its OWN glyph, so a goblet shows the element it actually
  // rolls. A single `dmgBonus: 'pyro'` entry used to stand in for all of them,
  // which drew a flame on every goblet, including Hydro and Physical ones.
  pyroDmg: 'pyro',
  hydroDmg: 'hydro',
  cryoDmg: 'cryo',
  electroDmg: 'electro',
  anemoDmg: 'anemo',
  geoDmg: 'geo',
  dendroDmg: 'dendro',
  // Kept for the generic field the damage card and the buff pool use, where the
  // element genuinely is unknown.
  dmgBonus: 'pyro',
};

/* ----------------------------------------------------- element DMG labels */

/** Display name per element, for a goblet's main stat. */
const ELEMENT_LABEL = {
  pyro: { chs: '火元素伤害加成', en: 'Pyro DMG Bonus' },
  hydro: { chs: '水元素伤害加成', en: 'Hydro DMG Bonus' },
  cryo: { chs: '冰元素伤害加成', en: 'Cryo DMG Bonus' },
  electro: { chs: '雷元素伤害加成', en: 'Electro DMG Bonus' },
  anemo: { chs: '风元素伤害加成', en: 'Anemo DMG Bonus' },
  geo: { chs: '岩元素伤害加成', en: 'Geo DMG Bonus' },
  dendro: { chs: '草元素伤害加成', en: 'Dendro DMG Bonus' },
};

/**
 * Label and suffix for an artifact stat key.
 *
 * Falls back to `STAT_META` (the table shared with the buff cards) and then, for
 * the per-element goblet keys, to a derived label -- so a new element needs one
 * entry in `DMG_ELEMENTS` and nothing else.
 */
export function statMeta(key) {
  if (STAT_META[key]) return STAT_META[key];
  const element = ELEMENT_OF_DMG_KEY[key];
  if (element) return { ...ELEMENT_LABEL[element], suffix: '%' };
  return { chs: key, en: key };
}

/* ---------------------------------------------------------- substat defaults */

/**
 * Per-stat input hints for SUBSTATS: a sensible starting value and a step.
 *
 * There is no upstream table for these -- an artifact piece's data carries only
 * `{ icon, name }`, with no stat values at all, because the values depend on
 * the roll rather than the item. So the numbers are the USER'S, and these are
 * only defaults: the midpoint of a 5-star roll so a newly added substat starts
 * at a plausible figure instead of 0.
 *
 * The step is roughly a quarter of the range, which is one roll increment.
 *
 * Main stats do NOT use these: their value is a function of (stat, level) and
 * comes from `mainStatValue` instead.
 */
export const STAT_HINTS = {
  hp: { start: 239, step: 30 },
  atk: { start: 16, step: 3 },
  def: { start: 19, step: 4 },
  hpPct: { start: 4.7, step: 1 },
  atkPct: { start: 4.7, step: 1 },
  defPct: { start: 5.8, step: 1 },
  em: { start: 19, step: 4 },
  er: { start: 5.2, step: 1 },
  critRate: { start: 3.1, step: 0.5 },
  critDmg: { start: 6.2, step: 1 },
};

/**
 * A new substat entry for `stat`: `{ key, value }`, never a bare key.
 *
 * The starting value is SNAPPED to the nearest LEGAL total for the piece's
 * rarity, because `STAT_HINTS` is only a rough midpoint and the game cannot
 * actually produce most of those numbers. Starting on an illegal value would
 * show the field flagged the moment a row is added.
 */
export const newSubstat = (stat, rarity = DEFAULT_RARITY) => ({
  key: stat,
  value: nearestLegal(stat, rarity, STAT_HINTS[stat]?.start ?? 0)?.value
    ?? STAT_HINTS[stat]?.start ?? 0,
});

/* ------------------------------------------------------------------ display */

/** Trim a float to at most one decimal for display: 46.6%, 4780, 6.2%. */
export const formatStat = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
