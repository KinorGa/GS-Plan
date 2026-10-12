// Buff sources: every item a unit carries, as one addressable shape.
//
// THE CAUSAL STRUCTURE
//   A character does not "have buffs"; each of its ITEMS is a potential source.
//   Normal attack, elemental skill, elemental burst, the passive talents, each
//   constellation, the weapon and each artifact set bonus are separate things,
//   and a planner has to be able to pull from any ONE of them independently.
//   That relationship is the point of this module; the numbers are not.
//
// SOURCE KINDS
//   attack | skill | burst | passive | constellation | weapon | artifact2 | artifact4
//
// WHAT IS REAL AND WHAT IS A PLACEHOLDER
//   Real, from the local dataset:
//     - every source's identity: which skill, which constellation number,
//       which weapon, which set -- and its own icon and name
//     - which sources EXIST for a unit, derived from that unit's configuration
//       (a C3 unit has exactly three constellation sources)
//     - the artifact 2-pc / 4-pc split, derived from the equipped slots
//   Not real, and deliberately empty:
//     - the buff VALUES. Upstream publishes only prose descriptions and opaque
//       `params` arrays (verified: a weapon carries no stat table, and the
//       artifact `params` are unlabelled floats). So each source starts with an
//       empty buff list for a human to fill in and review, rather than a guess
//       that looks authoritative.
//
// WHY THE NUMBERS ARE NOT FABRICATED HERE
//   A wrong number in a damage calculator is worse than an empty field: an
//   empty source reads as "not filled in yet", a filled one reads as fact.

import { SLOTS } from './artifact-model';
import { activeArtifacts } from './artifact-sets';
import { sourceKindOf } from '../components/BuffCard';

/**
 * Every kind of source, in the order a unit's sheet lists them.
 *
 * The VALUES are `BuffCard`'s kinds, not this module's invention: the pool
 * renders every source through that card, and that component owns the table
 * deciding a source's label and accent. A second table here would be a second
 * chance for a weapon to be gold in one place and grey in another.
 *
 * Note `normal` (not `attack`) and `talent` (not `passive`): those are the names
 * `BuffCard` already uses. This module's INTERNAL grouping follows the unit's
 * sheet (attack / skill / burst / passive); the `kind` it EMITS is the card's,
 * translated by `CARD_KIND` below.
 */
export const SOURCE_KINDS = [
  'normal', 'skill', 'burst',
  'talent', 'constellation',
  'weapon',
  'artifact2', 'artifact4',
];

/** The card's kind for each sheet row this module builds. */
const CARD_KIND = {
  attack: 'normal',
  skill: 'skill',
  burst: 'burst',
  passive: 'talent',
  constellation: 'constellation',
  weapon: 'weapon',
};

/**
 * A source's stable id.
 *
 * Keyed by unit AND kind AND slot, because the same weapon on two units is two
 * sources: a buff belongs to the unit that brings it, and two units wearing one
 * set must not collapse into a single pool entry.
 *
 * `slot` distinguishes repeated kinds: `constellation` uses `c1`..`c6`,
 * `passive` uses `p1`..`p4`, `artifact2`/`artifact4` use the set id (so two
 * different sets' 2-pc bonuses stay separate).
 */
export const sourceId = (unitId, kind, slot = '') =>
  slot ? `${unitId}:${kind}:${slot}` : `${unitId}:${kind}`;

/** Which of the four skill keys each attack-ish kind maps to in the detail file. */
const SKILL_FIELD = {
  attack: 'normalattack',
  skill: 'elementalskill',
  burst: 'elementalburst',
};

/** Icons for the three attack rows when the detail file has not loaded. */
const SKILL_FALLBACK_ICON = { attack: 'Skill_A_04', skill: 'Skill_E_04', burst: 'Skill_S_04' };

/**
 * Build every buff source one unit offers.
 *
 * NAMED `buildUnitSources`, NOT `buildSources`: `src/char-sources.js` already
 * exports a `buildSources` that turns a character's talent MULTIPLIERS into the
 * damage card's attack-stage list. That is a different concept (what a hit
 * deals) from this one (what a hit can be buffed by), and two functions with one
 * name in adjacent modules is a trap.
 *
 * @param   {object} unit       A unit from the team document.
 * @param   {object} ctx        Data the caller has already loaded:
 *                              `{ char, detail, weapon, sets }`.
 *                              Any of them may be null while loading, and the
 *                              sources are then built without that part rather
 *                              than being omitted -- so the pool does not jump
 *                              around as files arrive.
 * @returns {Array} Sources, in sheet order. Each is the exact shape `BuffCard`
 *          takes as its `source` prop, plus `description` and a `buffs` array
 *          that starts EMPTY (see the module header):
 *          `{ id, kind, slot, name, icon, iconKind, rank, owner, buffs }`
 */
