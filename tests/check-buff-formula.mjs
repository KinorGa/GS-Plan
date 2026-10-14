// The formula scope, checked as a PURE FUNCTION.
//
// `buff-formula.js` deliberately has no React and no storage, so the scope and
// the parser can be verified directly instead of by reading pixels.
import { SYMBOLS, TOTALS, scopeFor, scopeForUnit, identityOf, evaluate, analyse, isFormula, resolve, valueOf, tokenize, parse, symbolByName, partialAt, matchesFor } from '../src/lib/buff-formula.js';
import {
  foldDrops, numericValue,
  foldCustomZones, foldZoneDrops, customZoneMultiplier, splitZoneFactors,
  zoneFactorLabel,
} from '../src/components/buff-model.js';
import { computeDamage } from '../src/lib/damage.js';
import { derivePanel } from '../src/lib/stat-derive.js';
import fs from 'node:fs';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const detail = read('public/data/char/chs/10000128.json');   // 法尔伽 / Varka
const weapons = read('public/data/weaponlist.json');
const wolf = Object.entries(weapons).find(([, w]) => /狼的末路/.test(w.chsName))[1];

let fails = 0;
const check = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.01;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(40)} got ${got}  want ${want}`);
};
const checkEq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(40)} got ${got}  want ${want}`);
};

console.log('1. the symbol table is built from the panel keys + totals + identity');
const names = SYMBOLS.map((s) => s.name);
checkEq('total symbols', SYMBOLS.length, names.length);
checkEq('has 总攻击力', names.includes('总攻击力') ? 1 : 0, 1);
checkEq('has 治疗加成', names.includes('治疗加成') ? 1 : 0, 1);
checkEq('has 等级', names.includes('等级') ? 1 : 0, 1);
// The enemy panel must NOT be in the scope: those are not this character's.
checkEq('no 敌人等级', names.includes('敌人等级') ? 1 : 0, 0);
checkEq('no 防御降低', names.includes('防御降低') ? 1 : 0, 0);
// Every symbol has an English alias so an `en` UI can still parse a formula.
checkEq('every symbol has an en name', SYMBOLS.every((s) => s.en) ? 1 : 0, 1);

console.log('\n2. the scope matches derivePanel, and the totals match the formula');
const GOBBET = 'anemoDmg';
const artifacts = {
  flower: { setId: '15044', mainStat: 'hp', level: 20, subStats: [null, null, null, null] },
  plume: { setId: '15044', mainStat: 'atk', level: 20, subStats: [null, null, null, null] },
  sands: { setId: '15044', mainStat: 'atkPct', level: 20, subStats: [{ key: 'critRate', value: '7.0' }, null, null, null] },
  goblet: { setId: '15044', mainStat: GOBBET, level: 20, subStats: [null, null, null, null] },
  circlet: { setId: '15044', mainStat: 'healBonus', level: 20, subStats: [null, null, null, null] },
};
const { values: v } = derivePanel({ detail, level: 90, element: 'Anemo', weapon: wolf, artifacts });
const unit = { char: { id: '10000128', level: 90, constellation: 3, talents: { normal: 6, skill: 9, burst: 10 } }, weapon: { id: '15507', refine: 5 } };
const scope = scopeFor(v, identityOf(unit, { char: { qualityType: 'QUALITY_ORANGE' } }));

check('$攻击力 is the panel base', scope['攻击力'], v.atk);
check('$生命值 is the panel base', scope['生命值'], v.hp);
check('$治疗加成 is derived from the circlet', scope['治疗加成'], v.healBonus);
check('the circlet healing main is > 0', scope['治疗加成'] > 0 ? 1 : 0, 1);

// The totals must equal what lib/damage.js computes, term for term.
check('$总攻击力 == base*(1+pct)+flat', scope['总攻击力'], v.atk * (1 + v.atkPct / 100) + v.flatAtk);
check('$总生命值 == base*(1+pct)+flat', scope['总生命值'], v.hp * (1 + v.hpPct / 100) + v.flatHp);
check('$总防御力 == base*(1+pct)+flat', scope['总防御力'], v.def * (1 + v.defPct / 100) + v.flatDef);
checkEq('$等级', scope['等级'], 90);
checkEq('$命座', scope['命座'], 3);
checkEq('$元素战技等级', scope['元素战技等级'], 9);
checkEq('$精炼', scope['精炼'], 5);
checkEq('$稀有度', scope['稀有度'], 5);

