// Damage card: a wide, single-row breakdown of one hit.
//
//   [ portrait ] [ source + stage menu ] [ full stat sheet ] [ damage type ]
//
// The stat column exposes EVERY value that feeds the damage formula, so a
// heavily-buffed setup can be read at a glance instead of guessing which
// numbers matter.

import { useEffect, useMemo, useRef, useState } from 'react';
import { iconImg, talentIconImg, elementOf, ICON_WHITE } from './game';
import CharacterArt from './components/CharacterArt.jsx';
import { useI18n } from './i18n';
import { foldBuffs, mergeStats } from './components/buff-model';
import { computeDamage } from './lib/damage';
import { DAMAGE_TYPES, KEY_SUFFIX, TYPE_ZH as ELEMENT_ZH } from './lib/elements';
import { stageMultiplierText } from './char-sources';

// Default character the card falls back to. Kept in one place so the portrait
// component gets exactly the fields it needs (element, weapon, names).
//
// Pass a different one via the `char` prop to reuse the card for another
// character; the talent rows below are still Odette's, so a full swap also
// means supplying matching `sources`.
export const ODETTE_CHAR = {
  chsName: '奥黛塔',
  enName: 'Odette',
  element: 'Cryo',
  weaponType: 'WEAPON_SWORD_ONE_HAND',
};

/* ------------------------------------------------------------------ data */

// Odette (10000150) - talent rows taken from the public API's
// /data/7.1.0/chs/char/10000150.json ; `mult` is the Lv.10 value.
const SOURCES = [
  {
    key: 'normal',
    kind: 'normal',
    icon: 'Skill_A_01',
    chs: '普通攻击·雪鹄变奏',
    en: 'Normal Attack: Snow Swan Variation',
    element: 'Physical',
    stages: [
      { chs: '一段伤害', en: '1-Hit DMG', mult: 1.0251, hits: 1 },
      { chs: '二段伤害', en: '2-Hit DMG', mult: 1.0182, hits: 1 },
      { chs: '三段伤害', en: '3-Hit DMG', mult: 0.6446, hits: 2 },
      { chs: '四段伤害', en: '4-Hit DMG', mult: 1.4741, hits: 1 },
      { chs: '五段伤害', en: '5-Hit DMG', mult: 1.7833, hits: 1 },
      { chs: '重击伤害', en: 'Charged Attack DMG', mult: 2.1233, hits: 1 },
      { chs: '下坠期间伤害', en: 'Plunge DMG', mult: 1.2638, hits: 1 },
      { chs: '低空/高空坠地冲击伤害', en: 'Low/High Plunge DMG', mult: 2.527, hits: 1 },
    ],
  },
  {
    key: 'skill',
    kind: 'skill',
    icon: 'Skill_S_Odette_01',
    chs: '元素战技·柔板·幻灵夜舞',
    en: 'Elemental Skill: Adagio - Phantasmal Nocturne',
    element: 'Cryo',
    stages: [
      { chs: '技能伤害', en: 'Skill DMG', mult: 1.9454, hits: 1 },
      { chs: '破晓终奏持续伤害', en: 'Finale DoT', mult: 1.7251, hits: 1 },
      { chs: '破晓终奏星超导伤害', en: 'Finale Stellar Superconduct', mult: 5.5037, hits: 1 },
      { chs: '拂羽舞步伤害', en: 'Feather Step DMG', mult: 0.7747, hits: 1 },
      { chs: '旋翼舞步伤害', en: 'Rotor Step DMG', mult: 0.9264, hits: 1 },
    ],
  },
  {
    key: 'burst',
    kind: 'burst',
    icon: 'Skill_E_Odette_01',
    chs: '元素爆发·疾板·苍羽一梦',
    en: 'Elemental Burst: Presto - Azure Plumage Dream',
    element: 'Cryo',
    stages: [
      { chs: '斩击伤害', en: 'Slash DMG', mult: 1.9832, hits: 3 },
      { chs: '斩击最终段伤害', en: 'Final Slash DMG', mult: 3.0649, hits: 1 },
    ],
  },
  {
    key: 'const',
    kind: 'constellation',
    icon: 'UI_Talent_S_Odette_04',
    chs: '命之座 6·触及苍穹永恒的面容',
    en: 'Constellation 6: Touching the Sky',
    element: 'Cryo',
    // C6 buffs the burst by 25% (params[0] of const6).
    stages: [
      { chs: '星烁增幅后斩击', en: 'Empowered Slash', mult: 1.9832, hits: 3, bonus: 0.25 },
      { chs: '星烁增幅最终段', en: 'Empowered Final Slash', mult: 3.0649, hits: 1, bonus: 0.25 },
    ],
  },
  {
    key: 'passive',
    kind: 'passive',
    icon: 'UI_Talent_S_Odette_07',
    chs: '固有天赋·星耀祝礼',
    en: 'Passive: Stellar Blessing',
    element: 'Cryo',
    stages: [
      { chs: '星烁反应伤害提升', en: 'Stellar Reaction Bonus', mult: 0.5, hits: 1 },
      { chs: '星超导附加伤害', en: 'Stellar Superconduct Add-on', mult: 0.4864, hits: 1 },
    ],
  },
];

const SOURCE_LABEL = {
  normal: { chs: '普通攻击', en: 'Normal Attack' },
  skill: { chs: '元素战技', en: 'Elemental Skill' },
  burst: { chs: '元素爆发', en: 'Elemental Burst' },
  constellation: { chs: '命之座', en: 'Constellation' },
  passive: { chs: '固有天赋', en: 'Passive Talent' },
};

// Reactions.
//
// Only Vaporize and Melt are AMPLIFYING: the multiplier depends on which
// element triggers the reaction (x2.0 / x1.5), so they carry a direction and
// are drawn as `from -> to`.
//
// Every other reaction is TRANSFORMATIVE: it deals its own flat base damage
// that does not depend on the triggering order, so showing an arrow would
// imply a distinction that does not exist. Those are drawn as two neutral
// element icons joined by "+" (the required element pair).
const REACTIONS = [
  { key: 'none', chs: '直伤', en: 'Direct', base: 1, amp: false },

  // --- amplifying (directional) ---
  { key: 'vaporize', chs: '蒸发', en: 'Vaporize', base: 2.0, amp: true, from: 'hydro', to: 'pyro', note: { chs: '水→火 ×2.0', en: 'Hydro to Pyro x2.0' } },
  { key: 'vaporize_rev', chs: '蒸发', en: 'Vaporize', base: 1.5, amp: true, from: 'pyro', to: 'hydro', note: { chs: '火→水 ×1.5', en: 'Pyro to Hydro x1.5' } },
  { key: 'melt', chs: '融化', en: 'Melt', base: 2.0, amp: true, from: 'pyro', to: 'cryo', note: { chs: '火→冰 ×2.0', en: 'Pyro to Cryo x2.0' } },
  { key: 'melt_rev', chs: '融化', en: 'Melt', base: 1.5, amp: true, from: 'cryo', to: 'pyro', note: { chs: '冰→火 ×1.5', en: 'Cryo to Pyro x1.5' } },

  // --- transformative (no direction) ---
  { key: 'superconduct', chs: '超导', en: 'Superconduct', base: 1, amp: false, transformative: true, pair: ['cryo', 'electro'] },
  { key: 'swirl', chs: '扩散', en: 'Swirl', base: 1, amp: false, transformative: true, pair: ['anemo', 'pyro'] },
  { key: 'electrocharged', chs: '感电', en: 'Electro-Charged', base: 1, amp: false, transformative: true, pair: ['hydro', 'electro'] },
  { key: 'frozen', chs: '冻结', en: 'Frozen', base: 1, amp: false, transformative: true, pair: ['cryo', 'hydro'] },
  { key: 'overloaded', chs: '超载', en: 'Overloaded', base: 1, amp: false, transformative: true, pair: ['pyro', 'electro'] },
  { key: 'burning', chs: '燃烧', en: 'Burning', base: 1, amp: false, transformative: true, pair: ['pyro', 'dendro'] },
  { key: 'quicken', chs: '原激化', en: 'Quicken', base: 1, amp: false, transformative: true, pair: ['dendro', 'electro'] },
  { key: 'bloom', chs: '绽放', en: 'Bloom', base: 1, amp: false, transformative: true, pair: ['dendro', 'hydro'] },
  { key: 'crystallize', chs: '结晶', en: 'Crystallize', base: 1, amp: false, transformative: true, pair: ['geo', 'pyro'] },
];

