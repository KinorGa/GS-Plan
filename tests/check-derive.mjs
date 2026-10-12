// The derivation, checked as a PURE FUNCTION against hand-computed numbers.
//
// This is the whole point of keeping `stat-derive.js` free of React: the
// arithmetic can be verified directly instead of by reading pixels.
import fs from 'node:fs';
import { derivePanel, charBaseAtLevel, artifactKeyToPanel } from '../src/lib/stat-derive.js';
import { mainStatValue } from '../src/lib/artifact-model.js';
import { dmgBonusFor, resMultiplier, enemyResKey, resShredKey } from '../src/lib/damage.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const charlist = read('public/data/charlist.json');
const weapons = read('public/data/weaponlist.json');
const detail = read('public/data/char/chs/10000128.json');   // 法尔伽 / Varka
const element = charlist['10000128'].element;

let fails = 0;
const check = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.01;
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(38)} got ${got}  want ${want}`);
};

console.log('1. the character table, per level');
const l90 = charBaseAtLevel(detail, 90);
console.log(`   L90: ${JSON.stringify(l90)}`);
check('L90 base hp', l90.hp, 12613);
check('L90 base atk', l90.atk, 353);
check('L90 base def', l90.def, 795);
check('L90 ascension value', l90.ascensionValue, 38.4);

const l100 = charBaseAtLevel(detail, 100);
check('L100 base hp', l100.hp, 13510);
check('L100 base atk', l100.atk, 432);

// A level the table does not contain must fall back, not return nothing.
const l92 = charBaseAtLevel(detail, 92);
console.log(`   L92 (absent from the table) -> used L${l92.level}: hp ${l92.hp}`);
check('a missing level falls back to L90', l92.level, 90);

// 95 IS present, so it must use its own row rather than the fallback. A step of
// 10 could not even reach it.
const l95 = charBaseAtLevel(detail, 95);
console.log(`   L95: hp ${l95.hp}, atk ${l95.atk}, def ${l95.def}`);
check('L95 uses its own row', l95.level, 95);
check('L95 base hp', l95.hp, 13061);
check('L95 base atk', l95.atk, 392);
check('L95 differs from L90', l95.hp !== l90.hp ? 1 : 0, 1);

console.log('\n2. an artifact key must NOT map hp to hp');
check('artifact hp -> flatHp', artifactKeyToPanel('hp') === 'flatHp' ? 1 : 0, 1);
check('artifact atk -> flatAtk', artifactKeyToPanel('atk') === 'flatAtk' ? 1 : 0, 1);
check('artifact hpPct -> hpPct', artifactKeyToPanel('hpPct') === 'hpPct' ? 1 : 0, 1);
check('a matching goblet keeps its own key', artifactKeyToPanel('cryoDmg', 'Cryo') === 'cryoDmg' ? 1 : 0, 1);
// A MISmatched goblet is now RECORDED rather than discarded: the panel has a
// field per element, so a Pyro goblet on a Cryo character is data, not noise.
check('a MISmatched goblet is kept, not dropped', artifactKeyToPanel('pyroDmg', 'Cryo') === 'pyroDmg' ? 1 : 0, 1);
// The trap: `critDmg` also ends in "Dmg". A shape-matched element test swallows
// it, silently dropping every CRIT DMG main stat and substat.
check('critDmg is NOT read as an element', artifactKeyToPanel('critDmg', 'Cryo') === 'critDmg' ? 1 : 0, 1);
check('critRate is not either', artifactKeyToPanel('critRate', 'Cryo') === 'critRate' ? 1 : 0, 1);

console.log('\n3. a full derivation: Varka L90 + 狼的末路 + five pieces');
console.log(`   character element: ${element}`);
const wolf = Object.entries(weapons).find(([, w]) => /狼的末路/.test(w.chsName))[1];
console.log(`   weapon: atk ${wolf.ascensionStats.atk}, ATK% ${wolf.ascensionStats['ATK%']}`);

// The goblet must match the character. Varka is ANEMO, so an Anemo goblet.
const GOBBET = `${element.toLowerCase()}Dmg`;

const artifacts = {
  flower: { setId: '15044', mainStat: 'hp', level: 20, subStats: [null, null, null, null] },
  plume: { setId: '15044', mainStat: 'atk', level: 20, subStats: [null, null, null, null] },
  sands: { setId: '15044', mainStat: 'atkPct', level: 20, subStats: [{ key: 'critRate', value: '7.0' }, null, null, null] },
  goblet: { setId: '15044', mainStat: GOBBET, level: 20, subStats: [null, null, null, null] },
  circlet: { setId: '15044', mainStat: 'critDmg', level: 20, subStats: [null, null, null, null] },
};

const { values: v, notes } = derivePanel({
  detail, level: 90, element, weapon: wolf, artifacts,
});
console.log(`   panel: ${JSON.stringify(v, null, 0)}`);
console.log(`   notes: ${JSON.stringify(notes)}`);
check('no mismatched-element notes remain', notes.filter((n) => n.kind === 'element-mismatch').length, 0);

// The goblet lands on ITS OWN element's field, which is the point of the split.
check(`the goblet lands on ${GOBBET}`, v[GOBBET], mainStatValue(GOBBET, 20));
check('the generic field stays 0', v.dmgBonus, 0);
// And the formula sums the hit's element with the generic one.
check('dmgBonusFor adds element + generic', dmgBonusFor({ ...v, dmgBonus: 10 }, element), mainStatValue(GOBBET, 20) + 10);
// A physical hit reads physBonus PLUS the generic dmgBonus, exactly parallel to
// the elemental case. The old expectation here was `30`, i.e. physBonus alone: it
// predated the fix that stopped `dmgBonus` from being ignored on Physical hits
// (see the note at `dmgBonusFor` in lib/damage.js -- an all-damage bonus that
// excludes physical is a contradiction, and every action-specific key lands on
// `dmgBonus`). 30 + 10 = 40.
check('a physical hit uses physBonus + dmgBonus', dmgBonusFor({ ...v, physBonus: 30, dmgBonus: 10 }, 'Physical'), 40);

// Base values, straight from the data.
check('hp is the character base', v.hp, 12613);
check('atk is char base + weapon base', v.atk, 353 + 608);
check('def is the character base', v.def, 795);

// Flat additions, from the flower and plume mains plus substats.
check('flatHp from the flower', v.flatHp, mainStatValue('hp', 20));
check('flatAtk from the plume', v.flatAtk, mainStatValue('atk', 20));

// Percentages, from the weapon secondary plus artifact mains.
check('atkPct = weapon 49.6 + sands main', v.atkPct, 49.6 + mainStatValue('atkPct', 20));
check('no mismatched-element notes remain', notes.filter((n) => n.kind === 'element-mismatch').length, 0);

// Totals, with the game's bases.
check('critRate = 5 base + substat', v.critRate, 5 + 7.0);
check('critDmg = 50 base + ascension 38.4 + circlet main', v.critDmg, 50 + 38.4 + mainStatValue('critDmg', 20));
check('er = 100 base', v.er, 100);

console.log('\n4. the totals the formula produces');
const totalHp = v.hp * (1 + v.hpPct / 100) + v.flatHp;
const totalAtk = v.atk * (1 + v.atkPct / 100) + v.flatAtk;
const totalDef = v.def * (1 + v.defPct / 100) + v.flatDef;
console.log(`   total HP  ${Math.round(totalHp).toLocaleString()}`);
console.log(`   total ATK ${totalAtk.toFixed(1)}`);
console.log(`   total DEF ${Math.round(totalDef)}`);

// The flat must NOT be scaled by the percentage. Adding the flower's 4780 to the
// base instead would give (12613+4780)*1 = 17393 here -- identical at hpPct 0,
// which is why the difference only shows once HP% exists.
const withHpPct = { ...v, hpPct: 46.6 };
const correct = withHpPct.hp * (1.466) + withHpPct.flatHp;
const folded = (withHpPct.hp + withHpPct.flatHp) * 1.466;
console.log(`   at hpPct 46.6: correct ${Math.round(correct)} vs folding-it-in ${Math.round(folded)}`);
check('folding flat into the base would overstate HP', folded - correct > 2000 ? 1 : 0, 1);

console.log('\n5. resistance, per damage type');
// Which field a hit reads. A hit of the wrong type reading the wrong field is
// the failure this whole split exists to avoid.
check('Cryo reads enemyResCryo', enemyResKey('Cryo') === 'enemyResCryo' ? 1 : 0, 1);
check('Physical reads enemyResPhysical', enemyResKey('Physical') === 'enemyResPhysical' ? 1 : 0, 1);
check('Cryo shred reads resShredCryo', resShredKey('Cryo') === 'resShredCryo' ? 1 : 0, 1);
// An unknown element must NOT be answered with a guess.
check('an unknown element has no field', enemyResKey('Frost') === null ? 1 : 0, 1);

// The base case: nothing set anywhere is the standard 10%, so the multiplier is
// 0.9. Reading an absent field as 0 would give 1.0 here -- every hit 11% high.
check('an unset panel gives the standard 10%', resMultiplier({}, 'Cryo'), 0.9);

// A per-type resistance is honoured, and ONLY for its own type.
check('30% Cryo RES on a Cryo hit', resMultiplier({ enemyResCryo: 30 }, 'Cryo'), 0.7);
check('...and not on a Pyro hit', resMultiplier({ enemyResCryo: 30 }, 'Pyro'), 0.9);
// A deliberate 0 must stay 0, which is why the field is read with `??` and not
// `||`: `|| 10` would turn it back into the standard resistance.
check('an explicit 0 RES is honoured', resMultiplier({ enemyResPhysical: 0 }, 'Physical'), 1);

// Shreds: the type's own, the generic one, and BOTH.
//
// These start from the 10% default, so a 40% shred lands at -30% and the halving
// rule takes it to 1.15 -- NOT the 1.3 a reader might expect from "40% more
// damage". The `below zero` case at the end of this block is the same figure
// reached from an explicit field, which is the point: an unset resistance and a
// resistance set to the standard 10 must behave identically.
check('per-type shred alone', resMultiplier({ resShredCryo: 40 }, 'Cryo').toFixed(4), (1.15).toFixed(4));
check('generic shred alone still counts', resMultiplier({ resShred: 40 }, 'Cryo').toFixed(4), (1.15).toFixed(4));
check('...on Physical too', resMultiplier({ resShred: 20 }, 'Physical').toFixed(4), (1.05).toFixed(4));
check('the two shreds ADD', resMultiplier({ resShredCryo: 20, resShred: 20 }, 'Cryo').toFixed(4), (1.15).toFixed(4));
// Shred that does not reach below 0 is NOT halved: 10% RES - 4% shred = 6%, so
// the multiplier is 0.94. This is the case that distinguishes "apply the halving
// rule to the total" from "assert the result is above 1".
check('4% shred stays in the positive range', resMultiplier({ resShredCryo: 4 }, 'Cryo').toFixed(4), (0.94).toFixed(4));

// The halving rule applies to the COMBINED figure, not to each term.
check('below zero the shred is halved', resMultiplier({ enemyResCryo: 10, resShredCryo: 40 }, 'Cryo').toFixed(4), (1.15).toFixed(4));

console.log('\n6. a character with no detail file is reported, not faked');
const bare = derivePanel({ detail: null, level: 90, element: 'Cryo', weapon: null, artifacts: {} });
check('everything is zero', Object.values(bare.values).reduce((a, b) => a + b, 0), 0);
check('it says why', bare.notes.some((n) => n.kind === 'no-stat-table') ? 1 : 0, 1);

console.log(fails ? `\n${fails} PROBLEMS` : '\nall checks passed');
process.exit(fails ? 1 : 0);
