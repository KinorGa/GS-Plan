// The crit multiplier, as a pure function.
//
// The bug this guards: an UNCAPPED crit rate let the expected value exceed the
// guaranteed-crit value. At 100.24% rate and 340% CRIT DMG, 1 + 1.0024*3.4 =
// 4.413 beat 1 + 3.4 = 4.406 -- the average beating its own best case, which is
// impossible. Above 100% the extra rate is spent, so the average clamps it.
import { computeDamage } from '../src/lib/damage.js';

let fails = 0;
const check = (label, ok, extra = '') => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
};

const base = {
  hp: 10000, atk: 1000, def: 500, hpPct: 0, atkPct: 0, defPct: 0,
  em: 0, er: 100, critRate: 0, critDmg: 0,
  physBonus: 0, dmgBonus: 0, reactionBonus: 0,
  defShred: 0, defIgnore: 0, enemyLevel: 90, enemyRes: 10, talentBonus: 0,
};
const stage = { mult: 1, bonus: 0, hits: 1 };
const noReaction = { amp: false, base: 1 };
const opts = (critMode) => ({ stage, reaction: noReaction, element: 'Anemo', critMode, atkLevel: 90 });

const crit = (panel) => {
  const d = computeDamage({ ...base, ...panel }, opts('crit'));
  const a = computeDamage({ ...base, ...panel }, opts('avg'));
  const n = computeDamage({ ...base, ...panel }, opts('never'));
  return { crit: d.critMult, avg: a.critMult, never: n.critMult };
};

// 1. below 100%, expected sits strictly between the two outcomes.
let r = crit({ critRate: 50, critDmg: 100 });
check('50% rate: avg == 1 + 0.5*1.0', Math.abs(r.avg - 1.5) < 1e-9, `avg=${r.avg}`);
check('50% rate: never < avg < crit', r.never < r.avg && r.avg < r.crit);

// 2. exactly 100%: expected EQUALS the guaranteed crit.
r = crit({ critRate: 100, critDmg: 240 });
check('100% rate: avg == crit', Math.abs(r.avg - r.crit) < 1e-9, `avg=${r.avg} crit=${r.crit}`);

// 3. OVER 100%: the average must NOT exceed the guaranteed crit (the bug).
r = crit({ critRate: 100.24, critDmg: 340 });
check('100.24% rate: avg <= crit', r.avg <= r.crit + 1e-9, `avg=${r.avg} crit=${r.crit}`);
check('100.24% rate: avg == the 100% value', Math.abs(r.avg - (1 + 1.0 * 3.4)) < 1e-9, `avg=${r.avg}`);

// 4. a large overshoot is clamped identically.
r = crit({ critRate: 250, critDmg: 200 });
check('250% rate: avg == crit', Math.abs(r.avg - r.crit) < 1e-9, `avg=${r.avg} crit=${r.crit}`);

// 5. zero rate: no crit at all.
r = crit({ critRate: 0, critDmg: 200 });
check('0% rate: avg == never == 1', r.avg === 1 && r.never === 1);

console.log('');
console.log(fails ? `${fails} FAILED` : 'all crit checks passed');
process.exit(fails ? 1 : 0);
