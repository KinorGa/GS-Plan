// The coefficient source a damage entry multiplies.
//
// The compatibility rule is the important half: every configuration written
// before this field existed multiplied by ATK, so a missing value must keep that
// arithmetic exactly. The other three sources are checked against the panel
// value `computeDamage` reports, not against a hand-copied formula.
import {
  SCALING_BASES, SCALING_SYMBOL, computeDamage, entryScalingBasis,
  normaliseScalingBasis,
} from '../src/lib/damage.js';
import { normaliseAxes } from '../src/lib/axes-store.js';

let pass = 0, fail = 0;
const ok = (name, good, detail = '') => {
  if (good) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + '  ' + detail); }
};

ok('the four sources have distinct algebra symbols',
  new Set(SCALING_BASES.map((b) => b.key)).size === 4
  && new Set(SCALING_BASES.map((b) => SCALING_SYMBOL[b.key])).size === 4);

for (const value of [undefined, null, '', 'nonsense', '攻击力', 'ATK', 'atk']) {
  ok('missing or ATK spelling normalises to ATK: ' + String(value),
    normaliseScalingBasis(value) === 'atk', normaliseScalingBasis(value));
}
ok('Chinese HP spelling is accepted', normaliseScalingBasis('生命值') === 'hp');
ok('Chinese DEF spelling is accepted', normaliseScalingBasis('防御力') === 'def');
ok('Chinese EM spelling is accepted', normaliseScalingBasis('元素精通') === 'em');

const parent = { scalingBasis: 'hp', summary: { stage: { basis: '攻击力' } } };
const child = {};
ok('an entry field wins over the imported stage basis', entryScalingBasis(parent) === 'hp');
ok('an imported stage basis is honoured when the entry has no field',
  entryScalingBasis({ summary: { stage: { basis: '防御力' } } }) === 'def');
ok('a compound child inherits its parent when it has no choice of its own',
  entryScalingBasis(child, entryScalingBasis(parent)) === 'hp');
ok('a compound child can override its parent',
  entryScalingBasis({ scalingBasis: 'em' }, entryScalingBasis(parent)) === 'em');

const stats = {
  atk: 1000, atkPct: 50, flatAtk: 100,
  hp: 10000, hpPct: 50, flatHp: 1000,
  def: 800, defPct: 25, flatDef: 50,
  em: 200,
  critRate: 5, critDmg: 50,
  dmgBonus: 0, physBonus: 0,
  enemyLevel: 90, talentBonus: 0, flatDmg: 0,
};
const opts = {
  stage: { mult: 2, hits: 1 },
  reaction: { amp: false, base: 1 },
  element: 'Physical',
  critMode: 'never',
};
const expected = { atk: 1600, hp: 16000, def: 1050, em: 200 };
const atk = computeDamage(stats, { ...opts, basis: 'atk' });
for (const [basis, value] of Object.entries(expected)) {
  const r = computeDamage(stats, { ...opts, basis });
  ok('computeDamage reads the ' + basis + ' panel total',
    Math.abs(r.scalingValue - value) < 1e-9 && r.scalingBasis === basis,
    r.scalingBasis + ' / ' + r.scalingValue);
  ok('the ' + basis + ' total scales linearly with its coefficient',
    Math.abs(r.total / atk.total - value / expected.atk) < 1e-12,
    r.total + ' vs ' + atk.total);
}

const stored = normaliseAxes([
  { id: 'e1', charId: 'u1', scalingBasis: '生命值' },
  { id: 'e2', charId: 'u1' },
]);
ok('loading normalises an explicit stored source',
  stored.axes[0].entries[0].scalingBasis === 'hp');
ok('loading leaves an omitted source omitted, so it keeps meaning ATK',
  !Object.prototype.hasOwnProperty.call(stored.axes[0].entries[1], 'scalingBasis'));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
