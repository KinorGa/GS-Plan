// The damage formula, as a pure function.
//
// Extracted from DamageCard so it can be evaluated WITHOUT mounting the card.
// That matters because the planner unmounts collapsed entries for performance,
// and a collapsed row still has to show a correct number after a buff is
// dropped onto it. Recomputing here — rather than keeping a stale value — is
// what stops the row from disagreeing with the card.
//
// DamageCard itself calls this too, so there is exactly one implementation.

import { damageTypeSuffix } from './elements';

/**
 * The panel stat a talent multiplier reads.
 *
 * `atk` is the default because every configuration written before this existed
 * assumed it. A missing, unknown or legacy-empty value therefore keeps its old
 * arithmetic instead of becoming a validation error -- the compatibility rule
 * lives here so the card, the axis, the merged expression and the optimiser all
 * normalise the field the same way.
 */
export const SCALING_BASES = [
  { key: 'atk', chs: '攻击力', en: 'ATK', icon: 'atk_base' },
  { key: 'hp', chs: '生命值', en: 'HP', icon: 'hp_base' },
  { key: 'def', chs: '防御力', en: 'DEF', icon: 'def_base' },
  { key: 'em', chs: '元素精通', en: 'Elemental Mastery', icon: 'em' },
];

/** The algebra symbol each scaling source gets in the merged expression. */
export const SCALING_SYMBOL = { atk: 'A', hp: 'H', def: 'D', em: 'M' };

const BASIS_ALIASES = new Map([
  ['atk', 'atk'], ['attack', 'atk'], ['攻击力', 'atk'],
  ['hp', 'hp'], ['health', 'hp'], ['生命值', 'hp'],
  ['def', 'def'], ['defense', 'def'], ['防御力', 'def'],
  ['em', 'em'], ['mastery', 'em'], ['元素精通', 'em'],
]);

/** A stored value as one of the four keys; anything unrecognised means ATK. */
export function normaliseScalingBasis(value) {
  if (typeof value !== 'string') return 'atk';
  return BASIS_ALIASES.get(value.trim().toLowerCase()) || BASIS_ALIASES.get(value.trim()) || 'atk';
}

/**
 * The basis an entry uses, including the imported-stage fallback.
 *
 * Older files may carry `stage.basis` ("攻击力", ...) but no entry-level field.
 * The entry field wins once the user has touched the dropdown; otherwise the
 * imported declaration is honoured. `fallback` lets a compound child inherit
 * its parent when neither the child nor its row says anything.
 */
export function entryScalingBasis(entry, fallback = 'atk') {
  return normaliseScalingBasis(
    entry?.scalingBasis
      ?? entry?.summary?.stage?.basis
      ?? fallback
  );
}

/**
 * The DMG bonus a hit actually receives: its OWN element's field plus the generic
 * one.
 *
 * Two terms, because they mean different things. `cryoDmg` is Cryo-specific (a
 * Cryo goblet, a Cryo buff) and only ever applies to a Cryo hit; `dmgBonus` is
 * the un-elemented bonus that some buffs and every action-specific key land on,
 * and applies whatever the element is. Summing them is what lets a generic buff
 * and a goblet both count.
 *
 * PHYSICAL GETS BOTH, and this used to return `physBonus` alone.
 *
 * `dmgBonus` is labelled 通用伤害加成 / "All DMG Bonus", and an all-damage bonus
 * that excludes physical is a contradiction. It is also where every
 * action-specific key lands -- `normalDmg`, `chargedDmg`, `skillDmg` … -- and
 * those are explicitly documented as "NOT element-specific … adds to whichever
 * element the hit uses". A physical normal attack is the single most common entry
 * on the axis, so returning early meant a generic "DMG dealt +X%" buff, or any
 * normal-attack bonus, silently did nothing on it. Measured: with the hit Physical,
 * `dmgBonus = 100` left the number at 106 while `physBonus = 100` took it to 212.
 *
 * So the physical case is `physBonus + dmgBonus`, exactly parallel to the
 * elemental case's `own + dmgBonus`. A physical goblet and a generic buff are
 * different sources, and both count.
 *
 * Exported and used by BOTH the card and the planner's collapsed-row recompute,
 * which is what stops the two showing different numbers for the same entry.
 */
export function dmgBonusFor(stats, element) {
  if (element === 'Physical') {
    return (stats.physBonus || 0) + (stats.dmgBonus || 0);
  }
  const own = stats[`${String(element).toLowerCase()}Dmg`] || 0;
  return own + (stats.dmgBonus || 0);
}

