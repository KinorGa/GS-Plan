// Artifact stat totals: the sum shown beside the five slots, checked directly.
//
// The claim is small but easy to get subtly wrong: a MAIN stat's number comes
// from the level curve while a SUBSTAT's is the typed value, and the two must be
// added together under the same key -- and a zero or half-typed entry must not
// appear as a real total.
import { artifactStatTotals, blankSet, withPiece } from '../src/lib/artifact-model.js';
import { mainStatValue } from '../src/lib/artifact-model.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

// --- 1. empty build totals nothing -------------------------------------------
ok('a blank build has no totals', Object.keys(artifactStatTotals(blankSet())).length === 0);

// --- 2. main stats are summed through the curve ------------------------------
let b = blankSet();
b = withPiece(b, 'flower', { setId: 'x', mainStat: 'hp', level: 20, subStats: [null, null, null, null] });
b = withPiece(b, 'plume', { setId: 'x', mainStat: 'atk', level: 20, subStats: [null, null, null, null] });
let t = artifactStatTotals(b);
ok('flower main HP counts', t.hp === mainStatValue('hp', 20), `${t.hp} vs ${mainStatValue('hp', 20)}`);
ok('plume main ATK counts', t.atk === mainStatValue('atk', 20), `${t.atk}`);

// --- 3. substats add on top, under the same key ------------------------------
b = withPiece(b, 'flower', { setId: 'x', mainStat: 'hp', level: 20, subStats: [{ key: 'critRate', value: 3.1 }, { key: 'hp', value: 239 }, null, null] });
t = artifactStatTotals(b);
ok('substat HP adds to the flower main HP', Math.abs(t.hp - (mainStatValue('hp', 20) + 239)) < 1e-9, `${t.hp}`);
ok('critRate is summed on its own', Math.abs(t.critRate - 3.1) < 1e-9, `${t.critRate}`);

// --- 4. the same stat across pieces accumulates ------------------------------
b = withPiece(b, 'sands', { setId: 'x', mainStat: 'atkPct', level: 20, subStats: [{ key: 'critRate', value: 7 }, { key: 'critRate', value: 2.7 }, null, null] });
t = artifactStatTotals(b);
ok('critRate adds across two substats of one piece', Math.abs(t.critRate - (3.1 + 7 + 2.7)) < 1e-9, `${t.critRate}`);

// --- 5. junk / zero does not become a total ----------------------------------
b = withPiece(b, 'circlet', { setId: 'x', mainStat: 'critDmg', level: 20, subStats: [{ key: 'atk', value: '' }, { key: 'em', value: 'abc' }, { key: 'atk', value: 0 }, null] });
t = artifactStatTotals(b);
ok('an unparsable substat adds nothing', t.em === undefined, `${t.em}`);
const atkBase = mainStatValue('atk', 20);
ok('empty/zero substats leave the ATK total alone', t.atk === atkBase, `${t.atk} vs ${atkBase}`);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);