/**
 * Resolve a stored reaction KEY to its row.
 *
 * Exported so a host that stores only the key -- the planner keeps
 * `entry.reactionKey` so a collapse cannot lose it -- can rebuild the object the
 * formula wants without a second copy of this table. An unknown or absent key is
 * 直伤, which is the same fallback the card uses for its own state.
 */
export const reactionByKey = (key) =>
  REACTIONS.find((r) => r.key === key) || REACTIONS[0];

// Every stat that participates in the damage formula. All are shown, always.
// `kind: 'flat' | 'pct'` only affects the suffix and the default step.
// Exported so a host that CONTROLS the panel (the planner) can seed an entry
// with exactly the defaults the card would have used on its own, and so a
// collapsed row can recompute from the same numbers. Duplicating these values
// is what let the row and the card disagree before.
//
// ICON NAMING IS INVERTED. Rendering the files side by side shows that
// `hp.webp` carries a large `%` mark while `hp_base.webp` is the plain droplet,
// so the BARE name is the percentage stat and `_base` is the flat one. These
// three rows are the flat values, so they take the `_base` glyphs, and the
// `*Pct` rows below take the bare ones. Getting this backwards is invisible in
// isolation because both are the same droplet.
export const STAT_DEFS = [
  { key: 'hp', chs: '生命值', en: 'HP', icon: 'hp_base', def: 12981, step: 500, group: 'base' },
  { key: 'atk', chs: '攻击力', en: 'ATK', icon: 'atk_base', def: 335, step: 50, group: 'base' },
  { key: 'def', chs: '防御力', en: 'DEF', icon: 'def_base', def: 787, step: 50, group: 'base' },

  // The FLAT additions, which sit outside the percentage in the formula
  // (`base * (1 + pct) + flat`). A +20 flower alone grants 4780 here, so they are
  // not a rounding detail -- folding them into the base above would scale them by
  // HP% and overstate the total by roughly 10%.
  //
  // Grouped with the base rows because they are the same kind of quantity (a raw
  // number, not a percentage), and labelled 固定 to separate them from the row
  // directly above, which they would otherwise look identical to.
  { key: 'flatHp', chs: '固定生命值', en: 'Flat HP', icon: 'hp_base', def: 0, step: 100, group: 'base' },
  { key: 'flatAtk', chs: '固定攻击力', en: 'Flat ATK', icon: 'atk_base', def: 0, step: 10, group: 'base' },
  { key: 'flatDef', chs: '固定防御力', en: 'Flat DEF', icon: 'def_base', def: 0, step: 10, group: 'base' },

  { key: 'hpPct', chs: '生命值加成', en: 'HP%', icon: 'hp', suffix: '%', def: 0, step: 5, group: 'pct' },
  { key: 'atkPct', chs: '攻击力加成', en: 'ATK%', icon: 'atk', suffix: '%', def: 0, step: 5, group: 'pct' },
  { key: 'defPct', chs: '防御力加成', en: 'DEF%', icon: 'def', suffix: '%', def: 0, step: 5, group: 'pct' },
  { key: 'em', chs: '元素精通', en: 'Elemental Mastery', icon: 'em', def: 0, step: 20, group: 'pct' },
  // 5 and 50 are the game's BASE values, and the formula reads these two as
  // TOTALS (`1 + rate * dmg`). The old default of `critDmg: 38.4` was Varka's
  // ascension BONUS used as a total, which made every character's crit
  // multiplier about 2.4% low.
  { key: 'critRate', chs: '暴击率', en: 'CRIT Rate', icon: 'critrate', suffix: '%', def: 5, step: 5, group: 'pct' },
  { key: 'critDmg', chs: '暴击伤害', en: 'CRIT DMG', icon: 'critdmg', suffix: '%', def: 50, step: 10, group: 'pct' },
  { key: 'er', chs: '元素充能效率', en: 'Energy Recharge', icon: 'er', suffix: '%', def: 100, step: 10, group: 'pct' },

  // THE SEVEN ELEMENTS, EACH ITS OWN FIELD AND ITS OWN GLYPH.
  //
  // There used to be a single 元素伤害加成 whose icon was a hardcoded flame, so a
  // Cryo character's panel showed fire next to a Cryo number. Splitting them also
  // makes the panel able to HOLD two element bonuses at once, which the old
  // single field could not: the derivation had to discard a mismatched goblet
  // rather than record it.
  { key: 'pyroDmg', chs: '火元素伤害', en: 'Pyro DMG', icon: 'pyro', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'hydroDmg', chs: '水元素伤害', en: 'Hydro DMG', icon: 'hydro', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'cryoDmg', chs: '冰元素伤害', en: 'Cryo DMG', icon: 'cryo', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'electroDmg', chs: '雷元素伤害', en: 'Electro DMG', icon: 'electro', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'anemoDmg', chs: '风元素伤害', en: 'Anemo DMG', icon: 'anemo', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'geoDmg', chs: '岩元素伤害', en: 'Geo DMG', icon: 'geo', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'dendroDmg', chs: '草元素伤害', en: 'Dendro DMG', icon: 'dendro', suffix: '%', def: 0, step: 5, group: 'dmg' },

  // The GENERIC bonus, kept separate from the seven above.
  //
  // Some buffs grant "DMG" without naming an element, and the action-specific
  // keys (`normalDmg`, `skillDmg`…) land here too because they are not tied to an
  // element either. Without this field those buffs would merge onto a key the
  // formula no longer reads and silently stop counting -- a wrong number, not a
  // missing one. It ADDS to whichever element the hit uses rather than standing
  // in for one.
  { key: 'dmgBonus', chs: '通用伤害加成', en: 'All DMG Bonus', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'physBonus', chs: '物理伤害加成', en: 'Physical DMG Bonus', icon: 'physical', suffix: '%', def: 0, step: 5, group: 'dmg' },
  { key: 'reactionBonus', chs: '反应伤害提升', en: 'Reaction DMG Bonus', suffix: '%', def: 0, step: 5, group: 'dmg' },
  // 附加伤害值 is not a stat the character HOLDS: it is a flat sum a buff adds
  // to the hit after the talent multiplier (尼可's C4 is the example), so it
  // carries no `%` and sits with the damage fields rather than the base rows.
  { key: 'flatDmg', chs: '附加伤害值', en: 'Flat DMG', def: 0, step: 100, group: 'dmg' },

  { key: 'defShred', chs: '防御降低', en: 'DEF Shred', suffix: '%', def: 0, step: 5, group: 'enemy' },
  { key: 'defIgnore', chs: '无视防御', en: 'DEF Ignore', suffix: '%', def: 0, step: 5, group: 'enemy' },
  { key: 'enemyLevel', chs: '敌人等级', en: 'Enemy Level', def: 100, step: 5, group: 'enemy', noSign: true },
  { key: 'talentBonus', chs: '天赋倍率加成', en: 'Talent Bonus', suffix: '%', def: 0, step: 5, group: 'enemy' },

  // RESISTANCE, PER DAMAGE TYPE. One field each for the eight types a hit can
  // carry, built from `DAMAGE_TYPES` so Physical cannot be forgotten -- the same
  // omission that left it off the artifact goblet list.
  //
  // THE TWO SIDES ARE NOT SYMMETRIC, and the difference matters:
  //
  //   * Enemy RES is a property of the ENEMY and one value applies per element.
  //     Nothing stacks -- two sources cannot both set "the enemy's Pyro RES" --
  //     so there is no generic field, and each defaults to 10%.
  //
  //   * RES SHRED is granted by the PLAYER and several sources genuinely ADD
  //     together (a 4-pc set and a shield both reducing resistance). So the
  //     generic `resShred` is kept and STILL COUNTS, on top of the hit's own
  //     element: 钟离's shield is -20% to every resistance and has no single
  //     element to be filed under.
  //
  //     That is also the anti-regression choice. A buff key stays `resShred`
  //     until a human re-points it at an element; if the generic field stopped
  //     feeding the formula, every such card would go on displaying +40% while
  //     contributing nothing -- the silent-degradation failure this codebase
  //     keeps producing.
  //
  // A hit reads its OWN type's field plus the generic shred (`lib/damage.js`).
  //
  // THE SPREADS BELOW ARE EVALUATED AT MODULE LOAD, so everything they touch must
  // already be initialised. That is not a style point: a helper defined as a
  // `const` arrow further down the file put this array in the temporal dead zone
  // and took the WHOLE CARD down with "Cannot access 'elementZh' before
  // initialization" -- React unmounted the page, and every browser check just
  // found no buttons. `ELEMENT_ZH` therefore comes from `lib/elements.js`, which
  // has no dependency on this module.
  { key: 'resShred', chs: '全抗性降低', en: 'All RES Shred', suffix: '%', def: 0, step: 5, group: 'enemy' },
  ...DAMAGE_TYPES.map((t) => ({
    key: `resShred${KEY_SUFFIX[t]}`,
    chs: `${ELEMENT_ZH[t]}抗性降低`,
    en: `${KEY_SUFFIX[t]} RES Shred`,
    icon: t,
    suffix: '%', def: 0, step: 5, group: 'enemy',
  })),
  ...DAMAGE_TYPES.map((t) => ({
    key: `enemyRes${KEY_SUFFIX[t]}`,
    chs: `${ELEMENT_ZH[t]}抗性`,
    en: `${KEY_SUFFIX[t]} RES`,
    icon: t,
    suffix: '%', def: 10, step: 5, group: 'enemy',
  })),
];