export function buildUnitSources(unit, ctx = {}) {
  if (!unit?.char?.id) return [];

  const { char, detail, weapon, sets } = ctx;
  const owner = {
    id: unit.char.id,
    unitId: unit.id,
    name: char ? `${char.chsName} / ${char.enName}` : String(unit.char.id),
    element: char?.element || null,
  };

  // The library's key format, kept in step with `buff-library.js`'s
  // `sourceKey`. Built here rather than imported so this module -- which
  // describes ONE UNIT'S sheet -- stays free of a dependency on how the library
  // happens to be stored. The two formats are asserted equal in
  // scratch/check-library.mjs, so a drift is caught rather than assumed away.
  const libKey = (kind, id, slot) => [kind, id, slot].filter(Boolean).join(':');

  const out = [];
  /**
   * Add one source.
   *
   * @param {string} sheetRow  This module's internal row name (attack / passive…).
   *                           Translated to the CARD's kind via `CARD_KIND`, so
   *                           the pool renders through `BuffCard` correctly while
   *                           this file stays readable in the unit's own terms.
   * @param {string} iconKind  A key in BuffCard's `ICON_LOADERS`: talent / weapon
   *                           / artifact / skill / item / icon.
   * @param {string} [rank]    The chip BuffCard shows, e.g. 'C2' or 'R5'. Part of
   *                           a source's identity: an R5 passive is not the same
   *                           buff as an R1.
   * @param {string} [libKey]  The source's key in the buff LIBRARY, which is
   *                           keyed by the thing itself (`weapon:11515`) rather
   *                           than by the unit. Two units carrying one weapon
   *                           therefore show the same buffs, which is correct:
   *                           the weapon grants what it grants.
   */
  const push = (sheetRow, slot, name, icon, iconKind, rank, description, libKey) => {
    out.push({
      id: sourceId(unit.id, sheetRow, slot),
      libKey: libKey || null,
      kind: CARD_KIND[sheetRow] || sheetRow,
      slot: slot || null,
      name,
      icon: icon || null,
      iconKind,
      rank: rank || '',
      owner,
      description: description || null,
      // Filled from the library by the caller (see `useTeamSources`). Empty
      // means nobody has transcribed this source's numbers yet, which is the
      // honest state and what the editor exists to fix.
      buffs: [],
    });
  };

  // --- attack / skill / burst -----------------------------------------------
  // Named from the detail file when it has loaded, so the planner lists the
  // character's actual talents rather than three generic rows.
  //
  // The three rows are always emitted even when the file has nothing for them
  // (one character in the dataset carries an empty `skills` object): the row is
  // part of the unit's sheet, and dropping it would make the pool's shape depend
  // on which character is selected.
  for (const kind of ['attack', 'skill', 'burst']) {
    const s = detail?.skills?.[SKILL_FIELD[kind]];
    push(
      kind, '',
      // Falls back to the CARD's own label for that kind, so a character whose
      // detail file has not arrived yet still shows "普通攻击" rather than a
      // blank row or an internal key like `attack`.
      s?.name ? { chs: s.name, en: s.name } : sourceKindOf(CARD_KIND[kind]),
      s?.icon || SKILL_FALLBACK_ICON[kind],
      // The three talent rows use the same loader BuffCard uses for a skill;
      // `talentIconImg` inside it routes `UI_Talent_*` to img/talent and
      // `Skill_*` to img/skill, which is what keeps the active talents from
      // silently 404ing.
      'skill',
      // The talent level the unit is configured with. It changes what the
      // talent does, so it belongs in the source's identity the way a
      // refinement belongs to a weapon.
      `Lv${unit.char.talents?.[kind === 'attack' ? 'normal' : kind] ?? 1}`,
      s?.description,
      /**
       * THE LIBRARY KEY USES THE SHEET'S SLOT NAME, NOT THE CARD'S KIND.
       *
       * `loadSourceIndex` keys these three rows by what the DETAIL FILE calls them --
       * `talent:<id>:normal`, `:skill`, `:burst` -- while the card's own vocabulary is
       * `attack`/`skill`/`burst`. Passing `kind` here looked right because the two
       * agree for two of the three, and `attack` vs `normal` is exactly the one that
       * does not.
       *
       * The effect was that 普通攻击 was read under a key nothing is ever written to:
       * a value typed against it in the 增益库 appeared on the library row and the
       * pool's card still said 没有增益条目, and a mark of "not a buff" was filed
       * under the library's key while the pool looked up its own -- so the mark
       * appeared to do nothing. Both are the same mismatch.
       *
       * The comment above this line has said "the SHEET row name (`normal`)... not the
       * card's kind" since it was written; the argument simply did not follow it.
       * `CARD_KIND` already holds the mapping -- it is the constant this function
       * uses two lines up to name the row -- so the slot comes from there rather than
       * from a second copy of the rule.
       */
      libKey('talent', unit.char.id, CARD_KIND[kind])
    );
  }

  // --- passive talents ------------------------------------------------------
  // Driven by the keys the file actually holds, NOT by a `p1..p4` loop.
  //
  // Measured across the playable roster: 85 characters carry THREE real passives
  // and 51 carry four. The fourth slot exists in 87 files as an EMPTY STRING --
  // a padding entry, not a passive -- so the count is "however many have
  // content" and cannot be assumed from the majority either way.
  const passives = detail?.passives || {};
  for (const key of Object.keys(passives).sort()) {
    const p = passives[key];
    if (!p) continue;
    push(
      'passive', key,
      p.name ? { chs: p.name, en: p.name } : { chs: `固有天赋 ${key}`, en: `Passive ${key}` },
      p.icon,
      'talent',
      '',
      p.description,
      libKey('talent', unit.char.id, key)
    );
  }

  // --- constellations -------------------------------------------------------
  // Only the ones the unit has UNLOCKED. A C0 unit contributes no constellation
  // source at all, which is the causal relationship: an unlocked constellation
  // is not a source you can pull from.
  //
  // Every playable character carries six, but the guard against a missing
  // `constN` is kept: the unit's `constellation` count and the file's contents
  // are independent, and a mismatch must not throw.
  const cons = detail?.constellations || {};
  const unlocked = Math.max(0, Math.min(6, Number(unit.char.constellation) || 0));
  for (let n = 1; n <= unlocked; n++) {
    const c = cons[`const${n}`];
    if (!c) continue;
    push(
      'constellation', `c${n}`,
      // The number is already in `rank`; the name stays the plain constellation
      // name rather than repeating "C2" in both places.
      c.name ? { chs: c.name, en: c.name } : { chs: `命之座 ${n}`, en: `Constellation ${n}` },
      c.icon,
      'talent',
      `C${n}`,
      c.description,
      libKey('constellation', unit.char.id, `c${n}`)
    );
  }

  // --- weapon ---------------------------------------------------------------
  if (weapon) {
    // Refinement is part of the source's identity: an R5 passive is not the same
    // buff as an R1, and the planner must be able to show which.
    const refine = Math.max(1, Math.min(5, Math.round(Number(unit.weapon?.refine) || 1)));
    push(
      'weapon', '',
      { chs: weapon.chsName, en: weapon.enName },
      weapon.weaponIcon,
      'weapon',
      `R${refine}`,
      null,
      // The library is keyed per REFINEMENT (`weapon:11515:r5`), because a
      // weapon's passive grants different numbers at each one. The key follows
      // the unit's own refinement, so switching R1 -> R5 in the builder changes
      // the values the pool shows.
      libKey('weapon', unit.weapon?.id, `r${refine}`)
    );
  }

  // --- artifact set bonuses -------------------------------------------------
  // Derived from the slots actually equipped: 2 slots of a set is a 2-pc, 4 is
  // a 4-pc. Same rule the artifact row itself displays.
  const counts = {};
  // The ACTIVE config's slots, so the 2/4-piece sources follow whichever set
  // the unit is currently using -- the same selector the stat panel reads.
  const equipped = activeArtifacts(unit);
  for (const { key } of SLOTS) {
    const setId = equipped?.[key]?.setId;
    if (setId) counts[setId] = (counts[setId] || 0) + 1;
  }
  for (const [setId, n] of Object.entries(counts)) {
    const set = sets?.[setId];
    if (!set) continue;
    for (const pieces of [2, 4]) {
      if (n < pieces) continue;
      const bonus = set.bonuses?.[`${pieces}pc`];
      push(
        `artifact${pieces}`,
        setId,
        {
          chs: `${set.chsName} · ${pieces}件套`,
          en: `${set.enName} ${pieces}-Pc`,
        },
        set.setIcon,
        'artifact',
        // Which bonus this is -- 2 or 4 -- NOT how many slots carry the set.
        // `n` is the slot count (5 for a full set), so using it produced a
        // "5pc" chip on a 4-piece bonus.
        `${pieces}pc`,
        bonus?.description,
        libKey('artifact', setId, String(pieces))
      );
    }
  }

  return out;
}
