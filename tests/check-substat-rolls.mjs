// Verify src/lib/substat-rolls.js against the authoritative affix data.
//
// The claim under test: the EXACT four tiers of every substat are u*{7,8,9,10}
// with u = topTier/10, and the data file's stored row is that value run through
// the exporter's own rounding -- two decimals for a flat (209.125 -> 209.13),
// four for a fraction (0.04536 -> 0.0453). The file is therefore checked with a
// tolerance, not for equality: it is a lossy DISPLAY of the exact tiers.
import fs from 'node:fs';
import {
  SUBSTAT_UNIT, TIER_MUL, SUBSTAT_MAX_ROLLS, tierValues,
  legalTotals, legalValues, isLegalValue, matchLegal, nearestLegal, rollCountsOf,
} from '../src/lib/substat-rolls.js';

const d = JSON.parse(fs.readFileSync('tests/_reliquary-affix.json', 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const PROP_TO_KEY = {
  FIGHT_PROP_HP: 'hp', FIGHT_PROP_ATTACK: 'atk', FIGHT_PROP_DEFENSE: 'def',
  FIGHT_PROP_HP_PERCENT: 'hpPct', FIGHT_PROP_ATTACK_PERCENT: 'atkPct', FIGHT_PROP_DEFENSE_PERCENT: 'defPct',
  FIGHT_PROP_ELEMENT_MASTERY: 'em', FIGHT_PROP_CHARGE_EFFICIENCY: 'er',
  FIGHT_PROP_CRITICAL: 'critRate', FIGHT_PROP_CRITICAL_HURT: 'critDmg',
};
const PCT_KEYS = new Set(['hpPct', 'atkPct', 'defPct', 'er', 'critRate', 'critDmg']);
const DEPOT_RARITY = { 301: 3, 401: 4, 501: 5 };
const TOL = 0.011;   // the file's own rounding, expressed in the editor's scale

let fails = 0, worst = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(50)} ${ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log('1. the exact tiers agree with the data file within its own rounding');
for (const [depotStr, rarity] of Object.entries(DEPOT_RARITY)) {
  const byProp = {};
  for (const row of d.filter((x) => x.depotId === Number(depotStr))) {
    (byProp[row.propType] ||= []).push(row.propValue);
  }
  for (const [prop, storage] of Object.entries(byProp)) {
    const key = PROP_TO_KEY[prop];
    if (!key) continue;
    const stored = [...storage].sort((a, b) => a - b).map((x) => (PCT_KEYS.has(key) ? x * 100 : x));
    const exact = tierValues(key, rarity);
    const dev = Math.max(...exact.map((x, i) => Math.abs(x - stored[i])));
    worst = Math.max(worst, dev);
    check(`${rarity}* ${key.padEnd(8)} dev ${dev.toFixed(4)}  ${JSON.stringify(exact)}`, dev <= TOL, true);
  }
}
console.log(`  worst deviation across every stat/rarity: ${worst.toFixed(4)} (exporter rounding only)`);

console.log('\n2. HP flat, 5-star: the exact tiers, then the 51 totals and 3 dead multipliers');
check('exact tiers', tierValues('hp', 5), [209.125, 239, 268.875, 298.75]);
const hp5 = legalTotals('hp', 5);
check('reachable total count', hp5.length, 51);
check('first / last', [hp5[0].value, hp5[hp5.length - 1].value], [209.125, 1792.5]);
check('418.25 is T1+T1 = 14u', hp5.find((e) => e.m === 14).value, 418.25);
check('6 bottom rolls = 1254.75 exactly', hp5.find((e) => e.m === 42).value, 1254.75);
check('328.625 / 358.5 / 388.375 are NOT legal', [328.625, 358.5, 388.375].map((v) => isLegalValue('hp', 5, v)), [false, false, false]);
check('the neighbours ARE legal', [isLegalValue('hp', 5, 298.75), isLegalValue('hp', 5, 418.25)], [true, true]);
check('no legal HP value exceeds 3 decimals', hp5.every((e) => r3(e.value) === e.value), true);

console.log('\n3. roll-count intervals: a value reachable by several n reports them all');
const byM = new Map(hp5.map((e) => [e.m, e]));
const overlap = { 28: [3, 4], 29: [3, 4], 30: [3, 4], 35: [4, 5], 40: [4, 5], 42: [5, 6], 50: [5, 6] };
for (const [m, want] of Object.entries(overlap)) {
  check(`m=${m} roll counts`, rollCountsOf(byM.get(Number(m))), want);
}
check('m=7 is a single roll', rollCountsOf(byM.get(7)), [1]);
check('m=60 is six rolls', rollCountsOf(byM.get(60)), [6]);
check('no total ever reports >6 rolls', hp5.every((e) => Math.max(...rollCountsOf(e)) <= 6), true);
check('m=19 is T3+T4 only', byM.get(19).entries.map((w) => w.tiers.join('+')), ['3+4']);

console.log('\n4. every legal total has at least one decomposition, none exceed the cap');
let bad = 0;
for (const rarity of [3, 4, 5]) {
  for (const key of Object.keys(SUBSTAT_UNIT[rarity])) {
    for (const e of legalTotals(key, rarity)) {
      if (!e.entries.length) bad++;
      if (e.entries.some((w) => w.n < 1 || w.n > SUBSTAT_MAX_ROLLS[rarity])) bad++;
      if (e.entries.some((w) => w.tiers.length !== w.n)) bad++;
    }
  }
}
check('all entries well-formed', bad, 0);

console.log('\n5. lookup helpers, including tolerance for the game\'s rounded display');
check('matchLegal 209.125 (exact)', matchLegal('hp', 5, 209.125)?.m, 7);
check('matchLegal 209.13 (as many sites show it)', matchLegal('hp', 5, 209.13)?.m, 7);
check('matchLegal tolerates a string', matchLegal('hp', 5, ' 209.13 ')?.m, 7);
check('209 is not legal', isLegalValue('hp', 5, 209), false);
check('nearestLegal to 400 is 418.25', nearestLegal('hp', 5, 400)?.value, 418.25);
check('nearestLegal to null is the first', nearestLegal('hp', 5, null)?.value, 209.125);
check('legalValues is ascending', (() => { const v = legalValues('critRate', 5); return v.every((x, i) => !i || x > v[i - 1]); })(), true);
check('a 3-star cap is smaller than a 5-star one', legalValues('critRate', 3).length < legalValues('critRate', 5).length, true);
check('4-star differs from 5-star', JSON.stringify(legalValues('hp', 4)) !== JSON.stringify(legalValues('hp', 5)), true);

console.log(fails ? `\n${fails} FAILURES` : '\nall good');
process.exit(fails ? 1 : 0);