const GROUP_LABEL = {
  base: { chs: '基础面板', en: 'Base Stats' },
  pct: { chs: '属性加成', en: 'Stat Bonuses' },
  dmg: { chs: '伤害加成', en: 'DMG Bonuses' },
  enemy: { chs: '敌方 / 其他', en: 'Enemy & Other' },
};

/**
 * A fresh stat panel at its documented defaults.
 *
 * Both the card's own initial state and a controlling host's seed come from
 * here, so "the panel before the user types anything" means one thing. The
 * collapsed-row recompute relies on this being identical to what the card
 * would have used.
 */
export const defaultStats = () =>
  Object.fromEntries(STAT_DEFS.map((d) => [d.key, d.def]));

/**
 * Which glyph file an element's name maps to, in the CAPITALISED spelling the
 * data uses (`'Cryo'`). `ElementIcon` capitalises before it looks up, so a
 * caller holding an already-lowercase key must capitalise it too.
 *
 * `Physical` is deliberately NOT a key here. It is not an element: it has its
 * own `physBonus`/`enemyResPhysical` handling and its own glyph, and
 * `ElementIcon` picks that glyph by testing for the literal `'physical'` first.
 * An entry for it in this map could only ever be reached by a caller passing the
 * word that the test above already handles, which is how the wrong reading
 * (`Physical` -> the ATK icon) stayed plausible for so long.
 */
const ELEMENT_FOR_ICON = {
  Cryo: 'cryo',
  Pyro: 'pyro',
  Hydro: 'hydro',
  Electro: 'electro',
  Anemo: 'anemo',
  Geo: 'geo',
  Dendro: 'dendro',
};

// Icon tint per element, matching the values the original site uses.
const TINT = {
  cryo: 'rgb(153,255,255)',
  pyro: 'rgb(255,153,153)',
  hydro: 'rgb(128,192,255)',
  electro: 'rgb(255,172,255)',
  anemo: 'rgb(128,255,215)',
  geo: 'rgb(255,230,153)',
  dendro: 'rgb(153,255,136)',
};

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------- component */

/**
 * A wide, single-row breakdown of one hit.
 *
 * Self-contained: pass it a character and it needs nothing else from the host
 * app except React and Tailwind being present. All the props are optional.
 *
 * @param {object}  [props.char]          Character record for the portrait
 *                                        (element, weaponType, names).
 *                                        Defaults to ODETTE_CHAR.
 * @param {string}  [props.characterId]   Portrait image id.
 * @param {string}  [props.charName]      Overrides the name shown on the art.
 * @param {Array}   [props.sources]       Talent source rows (see SOURCES).
 * @param {Array}   [props.statDefs]      Stat field definitions (see STAT_DEFS).
 * @param {object}  [props.injectedTotals] Buff totals ALREADY folded per panel
 *                                        key, so a field can show the "+28%"
 *                                        that came from a dropped card beside
 *                                        the number the user typed. Display
 *                                        only: the totals are merged into the
 *                                        panel by whoever owns it, so passing
 *                                        the same buffs again as
 *                                        `injectedBuffs` would count them twice.
 * @param {string}  [props.className]     Extra classes on the root element.
 * @param {Array}   [props.injectedBuffs] External buff instances folded into the
 *                                        stat sheet (see the planner). Each is
 *                                        `{ key, value }`; they are ADDED on top
 *                                        of the user's own edits, so the card's
 *                                        manual inputs still work and the card
 *                                        stays self-contained when the prop is
 *                                        omitted.
 * @param {Function} [props.onSummary]    Called with
 *                                        `{ source, stage, reaction, perHit, total }`
 *                                        whenever the current selection or the
 *                                        computed damage changes. Lets a host
 *                                        render a collapsed summary row without
 *                                        duplicating the card's own calculation
 *                                        or lifting its state.
 */