/**
 * The resistance multiplier a hit meets.
 *
 * THREE TERMS, and each exists for a reason that is not symmetry:
 *
 *   1. `enemyRes<Type>` — the enemy's own resistance to this damage type. One
 *      field per type, because a resistance is a property of the ENEMY: it does
 *      not stack, so there is deliberately no generic fallback field. An absent
 *      field reads as the game's standard 10% rather than 0, since 0 would make
 *      every hit land harder than it actually does.
 *
 *   2. `resShred<Type>` — resistance reduction aimed at this type ("-40% Cryo
 *      RES").
 *
 *   3. `resShred` — the GENERIC reduction, summed with the above. Several shreds
 *      genuinely add in-game, and a generic one is not a missing element: 钟离's
 *      shield lowers every resistance at once. Keeping it in the formula is also
 *      what a buff card written before the split would otherwise silently fall
 *      into — still displaying +40% while contributing nothing.
 *
 * The `??` on the RES field and the `||` on the shreds are not interchangeable:
 * an ABSENT resistance is the standard 10%, but a resistance deliberately set to
 * 0 must stay 0, and a shred that was never set is 0.
 *
 * RES below 0 is halved (`1 - res/2`), which is the game's rule and unchanged.
 */
export function resMultiplier(stats, element) {
  const suffix = damageTypeSuffix(element);
  // An unrecognised element cannot be mapped to a resistance, and picking one
  // would be a fabricated number. The generic shred still applies, because that
  // term is element-independent and dropping it would understate the hit.
  const own = suffix
    ? (stats[`enemyRes${suffix}`] ?? 10) / 100 - (stats[`resShred${suffix}`] || 0) / 100
    : 0;
  const res = own - (stats.resShred || 0) / 100;
  return res < 0 ? 1 - res / 2 : 1 - res;
}

/** The panel field a hit of this element reads. `null` when the element is unknown. */
export const enemyResKey = (element) => resKey('enemyRes', element);
export const resShredKey = (element) => resKey('resShred', element);
const resKey = (prefix, element) => {
  const suffix = damageTypeSuffix(element);
  return suffix ? `${prefix}${suffix}` : null;
};

/**
 * @param {object} stats      Effective stat panel (base + manual + injected).
 *                            `hp`/`atk`/`def` are the values a percentage
 *                            multiplies; `flatHp`/`flatAtk`/`flatDef` are added
 *                            afterwards. `critRate`/`critDmg`/`er` are TOTALS,
 *                            with the game's bases already included.
 * @param {object} opts
 * @param {object} opts.stage      `{ mult, hits, bonus? }`
 * @param {object} opts.reaction   `{ amp, base }`
 * @param {string} opts.element    The hit's element ('Physical' or an element).
 * @param {string} opts.critMode   'never' | 'avg' | 'crit'
 * @param {number} [opts.atkLevel] Attacker level, defaults to 90.
 * @param {number} [opts.zoneMult] Independent multiplier zone from the user's own
 *                                 buff names (`buff-model.foldCustomZones`).
 *                                 Defaults to 1, i.e. no zone.
 * @param {number} [opts.multZone] The 倍率乘区 factor: it scales the hit's own
 *                                 COEFFICIENT, so it sits inside `talent` and BEFORE
 *                                 附加伤害值 -- a +1000 附加伤害 is not doubled by
 *                                 "the multiplier is 2x". Defaults to 1.
 * @param {string} [opts.basis]    Which panel stat the talent coefficient reads:
 *                                 `atk` (the historical default), `hp`, `def` or
 *                                 `em`.
 */