console.log('\n3. the demo formulas, verbatim');
const cases = [
  ['=$总攻击力*0.15', scope['总攻击力'] * 0.15],
  ['=$生命值*0.02', v.hp * 0.02],
  ['=$元素精通*2.5', v.em * 2.5],
  ['=($攻击力+$固定攻击力)*0.2', (v.atk + v.flatAtk) * 0.2],
  ['=$暴击伤害/10', v.critDmg / 10],
  ['=1+2*3', 7],
  ['=-(2+3)', -5],
];
for (const [text, want] of cases) check(text, valueOf(text, scope), want);

console.log('\n4. the identifier is the Chinese name; `en` is display only');
checkEq('a symbol record carries its en label', symbolByName('总攻击力').en, 'Total ATK');
checkEq('and its kind', symbolByName('总攻击力').kind, 'total');
// An English name is NOT a token: "Total ATK" has a space, and the tokenizer
// ends a name at the next space on purpose. It must be refused, not mis-read.
checkEq('an English name does not parse', resolve('=Total ATK*0.15', scope).ok ? 1 : 0, 0);

console.log('\n5. REFUSE, never reduce to the digits inside');
const bad = [
  ['=$不存在*2', '不认识的符号'],
  ['=1/0', '除以零'],
  ['=1e3', '不认识的字符'],
  ['=$生命值*0.02)', '多余内容'],
  ['=  $总攻击力-', '不完整'],
];
for (const [text, why] of bad) {
  const r = resolve(text, scope);
  const ok = !r.ok && String(r.error).includes(why);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${text.padEnd(20)} -> ${r.ok ? 'ok?!' : r.error}`);
}
// The demo's headline failure: a formula must not be reduced to its digits.
checkEq('#NOPE does not read as 0.15', valueOf('=$NOPE*0.15', scope) === 0 ? 1 : 0, 0);
checkEq('NaN for a refused formula', Number.isNaN(valueOf('=$NOPE*0.15', scope)) ? 1 : 0, 1);

console.log('\n6. a plain number is REFUSED when it is not clean digits');
check('120', valueOf('120', scope), 120);
check('-5', valueOf('-5', scope), -5);
check('3.5', valueOf('3.5', scope), 3.5);
checkEq('empty is 0', valueOf('', scope), 0);
// The old numericValue would turn 12abc3 into 123 and 攻击力*2 into 2.
for (const junk of ['12abc3', '攻击力*2', '1,000']) {
  const r = resolve(junk, scope);
  const ok = !r.ok;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${junk.padEnd(12)} -> ${r.ok ? 'ok?! ' + r.value : r.error}`);
}

console.log('\n7. a missing detail file yields a zero scope, not a throw');
const bare = derivePanel({ detail: null, level: 90, element: 'Cryo', weapon: null, artifacts: {} });
const bareScope = scopeFor(bare.values, {});
check('$总攻击力 is 0', bareScope['总攻击力'], 0);
check('a formula over it still evaluates', valueOf('=$总攻击力*0.15', bareScope), 0);

console.log('\n8. scopeForUnit derives end to end from a team entry');
const entry = {
  id: '10000128', element: 'Anemo', level: 90, constellation: 6, refine: 1,
  qualityType: 'QUALITY_ORANGE', talents: { normal: 1, skill: 1, burst: 1 },
  weaponId: '15507', artifacts, detail,
};
const unitScope = scopeForUnit(entry, { weapons: { 15507: wolf } });
check('scopeForUnit matches scopeFor', unitScope['总攻击力'], valueOf('=$总攻击力', scope));
checkEq('$命座 from the entry', unitScope['命座'], 6);
checkEq('$稀有度 from qualityType', unitScope['稀有度'], 5);
// A unit whose detail has not loaded is all zeros, NOT invented.
const notLoaded = scopeForUnit({ ...entry, detail: null }, { weapons: { 15507: wolf } });
check('an unloaded unit yields 0, not a guess', notLoaded['总攻击力'], 0);

console.log('\n9. the autocomplete offers matches, each with its CURRENT value');
const part = partialAt('=$攻', 3);
checkEq('partialAt finds the fragment', part.text, '攻');
const m = matchesFor('攻', unitScope);
checkEq('攻 prefix offers 攻击力 and 攻击力加成', m.map((x) => x.name).join(','), '攻击力,攻击力加成');
check('each match carries a value', m.every((x) => typeof x.value === 'number') ? 1 : 0, 1);
checkEq('总 prefix matches the three totals', matchesFor('总', unitScope).map((x) => x.name).join(','), '总生命值,总攻击力,总防御力');
// The caret must be INSIDE a name; after an operator it is not.
checkEq('no suggestion after an operator', partialAt('=$总攻击力*0', 8), null);

