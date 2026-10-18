// Transformative and amplifying reaction arithmetic.
//
// REF: docs/REACTIONS.md
//
// The important distinction is structural: Vaporize / Melt multiply the direct
// hit, while Overloaded / Superconduct / Swirl / Electro-Charged / Burning /
// Bloom add a separate hit that ignores DEF, CRIT and DMG bonus. These checks
// pin that distinction so a future refactor cannot quietly move the reaction
// into the wrong branch.
import {
  REACTION_LEVEL_BASE, computeDamage, reactionLevelBase,
  transformativeEmBonus,
} from '../src/lib/damage.js';
import {
  evaluateTransformative, transformativeEmFactor,
} from '../src/lib/merged-expression.js';
import { emMattersIn } from '../src/lib/artifact-optimize.js';

let pass = 0, fail = 0;
const ok = (name, good, detail = '') => {
  if (good) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + '  ' + detail); }
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

const stats = {
  atk: 1000, atkPct: 0, flatAtk: 0,
  hp: 10000, hpPct: 0, flatHp: 0,
  def: 800, defPct: 0, flatDef: 0,
  em: 200,
  critRate: 50, critDmg: 100,
  enemyLevel: 90,
  enemyResPyro: 10, enemyResCryo: 10, enemyResElectro: 10,
  enemyResDendro: 10, enemyResPhysical: 10,
  dmgBonus: 0, physBonus: 0, reactionBonus: 0,
  resShred: 0, resShredPyro: 0, resShredCryo: 0,
  resShredElectro: 0, resShredDendro: 0,
  defShred: 0, defIgnore: 0, talentBonus: 0, flatDmg: 0,
};

const make = (reaction, over = {}, critMode = 'never', opts = {}) => computeDamage(
  { ...stats, ...over },
  {
    stage: { mult: 2, hits: 1 },
    reaction,
    element: 'Pyro',
    critMode,
    basis: 'atk',
    ...opts,
  }
);

ok('level 1 base matches the game table', close(reactionLevelBase(1), 17.165606));
ok('level 90 base matches the game table', close(reactionLevelBase(90), 1446.8535));
ok('levels are clamped to the table', close(reactionLevelBase(0), REACTION_LEVEL_BASE[0]));
ok('EM transformative bonus is 0 at 0 EM', close(transformativeEmBonus(0), 0));
ok('EM transformative bonus uses 16 EM / (EM + 2000)',
  close(transformativeEmBonus(200), 16 * 200 / 2200));

const base = make({ amp: false, base: 1 }, {}, 'never');
const pyroRes = 1 - 0.1;
const level90 = 1446.8535;
const cases = [
  ['Overloaded', { transformative: true, coefficient: 2.0, damageElement: 'Pyro' }, 2.0],
  ['Superconduct', { transformative: true, coefficient: 0.5, damageElement: 'Cryo' }, 0.5],
  ['Swirl', { transformative: true, coefficient: 0.6, pair: ['anemo', 'pyro'] }, 0.6],
  ['Electro-Charged', { transformative: true, coefficient: 1.2, damageElement: 'Electro' }, 1.2],
  ['Burning', { transformative: true, coefficient: 0.25, damageElement: 'Pyro' }, 0.25],
  ['Bloom', { transformative: true, coefficient: 2.0, damageElement: 'Dendro' }, 2.0],
];

for (const [name, reaction, coefficient] of cases) {
  const result = make(reaction);
  const expected = level90 * coefficient
    * (1 + transformativeEmBonus(stats.em)) * pyroRes;
  ok(name + ' adds the expected reaction hit', close(result.reactionPerHit, expected),
    result.reactionPerHit + ' vs ' + expected);
  ok(name + ' keeps the triggering hit and adds the reaction',
    close(result.total, result.directPerHit + result.reactionPerHit));
  ok(name + ' does not mutate the direct hit',
    close(result.directPerHit, base.directPerHit));
}

const noDamage = [
  { transformative: true },
  { transformative: true, coefficient: 0, damageElement: 'Cryo' },
];
for (const reaction of noDamage) {
  const result = make(reaction);
  ok('a transformative type without a coefficient adds no reaction damage',
    result.reactionPerHit === 0 && close(result.total, result.directPerHit));
}

const highDef = make(cases[0][1], { defShred: 0, defIgnore: 0, enemyLevel: 110 });
const lowDef = make(cases[0][1], { defShred: 50, defIgnore: 50, enemyLevel: 1 });
ok('reaction damage has DEF zone 1: it ignores enemy level and DEF changes',
  close(highDef.reactionPerHit, lowDef.reactionPerHit),
  highDef.reactionPerHit + ' vs ' + lowDef.reactionPerHit);
ok('the direct part still sees DEF changes', !close(highDef.directPerHit, lowDef.directPerHit));

for (const critMode of ['never', 'avg', 'crit']) {
  const result = make(cases[0][1], {}, critMode);
  ok('reaction damage is crit-independent: ' + critMode,
    close(result.reactionPerHit, make(cases[0][1], {}, 'never').reactionPerHit));
}
ok('reaction damage ignores DMG bonus',
  close(make(cases[0][1], { dmgBonus: 100 }).reactionPerHit,
    make(cases[0][1], { dmgBonus: 0 }).reactionPerHit));

const overloadRes = make(cases[0][1], { enemyResPyro: 50, enemyResElectro: 0 });
ok('Overloaded reads Pyro RES, not the triggering element blindly',
  close(overloadRes.reactionPerHit, level90 * 2 * (1 + transformativeEmBonus(stats.em)) * 0.5));

const amp = make({ amp: true, base: 2.0 }, { reactionBonus: 20 }, 'never');
ok('amplifying reaction bonus is added inside the EM bracket',
  close(amp.reactMult, 2 * (1 + 2.78 * stats.em / (stats.em + 1400) + 0.20)));

const groups = [{ emBuff: 0, constant: 100, em: 1600 }];
ok('transformative expression factor uses 16E/(E+2000)',
  close(transformativeEmFactor(200), 16 * 200 / 2200));
ok('transformative expression evaluates constant + EM term',
  close(evaluateTransformative(groups, { E: 200 }),
    100 + 1600 * (16 * 200 / 2200)));
ok('EM matters in an expression with only a transformative reaction',
  emMattersIn({ hasTransformative: true, scalingBases: [] }) === true);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
