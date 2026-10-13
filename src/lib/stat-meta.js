// Label + suffix for each damage-panel field.
//
// A LEAF MODULE, on purpose. This table is needed by `components/buff-model.js`
// (to label a folded total), by `lib/artifact-meta.js` (to label a slot stat) and
// by `lib/buff-formula.js` (to name a `$` symbol). `buff-formula.js` also has to
// be imported by `buff-model.js` once a buff value can be a formula -- which
// would make `buff-model -> buff-formula -> buff-model` a cycle, and a cycle that
// READ this table at module-eval time would throw a temporal-dead-zone error
// rather than fail to resolve. Living here, below all three, it cannot take part
// in any cycle.
//
// EVERY FIELD IN `STAT_DEFS` MUST APPEAR HERE. A consumer that cannot find a key
// falls back to printing the raw key text, so a missing entry is not a crash --
// it is `anemoDmg` shown to the user in place of 风元素伤害. The element keys
// were added to the panel and to `KEY_TO_STAT` but omitted here when the
// elemental bonus was split up, which is exactly that failure.

import { DAMAGE_TYPES, KEY_SUFFIX, TYPE_ZH } from './elements';

export const STAT_META = {
  atk: { chs: '攻击力', en: 'ATK' },
  atkPct: { chs: '攻击力加成', en: 'ATK%', suffix: '%' },
  hp: { chs: '生命值', en: 'HP' },
  hpPct: { chs: '生命值加成', en: 'HP%', suffix: '%' },
  def: { chs: '防御力', en: 'DEF' },
  defPct: { chs: '防御力加成', en: 'DEF%', suffix: '%' },
  /* The flat additions, whose labels must stay distinguishable from the base
     rows directly above them (`hp` is the base a percentage multiplies,
     `flatHp` is added after it). */
  flatHp: { chs: '固定生命值', en: 'Flat HP' },
  flatAtk: { chs: '固定攻击力', en: 'Flat ATK' },
  flatDef: { chs: '固定防御力', en: 'Flat DEF' },
  /* 附加伤害值, not 固定伤害: the term is the game's own (附加伤害), a flat sum
     added after the talent multiplier, and it scales with no panel stat of the
     attacker -- "flat damage" alone would read as another name for flat ATK. */
  flatDmg: { chs: '附加伤害值', en: 'Flat DMG' },
  em: { chs: '元素精通', en: 'Elemental Mastery' },
  critRate: { chs: '暴击率', en: 'CRIT Rate', suffix: '%' },
  critDmg: { chs: '暴击伤害', en: 'CRIT DMG', suffix: '%' },
  er: { chs: '元素充能效率', en: 'Energy Recharge', suffix: '%' },
  /* One per element, matching the panel's own labels. */
  pyroDmg: { chs: '火元素伤害', en: 'Pyro DMG', suffix: '%' },
  hydroDmg: { chs: '水元素伤害', en: 'Hydro DMG', suffix: '%' },
  cryoDmg: { chs: '冰元素伤害', en: 'Cryo DMG', suffix: '%' },
  electroDmg: { chs: '雷元素伤害', en: 'Electro DMG', suffix: '%' },
  anemoDmg: { chs: '风元素伤害', en: 'Anemo DMG', suffix: '%' },
  geoDmg: { chs: '岩元素伤害', en: 'Geo DMG', suffix: '%' },
  dendroDmg: { chs: '草元素伤害', en: 'Dendro DMG', suffix: '%' },
  /* 通用, not 元素: this field is the un-elemented bonus that adds to whichever
     element the hit uses, and there are now per-element fields beside it. */
  dmgBonus: { chs: '通用伤害加成', en: 'All DMG Bonus', suffix: '%' },
  physBonus: { chs: '物理伤害加成', en: 'Physical DMG Bonus', suffix: '%' },
  reactionBonus: { chs: '反应伤害提升', en: 'Reaction DMG Bonus', suffix: '%' },
  /* 全抗性, not 抗性: there are now per-damage-type shred fields beside it, and
     two rows both reading 抗性降低 would be indistinguishable in the panel. */
  resShred: { chs: '全抗性降低', en: 'All RES Shred', suffix: '%' },
  defShred: { chs: '防御降低', en: 'DEF Shred', suffix: '%' },
  defIgnore: { chs: '无视防御', en: 'DEF Ignore', suffix: '%' },
  /* The enemy/other panel fields. No buff key feeds most of them today, so
     nothing asks for these labels yet -- but they ARE panel fields, and a table
     described as "for each damage-panel field" that omits them is the same drift
     that lost the element keys.
     Generated from `DAMAGE_TYPES` for the same reason: a hand-written list of
     sixteen entries is sixteen chances to drop Physical. */
  ...Object.fromEntries(DAMAGE_TYPES.flatMap((t) => {
    const zh = TYPE_ZH[t];
    const en = KEY_SUFFIX[t];
    return [
      [`resShred${en}`, { chs: `${zh}抗性降低`, en: `${en} RES Shred`, suffix: '%' }],
      [`enemyRes${en}`, { chs: `${zh}抗性`, en: `${en} RES`, suffix: '%' }],
    ];
  })),
  enemyLevel: { chs: '敌人等级', en: 'Enemy Level' },
  talentBonus: { chs: '天赋倍率加成', en: 'Talent Bonus', suffix: '%' },
  healBonus: { chs: '治疗加成', en: 'Healing Bonus', suffix: '%' },
};
