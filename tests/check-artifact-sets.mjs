// The artifact container: the rules of MULTIPLE builds, checked directly.
//
// Pure functions, so they can be verified without a browser: the migration of an
// old single-build file, the "selecting is using" selector, and the updates that
// add / rename / remove / re-point a build.
import {
  activeArtifacts, addArtifactSet, blankArtifacts,
  normaliseArtifacts, nextArtifactSetId, removeArtifactSet,
  renameArtifactSet, setActiveArtifactSet, setArtifactSlots,
} from '../src/lib/artifact-sets.js';
import { SLOTS } from '../src/lib/artifact-model.js';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + '  ' + x); } };

// --- 1. an OLD bare build migrates to one set ---------------------------------
const oldBuild = Object.fromEntries(SLOTS.map((s) => [s.key, { setId: '15044', mainStat: 'atkPct', level: 20, subStats: [null, null, null, null] }]));
const migrated = normaliseArtifacts(oldBuild);
ok('an old bare build becomes one set', migrated.sets.length === 1);
ok('  ...and is active', migrated.active === migrated.sets[0].id, migrated.active);
ok('  ...keeping every slot', activeArtifacts({ artifacts: migrated })?.['sands']?.mainStat === 'atkPct');
ok('  ...with no name', migrated.sets[0].name === null);

// --- 2. selecting is using ----------------------------------------------------
const two = addArtifactSet(blankArtifacts(), '暴击');
ok('add makes the new set active', two.active === two.sets[1].id, two.active);
ok('  ...and it is the one activeArtifacts reads', activeArtifacts({ artifacts: two }) === two.sets[1].slots);
const back = setActiveArtifactSet(two, two.sets[0].id);
ok('re-pointing switches the active set', activeArtifacts({ artifacts: back }) === back.sets[0].slots);
ok('an unknown id is refused', setActiveArtifactSet(two, 'nope') === two);

// --- 3. editing one build does not touch another ------------------------------
const edited = setArtifactSlots(two, two.sets[1].id, { ...two.sets[1].slots, flower: { setId: 'X', mainStat: 'hp', level: 4, subStats: [] } });
ok('an edit lands on the addressed set', edited.sets[1].slots.flower.setId === 'X');
ok('  ...and leaves the other alone', edited.sets[0].slots.flower.setId === null);

// --- 4. rename, and blank means default ---------------------------------------
ok('rename sets the name', renameArtifactSet(two, two.sets[1].id, '  冰套  ').sets[1].name === '冰套');
ok('a blank name becomes null', renameArtifactSet(two, two.sets[1].id, '   ').sets[1].name === null);

// --- 5. removal rules ---------------------------------------------------------
const one = blankArtifacts();
ok('the LAST set cannot be removed', removeArtifactSet(one, one.sets[0].id) === one);
const removedActive = removeArtifactSet(two, two.sets[1].id);
ok('removing the active set re-points to a survivor', removedActive.active === removedActive.sets[0].id);
ok('  ...and drops exactly one', removedActive.sets.length === 1);

// --- 6. ids are unique and derived from the list ------------------------------
ok('the next id follows the highest', nextArtifactSetId([{ id: 'a1' }, { id: 'a7' }]) === 'a8');
const duped = normaliseArtifacts({ active: 'a1', sets: [{ id: 'a1', slots: {} }, { id: 'a1', slots: {} }] });
ok('a repeated id in a file is made unique', new Set(duped.sets.map((s) => s.id)).size === 2);
ok('active falls back to the first when unknown', normaliseArtifacts({ active: 'zzz', sets: [{ id: 'a1', slots: {} }] }).active === 'a1');

console.log('');
console.log(`(${fail ? fail + ' FAILED, ' : ''}${pass} passed)`);
process.exit(fail ? 1 : 0);
