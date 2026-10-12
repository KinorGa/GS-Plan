// Bulk settings: the walk that writes one value to every row, checked directly.
//
// The point of this file is that "every row" is a claim that can be FALSE in a way
// the browser hides: a compound row's parts each hold their own overrides, so a
// value written only to the parent is beaten by the child's own copy and one row
// visibly does not change. So the cases below are the three shapes a row can take,
// plus the "leave what I did not set" rule.
import { applyBulkSettings, countBulkTargets } from '../src/lib/bulk-apply.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

const plain = { id: 'e1', charId: 'c1', drops: [], statOverrides: { atk: 5 }, critMode: 'never' };
const loop = {
  id: 's1', kind: 'segment', name: 'loop', expanded: false,
  children: [
    { id: 'e2', charId: 'c1', drops: [], statOverrides: {} },
    { id: 'e3', charId: 'c2', drops: [], statOverrides: { atk: 9 }, critMode: 'crit' },
  ],
};
const compound = {
  id: 'e4', charId: 'c3', drops: [], statOverrides: {}, critMode: 'avg',
  children: [
    { id: 'e4-p0', partIndex: 0, drops: [], statOverrides: { enemyResPyro: 40 }, critMode: null },
    { id: 'e4-p1', partIndex: 1, drops: [], statOverrides: {}, critMode: 'never' },
  ],
};
const entries = [plain, loop, compound];

// --- 1. the walk reaches the three shapes ------------------------------------
ok('counts top-level + loop members + compound parts', countBulkTargets(entries) === 6, countBulkTargets(entries));

// --- 2. a value lands on every row, parts included ---------------------------
const applied = applyBulkSettings(entries, { stats: { enemyLevel: 90 } });
ok('top-level entry gets the value', applied[0].statOverrides.enemyLevel === 90);
ok('loop member 1 gets the value', applied[1].children[0].statOverrides.enemyLevel === 90);
ok('loop member 2 gets it AND keeps its own atk',
  applied[1].children[1].statOverrides.enemyLevel === 90 && applied[1].children[1].statOverrides.atk === 9);
ok('compound part 0 gets it AND keeps its own RES',
  applied[2].children[0].statOverrides.enemyLevel === 90 && applied[2].children[0].statOverrides.enemyResPyro === 40);
ok('compound part 1 gets it', applied[2].children[1].statOverrides.enemyLevel === 90);

// --- 3. crit mode lands on the row AND its parts ------------------------------
const crit = applyBulkSettings(entries, { critMode: 'crit' });
ok('top-level crit mode set', crit[0].critMode === 'crit');
ok('loop member without its own mode is set', crit[1].children[0].critMode === 'crit');
ok('loop member keeps its own mode? (bulk overrides it)', crit[1].children[1].critMode === 'crit');
ok('compound parent set', crit[2].critMode === 'crit');
ok('compound part 0 overridden', crit[2].children[0].critMode === 'crit');
ok('compound part 1 overridden', crit[2].children[1].critMode === 'crit');

// --- 4. what was NOT set is untouched ----------------------------------------
const onlyLevel = applyBulkSettings(entries, { stats: { enemyLevel: 90 } });
ok('crit mode untouched when only a stat is set', onlyLevel[0].critMode === 'never');
ok('part crit mode untouched when only a stat is set', onlyLevel[2].children[1].critMode === 'never');
ok('an unrelated override survives', onlyLevel[0].statOverrides.atk === 5);

// --- 5. an empty apply is a no-op reference -----------------------------------
ok('nothing set returns the same list', applyBulkSettings(entries, {}) === entries);
ok('an empty stats object is a no-op', applyBulkSettings(entries, { stats: {} }) === entries);

// --- 6. the LEGACY enemyRes key is migrated, not carried ----------------------
const legacy = applyBulkSettings([{ id: 'x', statOverrides: { enemyRes: 30 } }], { stats: { enemyLevel: 90 } });
ok('legacy enemyRes is folded into the per-type fields', legacy[0].statOverrides.enemyResPyro === 30 && !('enemyRes' in legacy[0].statOverrides));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);