export function computeDamage(
  stats,
  {
    stage, reaction, element, critMode, atkLevel = 90, zoneMult = 1, multZone = 1,
    basis = 'atk',
  }
) {
  const {
    hp, atk, def, hpPct, atkPct, defPct, em, critRate, critDmg, er,
    // `dmgBonus` and `physBonus` are deliberately NOT destructured here:
    // `dmgBonusFor` picks whichever one applies straight from `stats`.
    // Destructuring them as well would read as though they were used directly,
    // and would keep a second copy of that rule in scope.
    reactionBonus,
    // The RES fields are read through `resMultiplier`, which needs `stats` and
    // the element together; destructuring them here would leave a second copy of
    // the per-element rule in scope, which is the drift this file exists to stop.
    defShred, defIgnore, enemyLevel, talentBonus,
  } = stats;

  // Flat additions sit OUTSIDE the percentage, which is how the game applies
  // them: `base * (1 + pct) + flat`. Folding flat into the base instead would
  // scale it by the percentage too -- a +20 flower's 4780 HP becomes 7007 at
  // 46.6% HP, about a 10% overstatement of the total.
  //
  // `|| 0` because a panel stored before these fields existed has neither.
  const flatHp = stats.flatHp || 0;
  const flatAtk = stats.flatAtk || 0;
  const flatDef = stats.flatDef || 0;

  // Scaled panel values.
  const totalHp = hp * (1 + hpPct / 100) + flatHp;
  const totalAtk = atk * (1 + atkPct / 100) + flatAtk;
  const totalDef = def * (1 + defPct / 100) + flatDef;
  const scalingBasis = normaliseScalingBasis(basis);
  const scalingValue =
    scalingBasis === 'hp' ? totalHp
      : scalingBasis === 'def' ? totalDef
        : scalingBasis === 'em' ? em
          : totalAtk;

  // 倍率乘区 rides the COEFFICIENT (`multZone`), inside the talent multiplier and
  // BEFORE 附加伤害值, because "the multiplier is 2.2x" is a claim about the
  // coefficient and not about the flat 附加伤害 the hit also carries.
  const talent =
    stage.mult * multZone * (1 + (stage.bonus || 0)) * (1 + talentBonus / 100);
  // 附加伤害值 sits OUTSIDE the talent multiplier but INSIDE the bonus bracket:
  // `(atk * talent + flatDmg) * (1 + dmg%)`. That is the game's own order (a
  // 附加伤害 source like 尼可 C4 scales off ITS owner's ATK and adds a flat sum to
  // the hit), and it is the order gcsim's calc events record
  // (`(total_scaling * talent + flat_dmg) * (1 + bonus_dmg) * ...`, verified
  // against every damage event in an export).
  const base = scalingValue * talent + (stats.flatDmg || 0);

  // Amplifying reaction (Vaporize / Melt): 2.78 x EM / (EM + 1400),
  // plus any flat "reaction DMG bonus" the kit provides.
  const emBonus = reaction.amp ? (2.78 * em) / (em + 1400) : 0;
  const reactMult = reaction.amp
    ? reaction.base * (1 + emBonus) * (1 + reactionBonus / 100)
    : 1;

  /**
   * Crit multiplier.
   *
   * THE EXPECTED VALUE CAPS THE RATE AT 100%. Above 1.0 the extra crit rate is
   * spent -- the game cannot crit harder than "always" -- so the uncapped
   * formula kept rewarding it: at 100.24% rate and ~340% CRIT DMG the expected
   * factor (4.413) came out ABOVE the guaranteed-crit factor (4.406), i.e. the
   * average beat its own best case. Measured, and the reason this clamp exists.
   *
   * `never`/`crit` pin the outcome and ignore the rate entirely, so the cap is
   * the AVERAGE branch's own rule.
   */
  const cd = critDmg / 100;
  const rate = Math.min(critRate, 100) / 100;
  const critMult =
    critMode === 'never' ? 1 : critMode === 'crit' ? 1 + cd : 1 + rate * cd;

  /**
   * Enemy defence multiplier.
   *
   *   D = (100 + L_atk) / [ (100 + L_atk) + (100 + L_enemy) × (1 - 减防) × (1 - 无视防御) ]
   *
   * THE TWO REDUCTIONS MULTIPLY, they do not add. This was summed
   * (`1 - defShred - defIgnore`), which overstates the damage as soon as both are
   * present, and worst when they are large: at 50% each the sum gives a factor of
   * 0, i.e. a defence zone of exactly 1.0 -- MORE damage than an enemy with no
   * defence at all would take, which is nonsense. The product gives 0.25, the
   * defence zone 0.783, and stacking more reductions keeps diminishing instead of
   * running away.
   *
   * Each is CLAMPED to [0, 1] rather than trusted. A negative shred would be a
   * defence BUFF, which is not what these fields mean and not something any buff
   * card produces; a value above 100% is unrepresentable in the game. Clamping
   * here is also what replaces the old `Math.max(0, defFactor)`: with a product of
   * two non-negative terms the factor cannot go negative, so the damage can never
   * exceed the no-defence case through this term.
   */
  const clamp01 = (v) => Math.min(Math.max((Number(v) || 0) / 100, 0), 1);
  const defFactor = (1 - clamp01(defShred)) * (1 - clamp01(defIgnore));
  const defMult =
    (100 + atkLevel) /
    (100 + atkLevel + (100 + enemyLevel) * defFactor);

  // Resistance multiplier: the hit's OWN damage type, plus the generic shred.
  const resMult = resMultiplier(stats, element);

  // Physical vs elemental damage bonus. For an elemental hit this is the
  // element's OWN field plus the generic one -- see `dmgBonusFor`, shared with
  // the collapsed-row recompute so the two cannot disagree.
  const bonusPct = dmgBonusFor(stats, element);

  const withBonus = base * (1 + bonusPct / 100);
  // THE USER'S OWN MULTIPLIER ZONE, applied as its own factor.
  //
  // `bonusPct` above ADDS into the same bracket as an elemental goblet, which is
  // right for the stats the game documents. A buff the user named themselves is
  // the opposite request: they are saying "this is a separate zone", so it
  // multiplies rather than adding. `1` when there are no such buffs, which leaves
  // every existing entry arithmetically identical.
  const zoned = withBonus * zoneMult;
  const perHit = zoned * reactMult * critMult * defMult * resMult;
  const total = perHit * (stage.hits || 1);

  return {
    totalHp, totalAtk, totalDef, talent, emBonus, reactMult, critMult,
    defMult, resMult, bonusPct, withBonus, zoneMult, multZone, zoned, perHit,
    total, er, scalingBasis, scalingValue,
  };
}

// NOTE: this module deliberately does NOT define a default stat panel.
//
// It used to export `BASE_STATS`, a hand-written copy of the card's defaults.
// That copy was the bug: a collapsed row recomputed from it while the card used
// its own panel, so the same entry showed two different numbers — and a manual
// stat edit made the difference permanent. The defaults now live once, next to
// the fields they describe, in DamageCard's `defaultStats()`.