console.log('\n10. numericValue REFUSES junk (the old stripper returned a number)');
check('foldDrops resolves a formula per owner', foldDrops(
  [{ source: { owner: { id: '10000128' } }, buffs: [{ key: 'atkPct', value: '=$总攻击力*0.1' }] }],
  () => unitScope
).totals.atkPct, unitScope['总攻击力'] * 0.1);
// 12abc3 used to read as 123 via parseFloat(replace(...)); it must not now.
checkEq('12abc3 refuses', Number.isNaN(valueOf('12abc3', unitScope)) ? 1 : 0, 1);
checkEq('...and numericValue gives 0, not 123', numericValue('12abc3', unitScope), 0);
check('a plain number still works', numericValue('120', unitScope), 120);
check('a formula with no scope refuses to 0', numericValue('=$总攻击力*0.1', undefined), 0);

console.log('\n11. custom multiplier zones: 大权 adds, 倍率乘区 multiplies');
const zone = (key, value) => ({ key, value, tag: '' });
const foldZones = (buffs) => foldCustomZones(buffs, undefined);
// SAME NAME, DIFFERENT RULES. 大权 2 twice is 2 + 2 = 4 (two sources of one
// bonus); 倍率乘区 2.2 twice is 2.2 * 2 = 4.4 (two ratio factors). The gcsim
// importer leans on the second, which is why it must not be additively merged.
check('大权 2 + 大权 2 = 4', customZoneMultiplier(foldZones([zone('aPower', 2), zone('aPower', 2)])), 4);
check('倍率乘区 2.2 * 2 = 4.4', splitZoneFactors(foldZones([zone('multZone', 2.2), zone('multZone', 2)])).mult, 4.4);
check('a percentage zone is 1 + sum/100',
  customZoneMultiplier(foldZones([zone('擢升', 30), zone('潮涌', 20)])), 1.5);
// ACROSS DROPS (one card per source) the same rule holds.
check('foldZoneDrops multiplies 倍率乘区 across cards',
  splitZoneFactors(foldZoneDrops([
    { buffs: [zone('multZone', 2.2)] }, { buffs: [zone('multZone', 2)] },
  ])).mult, 4.4);
check('foldZoneDrops adds 大权 across cards',
  customZoneMultiplier(foldZoneDrops([
    { buffs: [zone('aPower', 2)] }, { buffs: [zone('aPower', 3)] },
  ])), 5);
// THE SPLIT: 倍率乘区 comes OUT of the end-of-hit factor and rides the coefficient
// instead. Folding it into `zoneMult` multiplied 附加伤害值 by the multiplier too,
// which is not what "the multiplier is 2.2x" means and overstated every imported
// 法尔伽 row by up to 45%.
const split = splitZoneFactors(foldZones([zone('multZone', 2.2), zone('擢升', 30)]));
check('the split takes 倍率乘区 out of the end factor', split.mult, 2.2);
check('...and leaves the rest as one factor', split.zone, 1.3);
check('a row with only 倍率乘区 has an end factor of 1',
  splitZoneFactors(foldZones([zone('multZone', 2.2)])).zone, 1);

// WHERE IT LANDS: scaling the coefficient leaves 附加伤害值 alone, while `zoneMult`
// doubles it as well. Same panel both times, so the difference IS the home.
const panel = {
  hp: 10000, atk: 1000, def: 500, hpPct: 0, atkPct: 0, defPct: 0, em: 0, er: 100,
  critRate: 0, critDmg: 0, physBonus: 0, dmgBonus: 0, reactionBonus: 0,
  defShred: 100, defIgnore: 0, enemyLevel: 90, enemyResAnemo: 0, talentBonus: 0,
  flatDmg: 1000,
};
const dmgOpts = {
  stage: { mult: 1, bonus: 0, hits: 1 }, reaction: { amp: false, base: 1 },
  element: 'Anemo', critMode: 'never', atkLevel: 90,
};
check('倍率乘区 doubles the coefficient, not 附加伤害值',
  computeDamage(panel, { ...dmgOpts, multZone: 2 }).total, 3000);
check('...where zoneMult doubles 附加伤害值 too (the old, wrong home)',
  computeDamage(panel, { ...dmgOpts, zoneMult: 2 }).total, 4000);

// The label: a raw zone IS the number, a percentage zone is the 1 + v/100 factor.
checkEq('a raw zone reads bare', zoneFactorLabel({ raw: true, value: 2.2 }), '2.2');
checkEq('a percentage zone reads its factor', zoneFactorLabel({ raw: false, value: 20 }), '1.2');

console.log(fails ? `\n${fails} PROBLEMS` : '\nall checks passed');
process.exit(fails ? 1 : 0);