export default function DamageCard({
  characterId = '10000150',
  charName,
  char = ODETTE_CHAR,
  sources = SOURCES,
  statDefs = STAT_DEFS,
  className = '',
  // The ATTACKER's level, read from the character. It is a term in the defence
  // zone -- `(100 + atkLevel) / (100 + atkLevel + (100 + enemyLevel) * factor)` --
  // and leaving it out pinned that term at the formula's 90 default, so the panel
  // scaled with the character's level while the defence zone did not. Defaults to
  // 90 for the standalone page, whose hardcoded data assumes it.
  atkLevel: atkLevelProp = null,
  onSummary,
  injectedBuffs = null,
  injectedTotals: injectedTotalsProp = null,
  stats: statsProp,
  // The panel to COMPUTE the damage from, when it differs from the panel to
  // DISPLAY. A controlled host passes its buff-merged panel here and the unmerged
  // one as `stats`; see the note at the merge below. Undefined for a standalone
  // card, which merges `injectedBuffs` itself.
  computeStats: computeStatsProp = null,
  onStatsChange,
  onStatEdit,
  onStatReset,
  overridden = null,
  partIndex: partIndexProp = null,
  element: elementProp = null,
  // THE ROW'S PARTS, when the HOST knows them better than the table does.
  //
  // An imported gcsim row carries its own coefficients and hit counts (see
  // `axis-compute.computePart`): 法尔伽's 狂飙突进 runs at 220% of the table
  // value, and a multi-part skill fires several coefficients the table holds at
  // once. Without this the card re-read the LOCAL table, computed from part 0,
  // and then REPORTED that reading back -- which rebuilt the row's children and
  // threw the imported ones away. Passing the host's parts keeps the card, the
  // row and the report agreeing.
  partsOverride = null,
  // GCSIM'S OWN NUMBERS for this row, when the importer pinned them.
  //
  // `scaling` is `{ mult?, hits? }` -- the exact coefficient and hit count the
  // imported run logged, which the local talent table cannot express (法尔伽's
  // 狂飙突进 runs at 220% of the table value). Either field may be absent, in
  // which case the table's value stands; that is why it is applied PER FIELD
  // below rather than replacing the part wholesale. It is separate from
  // `partsOverride`, which says HOW MANY parts the row has: this only changes
  // the numbers of the part being computed.
  scaling = null,
  // WHICH HIT this card is showing, when a host owns that choice.
  //
  // A CHILD of a compound row must show the row its PARENT selected. The card's
  // own `sourceKey`/`stageIdx` state starts at the normal attack's first stage, so
  // an uncontrolled child ignored the parent entirely: both children rendered
  // `一段伤害` and, once each was pinned to a different `partIndex` of THAT row,
  // they agreed on a number that had nothing to do with the skill. Measured.
  //
  // Undefined for an ordinary card, so the standalone page and a plain entry keep
  // their own state exactly as before.
  sourceKey: sourceKeyProp = null,
  stageIndex: stageIndexProp = null,
  onPick: onPickProp = null,
  // A CHILD of a compound row may not re-pick the row: its parent owns that, and
  // letting a child change it would leave its siblings describing parts that no
  // longer exist. See `stageMenuEnabled`.
  stageLocked = false,
  /**
   * The critical-hit mode the host has stored, if any: 'never' | 'avg' | 'crit'.
   *
   * SEEDED, NOT OWNED. Collapsing an entry unmounts this card, so `critMode` as
   * plain local state was lost on every collapse and came back as 'avg' -- pick
   * 必定暴击, collapse, expand, and the number silently dropped from a crit to an
   * average. The card already REPORTS `critMode` in its summary; this is the
   * missing other half, the prop that reads it back.
   *
   * `null` for the standalone page and for an entry that has never been touched,
   * which keeps the card's own 'avg' default.
   */
  critMode: critModeProp = null,
  // Called when the user changes it, so the host can record the choice. A no-op is
  // fine -- the card still switches for this mount.
  onCritModeChange = null,
  /**
   * The same two halves for the REACTION, which had the identical defect: the card
   * reported `reactionKey` but nothing ever read it back, so collapsing an entry
   * reset 融化/蒸发 to 无反应 along with it.
   */
  reactionKey: reactionKeyProp = null,
  onReactionChange = null,
  /**
   * The user's own INDEPENDENT MULTIPLIER ZONE, already folded by the host (see
   * `buff-model.foldCustomZones` -- same name merges, per entry).
   *
   * `1` by default, so a card whose buffs are all known stat keys is arithmetically
   * unchanged: multiplying by 1 is a no-op.
   */
  zoneMult = 1,
  // Draw the SOURCE COLUMN AND NOTHING ELSE.
  //
  // For the parent of a compound row, whose only job is to change which skill and
  // stage the entry holds. It was mounted as a whole card first, and that buried
  // the one control it exists for under the art, all 19 stat fields, the damage
  // type and the result panel -- every one of them inert there, since the parent
  // owns no stats and folds no buffs. The picker offered a page of things that did
  // nothing around the two that did.
  sourceOnly = false,
}) {
  const { lang, L } = useI18n();

  const [ownSourceKey, setOwnSourceKey] = useState('normal');
  const [ownStageIdx, setOwnStageIdx] = useState(0);
  const sourceKey = sourceKeyProp ?? ownSourceKey;
  const stageIdx = stageIndexProp ?? ownStageIdx;
  const setStageIdx = (i) => (stageIndexProp != null ? onPickProp?.(sourceKey, i) : setOwnStageIdx(i));

  /**
   * CHOOSING A SOURCE IS ONE SELECTION, NOT TWO.
   *
   * Picking a source always resets the stage to 0, so this used to be
   * `setSourceKey(k); setStageIdx(0);`. That is correct only while the card owns
   * its own state, where both writes are queued against the same render and land
   * together. Under a CONTROLLED card both calls go out through `onPick`, and the
   * second one reads `sourceKey` from the CURRENT PROPS -- which still hold the
   * OLD source, because the parent has not re-rendered yet. So the pair arrived as
   * `onPick(newKey, 0)` followed by `onPick(oldKey, 0)`, and the host stored the
   * OLD source: the menu visibly jumped to the new skill while the axis kept the
   * old one, and the split was rebuilt from a row the user had just navigated away
   * from. Measured -- choosing 普通攻击 recorded `elementalskill`.
   *
   * So the new source and its reset stage are sent as a single pair, which is what
   * they are. `setStageIdx` stays for the stage-only case, where `sourceKey` is
   * already the right one.
   */
  const pickSource = (k) => {
    if (sourceKeyProp != null) onPickProp?.(k, 0);
    else {
      setOwnSourceKey(k);
      setOwnStageIdx(0);
    }
  };

  /**
   * Whether this card's own stage menu may be OPENED.
   *
   * A CHILD of a compound row is one number of a row its PARENT chose, so letting
   * the child re-pick the row would leave its siblings describing parts that no
   * longer exist -- hence `stageLocked`.
   *
   * `stageLocked` is NOT the same as "controlled". The PARENT of a compound row is
   * controlled too (its selection is stored, so its picker reopens on the row you
   * chose) and it is precisely the card that MUST be able to pick. Deriving this
   * from `sourceKeyProp != null` conflated the two, and disabled the one menu the
   * parent existed to provide.
   *
   * A locked button stays VISIBLE, disabled, and still shows which row the part
   * belongs to. It is not removed: the row name is the part's identity, and a child
   * that named no row would leave the user unable to tell which numbers the two
   * parts came from. What it loses is the chevron (a `·` replaces it, so the
   * control does not advertise a menu it will not open), the hover state, and the
   * ability to be clicked -- and the title says why, so the inert control explains
   * itself rather than just failing.
   */
  const stageMenuEnabled = !stageLocked;
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionKey, setReactionKeyState] = useState(reactionKeyProp || 'none');
  const setReactionKey = (k) => {
    setReactionKeyState(k);
    onReactionChange?.(k);
  };
  const [reactionOpen, setReactionOpen] = useState(false);
  // Seeded from the host's stored choice, then owned locally for this mount. Every
  // change is reported up so a collapse/expand round trip -- which unmounts this
  // component -- does not lose it.
  const [critMode, setCritModeState] = useState(critModeProp || 'avg'); // never | avg | crit
  const setCritMode = (k) => {
    setCritModeState(k);
    onCritModeChange?.(k);
  };

  /**
   * How tall each menu may be.
   *
   * The card is `overflow-hidden` AND scaled -- by `transform: scale()` in the
   * planner, by `zoom` on the standalone page -- so neither menu can be portalled
   * out of it; both have to fit inside. A hardcoded cap therefore cannot be
   * right, and both caps here were guesses that were wrong:
   *
   *   stage menu      `max-h-[300px]` exceeded a ~200px space and lost 4px.
   *   reaction menu   `max-h-[196px]` against a 570px list, which cut off ELEVEN
   *                   of fourteen rows and made 剧变反应 look deleted.
   *
   * THE NUMBER MUST BE IN THE CARD'S OWN UNITS. `getBoundingClientRect` reports
   * POST-scale pixels, and the menu's `maxHeight` is applied PRE-scale (the menu
   * lives inside the scaled box). On the planner, where the scale changes with
   * the window, feeding a rect straight back in shrinks the menu as the card
   * shrinks -- twice over, since the cap is scaled again on the way out. So the
   * measured room is divided by the scale factor, which is read from the card's
   * own height against its intrinsic 470.
   */
  const CARD_H = 470;
  const [menuMaxH, setMenuMaxH] = useState({ stage: 260, reaction: 300 });
  const stageWrapRef = useRef(null);
  const reactionWrapRef = useRef(null);

  /** The card element, and how much its rendered pixels are shrunk. */
  const cardGeometry = (wrap) => {
    const card = wrap?.closest('[class*="h-[470px]"]') || wrap?.offsetParent;
    if (!card) return null;
    const cr = card.getBoundingClientRect();
    // `zoom` is a non-standard but widely supported computed value; a card at
    // `zoom: 1` inside a scaled ancestor still reports `scale` 1, which is the
    // conservative reading (it can only make the menu smaller than it could be).
    const rendered = getComputedStyle(card).zoom;
    const zoom = rendered && rendered !== 'normal' ? Number(rendered) || 1 : cr.height / CARD_H;
    return { card, cr, scale: zoom > 0 ? zoom : 1 };
  };

  useEffect(() => {
    if (!menuOpen) return;
    const wrap = stageWrapRef.current;
    const geom = cardGeometry(wrap);
    if (!wrap || !geom) return;

    const measure = () => {
      const wr = wrap.getBoundingClientRect();
      // 6px for the gap, 8px so the panel's shadow is not flush with the edge.
      const room = (geom.cr.bottom - wr.bottom) / geom.scale - 14;
      setMenuMaxH((m) => ({ ...m, stage: Math.max(120, Math.floor(room)) }));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [menuOpen]);

  useEffect(() => {
    if (!reactionOpen) return;
    const wrap = reactionWrapRef.current;
    const geom = cardGeometry(wrap);
    if (!wrap || !geom) return;

    const measure = () => {
      const wr = wrap.getBoundingClientRect();
      // The readout and the crit buttons sit BELOW this column and must stay on
      // screen while the list is open -- that is the reason to cap rather than
      // let the menu run to the card's edge.
      const reserved = 90;
      const room = (geom.cr.bottom - wr.bottom) / geom.scale - reserved;
      // The list is ~330px in the card's own units against the ~290 this column
      // can spare, so it scrolls a little however it is sized. The floor is what
      // guarantees the amplifying AND transformative groups are both reachable;
      // without it a short window pinned the menu to a height that showed only
      // the first few rows, which is what made 剧变反应 look removed.
      setMenuMaxH((m) => ({ ...m, reaction: Math.max(240, Math.floor(room)) }));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [reactionOpen]);

  // The stat panel is optionally CONTROLLED. A host that unmounts this card
  // (the planner collapses entries) must own the edits, or typing a number and
  // then collapsing would silently discard it. Without the prop the card keeps
  // its own state and behaves exactly as before.
  const [ownStats, setOwnStats] = useState(defaultStats);
  const stats = statsProp ?? ownStats;
  const setStats = onStatsChange ?? setOwnStats;

  const source = sources.find((s) => s.key === sourceKey) || sources[0];
  const stage = source.stages[Math.min(stageIdx, source.stages.length - 1)];
  const reaction = REACTIONS.find((r) => r.key === reactionKey) || REACTIONS[0];

  // The attacker's level for the defence zone: the host's value if it supplied
  // one, else whatever the character object carries, else the formula's default.
  const atkLevel = Number(atkLevelProp ?? char?.level) || 90;

  /**
   * WHICH PART OF THE ROW this card computes, and what element it carries.
   *
   * A compound talent row (`59.27%+110.08%`) is several hits of different damage
   * types written in one row. A host that splits such a row into child entries
   * pins each child to one part through `partIndex`/`element`; without them every
   * child would compute the FIRST coefficient and draw the same number.
   *
   * Both are CONTROLLED when given, and unset for an ordinary card -- which is why
   * a plain entry behaves exactly as it always has. `parts` comes from
   * `char-sources.parseMultiplierParts`, so the coefficient is a reading of the
   * talent text rather than a second source of truth.
   */
  const parts = partsOverride || stage.parts || null;
  const partIdx = Math.min(Math.max(0, partIndexProp || 0), (parts?.length || 1) - 1);
  const activePart = parts ? parts[partIdx] : { mult: stage.mult, hits: stage.hits };
  // THE IMPORTED NUMBERS WIN, field by field: `scaling` may carry only a
  // multiplier, only a hit count, or both, and whatever it leaves out falls
  // back to the table. Replacing the whole part would turn a missing field
  // into `undefined` and the damage into `NaN`.
  const effectiveStage = {
    mult: scaling?.mult ?? activePart.mult,
    hits: scaling?.hits ?? activePart.hits,
    bonus: stage.bonus,
  };
  const hitElementName = elementProp || source.element;

  // Works for both the internal setter (functional) and a controlled host
  // callback (plain object), so callers do not have to care which is active.
  const commitStats = (next) =>
    typeof next === 'function' ? setStats((s) => next(s)) : setStats(next);

  // PER-KEY EDITS when the host offers them.
  //
  // The panel is DERIVED from the team, and a host that owns the derivation needs
  // to know exactly which field a user changed in order to record an override for
  // it -- the whole-panel callback cannot say, and diffing the result against the
  // derived panel would mistake a value that happens to match for an edit.
  // `onStatReset` clears every override at once, which is what 重置 means.
  const setStat = (k, v) =>
    (onStatEdit ? onStatEdit(k, v) : commitStats((s) => ({ ...s, [k]: v })));

  const resetStats = () =>
    (onStatReset ? onStatReset() : commitStats(defaultStats()));

  // Buffs dragged in from the planner are layered ON TOP of the manually edited
  // stats. Keeping them separate (rather than writing them into `stats`) is what
  // lets a user still type their own numbers and lets the injection be removed
  // without clobbering manual edits.
  //
  // `mergeStats` is shared with the planner's collapsed row, so the two cannot
  // disagree about how a buff lands on the panel.
  //
  // DISPLAY AND COMPUTATION ARE TWO PANELS, and conflating them was a bug.
  //
  // This card renders each field as its BASE value with the buff contribution
  // shown beside it (`value={stats[k]}` next to `injected={injectedTotals[k]}`), so
  // `stats` has to stay UNMERGED for display. But the RESULT has to be computed
  // from a panel that INCLUDES the buffs. When there is no `injectedBuffs` -- which
  // is how a controlled host calls this, because it did the folding itself -- the
  // old code computed from `stats` directly, i.e. from the unmerged panel. The
  // planner's collapsed row merged the same totals and so counted a dropped buff
  // that the card ignored: one entry, two numbers, one screen.
  //
  // So a controlled host passes `computeStats` (its merged panel) and the card
  // uses it for the arithmetic while still displaying `stats`. When `injectedBuffs`
  // IS supplied -- the standalone page -- there is no host to do the merge, so the
  // card does it and both panels become the same thing.
  const { totals: ownTotals, effectiveStats, displayStats } = useMemo(() => {
    if (!injectedBuffs?.length) {
      // No buffs to fold here. `computeStats` is the host's already-merged panel
      // when it supplied one; `stats` is the honest fallback for a standalone card.
      const compute = computeStatsProp ?? stats;
      return { totals: {}, effectiveStats: compute, displayStats: stats };
    }
    const { totals } = foldBuffs(injectedBuffs);
    const merged = mergeStats(stats, totals);
    return { totals, effectiveStats: merged, displayStats: stats };
  }, [stats, injectedBuffs, computeStatsProp]);
  const injectedTotals = injectedTotalsProp ?? ownTotals;

  // Full damage calculation, using every visible stat. The formula itself lives
  // in lib/damage.js so a collapsed planner row can evaluate it without
  // mounting this card (see DamageEntry).
  //
  // `effectiveStage` and `hitElementName` rather than the raw row: a part-pinned
  // card must multiply by ITS part's coefficient against ITS element, or every
  // child of a compound row shows the first coefficient's number.
  //
  // `atkLevel` is the ATTACKER's level and is a term in the defence zone. Omitting
  // it left the formula's `= 90` default in force, so changing the character's
  // level moved the panel's ATK (which scales with level) while the defence zone
  // stayed put -- the two halves of the same number disagreeing about how strong
  // the character was.
  const result = useMemo(
    () =>
      computeDamage(effectiveStats, {
        stage: effectiveStage,
        reaction,
        element: hitElementName,
        critMode,
        atkLevel,
        zoneMult,
      }),
    [effectiveStats, effectiveStage, reaction, critMode, hitElementName, atkLevel, zoneMult]
  );

  // Publish the current selection + damage so a host can render a collapsed
  // row. The card keeps ownership of its own state; the host only reads.
  //
  // THE CARD REPORTS WHAT IT IS SHOWING, INCLUDING ON MOUNT. Deciding here which
  // reports "matter" was tried and abandoned: a card cannot know what its host
  // already holds or what the host does with it, and every rule invented for it
  // (a mount latch, a controlled-vs-uncontrolled test) was wrong in a way that
  // only showed up in a different host -- under StrictMode, after a reload, or on
  // the uncontrolled path where the mount report is the ONLY announcement of the
  // selection. The host owns that judgement; see `setEntrySummary`.
  useEffect(() => {
    onSummary?.({
      sourceKey: source.key,
      sourceLabel: source,
      stageIndex: stageIdx,
      stage,
      reactionKey: reaction.key,
      reaction,
      element: hitElementName,
      critMode,
      perHit: result.perHit,
      total: result.total,
      hits: effectiveStage.hits || 1,
      // WHICH PART, echoed back so a part-pinned card does not lose its pin.
      partIndex: partIdx,
      // HOW MANY NUMBERS THE SELECTED ROW'S TEXT CONTAINS.
      //
      // `59.27%+110.08%` is two hits of different damage types in one talent row,
      // and the host turns such a row into a parent with one child per number.
      // The count comes from `parts`, which `char-sources.parseMultiplierParts`
      // fills from the text itself -- so it is a reading of the data, not a guess
      // and not a property of the skill.
      //
      // 1 for an ordinary row, which is why every entry without parts keeps
      // behaving exactly as it does today.
      partCount: parts ? parts.length : 1,
      // The coefficients, so the host can show a child's own number without
      // re-parsing the text it does not have.
      parts: parts || null,
    });
  }, [onSummary, source, stage, stageIdx, partIdx, parts, hitElementName, reaction, result, effectiveStage]);

  const n = (v) => Math.round(v).toLocaleString('en-US');
  // ONE precision for the whole summary strip below. Rounding some cells and
  // not others made the panel look like it followed two rules, and a total that
  // read 17,841 could not be checked against the formula by hand. Three decimals
  // is what the zone multipliers already used, so extending it to every cell
  // fixes the inconsistency without coarsening anything: a total, a percentage
  // and a multiplier now all read at the same precision.
  const s3 = (v) =>
    Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  // `source.element` can be undefined, and `elementOf` above tolerates that (it
  // falls back to a grey "unknown" glyph internally) while the `toLowerCase`
  // below did NOT -- the card crashed with "Cannot read properties of undefined
  // (reading 'toLowerCase')".
  //
  // It happens when an entry's character is gone from the team: `DamageEntry`
  // builds its source list from the team lookup, so a cleared or edited team
  // leaves the entry pointing at a character that no longer exists. Reachable
  // before the axis was persisted, and easier to hit now that a saved axis and a
  // saved team can be cleared independently.
  //
  // `Physical` rather than an element: an unknown element grants no elemental
  // bonus, so a neutral hit is the honest reading, and it cannot invent a damage
  // type the character does not have.
  //
  // The PART's element when one is pinned, not the source's: a compound row's two
  // halves differ, and every glyph on the card -- the 直伤 mark, the tint, the
  // 元素伤害 caption -- must describe the half being computed.
  const srcElement = hitElementName || source?.element || 'Physical';
  const el = elementOf(srcElement === 'Physical' ? 'Geo' : srcElement);
  const isPhysical = srcElement === 'Physical';
  // The element the hit itself carries, in `ELEMENT_FOR_ICON`'s spelling.
  //
  // `toLowerCase()` used to stand in for this and does NOT: the map's keys are
  // capitalised (`Cryo`), so every lookup missed and fell through to its
  // `atk_base` default. `isStencilIcon` then flattened that sword to pure white,
  // which is why EVERY 直伤 glyph rendered as a plain white blade -- including
  // the Hydro and Pyro rows of the reaction menu.
  //
  // Physical is spelled out here because it is not in the map: the map's own
  // `Physical` entry is the leftover this replaces, not a lookup this needs.
  const hitElement = isPhysical ? 'physical' : capitalise(srcElement);

  /**
   * THE SOURCE COLUMN, written once and used twice.
   *
   * It is the whole card's first column, and -- in `sourceOnly` -- the whole
   * output. Kept as one expression so the picker cannot drift from the card: a
   * second copy of this menu is a second copy of the logic that decides which
   * numbers a row contains, and that is the copy that goes stale.
   *
   * The `relative` WRAPPER is what the menu is positioned against, so it hangs off
   * the button rather than off the column. Both menus in this card previously
   * anchored themselves with hardcoded offsets against the surrounding `relative`
   * column -- `bottom-5` pinned one to the column's BOTTOM (far below its button)
   * and the other used a fixed `top-[62px]` that overlapped the content above it.
   *
   * The height is capped to the room actually below the button. In the full card
   * the surrounding box is `overflow-hidden` and SCALED, so the menu cannot portal
   * out of it -- it has to fit, and `menuMaxH.stage` is computed from that card's
   * own geometry (divided by its scale factor, because the cap is applied in the
   * card's own units while the box it is measured against is reported post-scale).
   * `sourceOnly` has no such box: it is un-scaled and un-clipped, so the cap there
   * is a plain, generous number.
   */
  const sourceColumn = (
    <div
      className={
        sourceOnly
          ? 'relative w-full p-4'
          : 'relative w-[310px] shrink-0 border-r border-white/5 p-5'
      }
    >
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-white/40">
        {L({ chs: '伤害来源', en: 'Damage Source' })}
      </p>

      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-1.5">
          <img src={talentIconImg(source.icon)} alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-white/40">{L(SOURCE_LABEL[source.kind])}</p>
          {/* The source name already begins with its category (e.g.
              "Normal Attack: ..."), so strip the repeated prefix. */}
          <p className="mt-0.5 text-sm font-semibold leading-snug text-white">
            {L(source).replace(/^[^·:]*[·:]\s*/, '')}
          </p>
        </div>
      </div>

      <div className="relative mt-4" ref={stageWrapRef}>
        <button
          onClick={() => stageMenuEnabled && setMenuOpen((v) => !v)}
          disabled={!stageMenuEnabled}
          title={stageMenuEnabled ? undefined : L({ chs: '攻击段由所属技能决定', en: 'The row is set by the skill this part belongs to' })}
          className={`flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors ${
            stageMenuEnabled ? 'hover:bg-white/[0.06]' : 'cursor-default opacity-70'
          }`}
        >
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-white/40">
              {L({ chs: '攻击段', en: 'Stage' })}
            </span>
            <span className="block truncate text-sm font-medium text-white">{L(stage)}</span>
          </span>
          <span className={`ml-2 shrink-0 text-white/40 transition-transform ${menuOpen ? 'rotate-180' : ''}`}>
            {stageMenuEnabled ? '▾' : '·'}
          </span>
        </button>

        {menuOpen && (
          <div
            data-stage-menu
            /* IN THE PARENT'S PICKER THE LIST IS IN FLOW, not an overlay.
             *
             * That picker is one short column, and the CHILDREN sit directly
             * beneath it inside the row's `overflow-hidden` box -- so an
             * absolutely-positioned list hung straight over them and hid both
             * children rows completely (measured). Letting the list push the
             * content down keeps every child readable while it is open, which is
             * the whole point of opening it.
             *
             * The FULL card keeps the overlay: it is its own 470px box, and its
             * list is capped by `menuMaxH.stage` to fit inside that box. */
            className={`overflow-y-auto rounded-xl border border-white/10 bg-[#141418] p-1.5 shadow-2xl shadow-black/80 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 ${
              sourceOnly ? 'relative mt-2' : 'absolute left-0 right-0 top-[calc(100%+6px)] z-30'
            }`}
            // THE MENU IS WIDER THAN THE COLUMN IT HANGS FROM.
            //
            // It tracks the column's width (`left-0 right-0`) but is allowed to
            // grow past it, because a compound row now prints its whole
            // multiplier text (`59.27%+110.08%`) and the column is only 310px.
            // Pinned to the column, the longer rows forced the NAME to truncate
            // -- `狂飙突进·重击...` -- so the user lost the row's identity to make
            // room for its numbers. The minimum below fits the longest pair in the
            // dataset with the name intact; `max-w` keeps it from running off the
            // card, which is `overflow-hidden` and would clip it.
            style={{ maxHeight: sourceOnly ? 320 : menuMaxH.stage, minWidth: 340, maxWidth: 470 }}
          >
          {sources.map((s) => (
            <div key={s.key}>
              <button
                onClick={() => {
                  pickSource(s.key);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  s.key === sourceKey ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
                }`}
              >
                <img src={talentIconImg(s.icon)} alt="" className="h-5 w-5 shrink-0 object-contain" />
                <span className="min-w-0 flex-1 truncate">{L(s)}</span>
                <span className="shrink-0 text-[10px] text-white/30">{L(SOURCE_LABEL[s.kind])}</span>
              </button>

              {s.key === sourceKey &&
                s.stages.map((st, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setStageIdx(i);
                      setMenuOpen(false);
                    }}
                    className={`ml-6 flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                      i === stageIdx ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'
                    }`}
                    style={{ width: 'calc(100% - 1.5rem)' }}
                  >
                    {/* `min-w-0` so the NAME is the part that truncates. Without
                        it the flex item refuses to shrink below its content and
                        the multiplier -- which must never be cut, since it is the
                        whole point of the row -- is the one that gets clipped. */}
                    <span className="min-w-0 truncate">{L(st)}</span>
                    {/* THE ROW'S REAL MULTIPLIER TEXT, not its first coefficient.
                        `59.27%+110.08%` used to render as `59.27%`, which made a
                        two-part row indistinguishable from a single-part one --
                        in the one menu the user reads to choose between them. */}
                    <span className="shrink-0 whitespace-nowrap tabular-nums text-white/40">
                      {stageMultiplierText(st)}
                    </span>
                  </button>
                ))}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );

  /**
   * `sourceOnly`: the picker for a compound row's parent.
   *
   * The parent has no stats of its own, folds no buffs and computes no damage --
   * it exists so the row can be changed without deleting the entry. So the art,
   * the 19 stat fields, the damage type and the result panel are all inert here,
   * and drawing them buried the one control that works under a page of controls
   * that do not.
   */
  if (sourceOnly) {
    return (
      <div data-damage-card data-source-only="true" className={`w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#0a0a0a] ${className}`}>
        {sourceColumn}
      </div>
    );
  }

  return (
    <div
      data-damage-card
      className={`group flex h-[470px] w-full max-w-[1320px] overflow-hidden rounded-2xl border border-white/5 bg-[#0a0a0a] shadow-2xl shadow-black/50 ${className}`}
    >
      {/* ---------------------------------------------- 1. character art */}
      {/* Reuses the exact same portrait component as the character grid, so
          the art, scrim, name and icons can never drift apart.
          The wrapper is `relative` with a real height so the art (which is
          absolutely positioned inside CharacterArt) has something to fill. */}
      <div className="relative h-full w-[210px] shrink-0 border-r border-white/5">
        <CharacterArt
          id={characterId}
          char={char}
          lang={lang}
          name={charName}
          rounded="rounded-l-2xl rounded-r-none"
          className="h-full w-full"
        >
          {/* THE CHARACTER'S REAL LEVEL, and it says so when it is not known.
              This was the literal string "Lv.90" -- so every character read as 90
              while the defence zone used its ACTUAL level. The two disagreed the
              moment a character was not 90, and the label was the one a person
              would believe.

              READ FROM `atkLevel`, NOT `char.level`. The `char` object a host
              passes is deliberately trimmed to what the portrait needs and does
              not carry the level -- `DamageEntry` passes it separately for exactly
              that reason. Reading `char.level` here showed 等级未知 for every
              planner entry while the arithmetic was correct.

              `atkLevel` is the same value the formula uses, so the label and the
              number cannot drift apart again. */}
          <p className="text-[11px] text-white/50">
            {atkLevel > 0
              ? `Lv.${atkLevel}`
              : L({ chs: '等级未知', en: 'level unknown' })}
          </p>
        </CharacterArt>
      </div>

      {sourceColumn}


      {/* ---------------------------------- 3. the full stat sheet (all of it) */}
      {/* The header stays put while the field list scrolls on its own. */}
      <div className="flex min-w-0 flex-1 flex-col border-r border-white/5 p-5">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            {L({ chs: '数值（全部）', en: 'All Stats' })}
          </p>
          <button
            onClick={resetStats}
            className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-white/40 transition-colors hover:text-white"
          >
            {L({ chs: '重置', en: 'Reset' })}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-thumb]:bg-white/20">

        {['base', 'pct', 'dmg', 'enemy'].map((g) => (
          <div key={g} className="mb-3">
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/25">{L(GROUP_LABEL[g])}</p>
            <div className="grid grid-cols-3 gap-1.5 xl:grid-cols-4">
              {statDefs.filter((d) => d.group === g).map((d) => (
                <StatField
                  key={d.key}
                  // The generic field carries NO glyph.
                  //
                  // It briefly borrowed the hit element's icon, back when it was
                  // the only DMG-bonus field and a fixed flame was plainly wrong.
                  // Now that each element has its own field, borrowing one makes
                  // 通用伤害加成 look identical to 冰元素伤害 sitting next to it.
                  // There is no "all elements" glyph in the set, so the label
                  // carries the meaning rather than a misleading mark.
                  def={d.key === 'dmgBonus' ? { ...d, icon: null } : d}
                  label={L(d)}
                  // The BASE value; the buff contribution shows beside it via
                  // `injected`. This is why `displayStats`, not `effectiveStats`.
                  value={displayStats[d.key]}
                  injected={injectedTotals[d.key] || 0}
                  // Marks a field the user has changed away from its derived
                  // value, so "this came from my team" and "this is my own
                  // number" are distinguishable at a glance.
                  isOverridden={!!overridden?.includes?.(d.key)}
                  onChange={(v) => setStat(d.key, v)}
                />
              ))}
            </div>
          </div>
        ))}
        </div>

        {/* Live intermediate results - pinned below the scrolling field list */}
        <div className="mt-3 grid shrink-0 grid-cols-3 gap-1.5 border-t border-white/5 pt-3 xl:grid-cols-5">
          <Mini stat="totalHp" label={L({ chs: '总生命', en: 'Total HP' })} value={s3(result.totalHp)} />
          <Mini stat="totalAtk" label={L({ chs: '总攻击', en: 'Total ATK' })} value={s3(result.totalAtk)} />
          <Mini stat="totalDef" label={L({ chs: '总防御', en: 'Total DEF' })} value={s3(result.totalDef)} />
          <Mini stat="talent" label={L({ chs: '天赋倍率', en: 'Talent' })} value={`${s3(result.talent * 100)}%`} />
          <Mini
            stat="reaction"
            label={L({ chs: '反应增幅', en: 'Reaction' })}
            value={reaction.amp ? `x${s3(result.reactMult)}` : '—'}
          />
          <Mini stat="crit" label={L({ chs: '暴伤区', en: 'Crit DMG Zone' })} value={`x${s3(result.critMult)}`} />
          <Mini stat="dmgBonus" label={L({ chs: '伤害加成', en: 'DMG Bonus' })} value={`${s3(result.bonusPct)}%`} />
          <Mini stat="defZone" label={L({ chs: '防御区', en: 'DEF Zone' })} value={`x${s3(result.defMult)}`} />
          <Mini stat="resZone" label={L({ chs: '抗性区', en: 'RES Zone' })} value={`x${s3(result.resMult)}`} />
          <Mini stat="er" label={L({ chs: '充能效率', en: 'Energy Rech.' })} value={`${s3(result.er)}%`} />
        </div>

        <div className="mt-2.5 flex shrink-0 flex-wrap gap-1.5">
          {[
            { k: 'never', label: L({ chs: '不计暴击', en: 'No Crit' }) },
            { k: 'avg', label: L({ chs: '期望', en: 'Expected' }) },
            { k: 'crit', label: L({ chs: '必定暴击', en: 'Crit' }) },
          ].map((o) => (
            <button
              key={o.k}
              onClick={() => setCritMode(o.k)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                critMode === o.k
                  ? 'border-primary/60 bg-primary/20 text-white'
                  : 'border-white/10 text-white/50 hover:text-white'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* --------------------------------------------- 4. damage type */}
      <div className="relative flex w-[300px] shrink-0 flex-col rounded-r-2xl p-5">
        <p className="mb-3 shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/40">
          {L({ chs: '伤害类型', en: 'Damage Type' })}
        </p>

        {/* A dropdown rather than a flat grid: the list is long, and only one
            option can be active at a time.
            Wrapped in `relative` for the same reason as the stage menu: the menu
            must hang off ITS OWN BUTTON, not off the column. The fixed
            `top-[62px]` it used before landed on top of the button and the list
            above it. */}
        <div className="relative shrink-0" ref={reactionWrapRef}>
          <button
            onClick={() => setReactionOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
          >
          <span className="flex min-w-0 items-center gap-2">
            <ReactionGlyph reaction={reaction} size={20} hitElement={hitElement} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white">{L(reaction)}</span>
              <span className="block truncate text-[10px] text-white/40">
                {reaction.note
                  ? L(reaction.note)
                  : reaction.transformative
                  ? L({ chs: '剧变反应，不参与增幅', en: 'transformative, no amplification' })
                  : L({ chs: '无反应加成', en: 'no reaction bonus' })}
              </span>
            </span>
          </span>
          <span className={`ml-2 shrink-0 text-white/40 transition-transform ${reactionOpen ? 'rotate-180' : ''}`}>
            ▾
          </span>
          </button>

          {reactionOpen && (
            // Hangs off its own button, and stops short of the readout below so
            // that stays visible while choosing.
            //
            // THE HEIGHT IS MEASURED, NOT GUESSED. `max-h-[196px]` was a number
            // picked by eye, and the list is 570px tall: eleven of the fourteen
            // rows were cut off, and the ones that survived were the amplifying
            // reactions -- so 剧变反应 looked like it had been removed. The menu
            // cannot escape the card (`overflow-hidden`, and the card is scaled
            // by `useFitScale`), so the only honest cap is the room that is
            // actually left below the button, exactly as the stage menu does it.
            <div
              data-reaction-menu
              className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-y-auto rounded-xl border border-white/10 bg-[#141418] p-1.5 shadow-2xl shadow-black/80 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5"
              style={{ maxHeight: menuMaxH.reaction }}
            >
            <p className="px-2.5 pb-1 pt-2 text-[9px] uppercase tracking-wider text-white/25">
              {L({ chs: '无增幅', en: 'No amplification' })}
            </p>
            {REACTIONS.filter((r) => !r.amp && !r.transformative).map((r) => (
              <ReactionOption
                key={r.key}
                reaction={r}
                active={reactionKey === r.key}
                hitElement={hitElement}
                onPick={() => {
                  setReactionKey(r.key);
                  setReactionOpen(false);
                }}
                L={L}
              />
            ))}

            <p className="px-2.5 pb-1 pt-2.5 text-[9px] uppercase tracking-wider text-white/25">
              {L({ chs: '增幅反应（有方向）', en: 'Amplifying (directional)' })}
            </p>
            {REACTIONS.filter((r) => r.amp).map((r) => (
              <ReactionOption
                key={r.key}
                reaction={r}
                active={reactionKey === r.key}
                hitElement={hitElement}
                onPick={() => {
                  setReactionKey(r.key);
                  setReactionOpen(false);
                }}
                L={L}
              />
            ))}

            <p className="px-2.5 pb-1 pt-2.5 text-[9px] uppercase tracking-wider text-white/25">
              {L({ chs: '剧变反应（无方向）', en: 'Transformative (no direction)' })}
            </p>
            {REACTIONS.filter((r) => r.transformative).map((r) => (
              <ReactionOption
                key={r.key}
                reaction={r}
                active={reactionKey === r.key}
                hitElement={hitElement}
                onPick={() => {
                  setReactionKey(r.key);
                  setReactionOpen(false);
                }}
                L={L}
              />
            ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex shrink-0 items-center gap-2 text-[11px] text-white/40">
          <ElementIcon element={hitElement} size={16} />
          <span>
            {isPhysical
              ? L({ chs: '物理伤害', en: 'Physical DMG' })
              : L({ chs: `${el.zh}元素伤害`, en: `${hitElementName} DMG` })}
          </span>
        </div>

        <div className="mt-3 shrink-0 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-4">
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            {L({ chs: '单段伤害', en: 'Damage per Hit' })}
          </p>
          <p data-summary="perHit" className="mt-1 text-3xl font-bold tabular-nums text-white">{n(result.perHit)}</p>
          {effectiveStage.hits > 1 && (
            <p className="mt-1 text-xs text-white/50">
              x {effectiveStage.hits} {L({ chs: '段合计', en: 'hits total' })}{' '}
              <span className="font-semibold text-white/80">{n(result.total)}</span>
            </p>
          )}
        </div>

        {/* Spacer keeps the open dropdown clear of the readout above. */}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

// The icon group for a reaction: a single element for direct damage, a
// directional pair for amplifying reactions, and a neutral "+" pair for
// transformative ones (their damage does not depend on trigger order).
function ReactionGlyph({ reaction, size = 20, hitElement }) {
  if (reaction.from) {
    return (
      <span className="flex shrink-0 items-center gap-0.5">
        <ElementIcon element={reaction.from} size={size} />
        <span className="text-[11px] text-white/35">→</span>
        <ElementIcon element={reaction.to} size={size} />
      </span>
    );
  }
  if (reaction.pair) {
    return (
      <span className="flex shrink-0 items-center gap-0.5">
        <ElementIcon element={reaction.pair[0]} size={size} />
        <span className="text-[11px] text-white/25">+</span>
        <ElementIcon element={reaction.pair[1]} size={size} />
      </span>
    );
  }
  return <ElementIcon element={hitElement} size={size + 2} />;
}

function ReactionOption({ reaction: r, active, hitElement, onPick, L }) {
  return (
    <button
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
      }`}
    >
      <ReactionGlyph reaction={r} size={15} hitElement={hitElement} />
      <span className="min-w-0 flex-1 truncate text-[11px]">{L(r)}</span>
      {r.base > 1 && <span className="shrink-0 text-[10px] text-white/40">×{r.base.toFixed(1)}</span>}
    </button>
  );
}

// Renders an element as a tinted silhouette using the same drop-shadow trick
// as the character card: the original icon is pushed out of its clipping box
// by a flat coloured copy of itself.
//
// Takes the element in `ELEMENT_FOR_ICON`'s spelling -- capitalised, or the
// literal `'physical'`. Callers hold it in both spellings, so this capitalises
// rather than trusting the argument: a lowercase `'cryo'` looked up here as-is
// missed the map and drew the plain ATK blade, which is a convincing enough
// glyph that the mistake survived several rounds of review.
function ElementIcon({ element, size = 22 }) {
  const isPhysical = element === 'physical';
  // PHYSICAL HAS ITS OWN GLYPH. It used to borrow `atk_base`, a plain sword, while
  // `ElementGlyph` drew a different mark for the same damage type -- so the card
  // and the axis row showed two different icons for one thing. `physical.webp` is
  // the game's actual physical damage-type icon and both now use it.
  const key = isPhysical ? 'physical' : ELEMENT_FOR_ICON[capitalise(element)] || 'atk_base';
  const tint = isPhysical ? null : TINT[String(element).toLowerCase()] || 'rgb(220,220,230)';

  if (!tint) {
    return (
      <img
        src={iconImg(key)}
        alt=""
        style={{ width: size, height: size, filter: ICON_WHITE, opacity: 0.85 }}
      />
    );
  }
  return (
    <div style={{ width: size, height: size, overflow: 'hidden', display: 'inline-block' }}>
      <img
        src={iconImg(key)}
        alt=""
        style={{
          width: size,
          height: size,
          filter: `drop-shadow(${tint} 0px -${size}px 0px)`,
          transform: `translateY(${size}px)`,
          display: 'block',
        }}
      />
    </div>
  );
}

function StatField({ def, label, value, onChange, injected = 0, isOverridden = false }) {
  return (
    <div
      data-stat-field={def.key}
      data-overridden={isOverridden ? 'true' : 'false'}
      className={`rounded-lg border bg-white/[0.02] px-2 py-1.5 ${
        injected ? 'border-[#7fd4c1]/40' : isOverridden ? 'border-amber-400/40' : 'border-white/5'
      }`}
    >
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-white/35">
        {def.icon && (
          <img src={iconImg(def.icon)} alt="" className="h-2.5 w-2.5" style={{ filter: ICON_WHITE }} />
        )}
        <span className="truncate">{label}</span>
        {/* An amber dot marks a value the user set themselves, overriding what the
            team derives. Without it there is no way to tell a number that came
            from the artifacts from one that was typed. */}
        {isOverridden && (
          <span className="shrink-0 text-amber-400/80" title="已手动修改（覆盖自动值）" data-override-mark>
            ●
          </span>
        )}
        {/* Dragged-in buffs are additive on top of the typed value, so the
            field must show both numbers — otherwise the input reads 0 while the
            damage maths uses 28, which looks like a bug. */}
        {injected !== 0 && (
          <span
            className="ml-auto shrink-0 font-bold text-[#7fd4c1]"
            title="来自拖入的增益"
          >
            +{injected}
            {def.suffix}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="min-w-0 flex-1 bg-transparent text-right text-[13px] font-semibold tabular-nums text-white outline-none"
        />
        {def.suffix && <span className="shrink-0 text-[10px] text-white/35">{def.suffix}</span>}
        {!def.noSign && (
          <button
            onClick={() => onChange(0)}
            className="shrink-0 rounded px-0.5 text-[10px] leading-none text-white/20 transition-colors hover:text-white/70"
            title="归零"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, stat }) {
  return (
    <div data-summary={stat} className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <p className="truncate text-[9px] uppercase tracking-wider text-white/35">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
