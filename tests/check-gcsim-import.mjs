// Verify the gcsim importer produces a document the planner can actually load.
//
// Driven by a SYNTHETIC sample rather than the 5 MB dump, so it runs anywhere the
// char dataset is present: the importer's only inputs are the sample and the
// mapping table, and a two-hit log exercises the same merge / crit-mode / mapping
// branches a real one does.
//
// What is checked, in order of what would break a user silently:
//   - a mapped hit becomes a row with the right source, stage and HIT COUNT
//   - consecutive hits of one ability merge, and a mixed-crit run reads `avg`
//   - a reaction is ignored, but a constellation hit is REPORTED, never dropped
//     without a trace
//   - the team round-trips: effective talent levels (the C3/C5 +3), weapon id,
//     and the artifact SET the sample carried
//   - the whole document passes the app's own `parseConfigFile`
//
// Usage: node tests/check-gcsim-import.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad += 1; };
const ok = (m) => console.log(`ok   ${m}`);
const eq = (actual, expected, label) =>
  actual === expected ? ok(`${label} = ${JSON.stringify(expected)}`) : fail(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
const near = (actual, expected, label, tol = 1e-9) =>
  Math.abs(actual - expected) <= tol ? ok(`${label} ~ ${expected}`) : fail(`${label}: ${actual} != ${expected}`);

const read = (p) => JSON.parse(fs.readFileSync(path.join(PUBLIC, p), 'utf8'));

const { importGcsim } = await import('../scripts/gcsim-import.mjs');
const { parseConfigFile, describeImport } = await import('../src/lib/config-file.js');

const catalogues = {
  char: read('data/charlist.json'),
  weapon: read('data/weaponlist.json'),
  artifact: read('data/artifactlist.json'),
};
const mapping = read('data/gcsim-abilities.json');
const charId = '10000128';
const charData = { [charId]: read(`data/char/chs/${charId}.json`) };

/* --- 1. the log -> axis --------------------------------------------------- */
console.log('1. damage log becomes axis rows');
const sample = {
  // Everything the team needs is here: level, cons, talents, weapon, SETS.
  character_details: [{
    name: 'varka', element: 'anemo', cons: 6, level: 95,
    talents: { attack: 10, skill: 10, burst: 10 },
    weapon: { name: 'gestofthemightywolf', refine: 1, level: 90 },
    sets: { adaycarvedfromrisingwinds: 4 },
  }],
  target_details: [{ level: 110 }],
  logs: [
    { event: 'damage', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 100 } },
    // Two back-to-back hits of one ability: must merge into ONE row of 2.
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 50 } },
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: false, damage: 60 } },
    { event: 'damage', char_index: 0, frame: 12, logs: { abil: 'swirl-pyro', ele: 'pyro', crit: false, damage: 30 } },
    { event: 'damage', char_index: 0, frame: 13, logs: { abil: 'Varka C2', ele: 'anemo', crit: true, damage: 70 } },
    { event: 'calc', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', talent: 5.916 } },
  ],
};

const { doc, report } = importGcsim({ sample, mapping, catalogues, charData });

eq(report.damageEvents, 5, 'damage events');
eq(report.entries, 2, 'entries written');
eq(report.mappedHits, 3, 'mapped hits');
eq(report.ignoredHits, 1, 'ignored reaction hits');
eq(report.unmappedHits, 1, 'unmapped hits (C2) reported, not silently dropped');

const [first, second] = doc.axes[0].entries;
eq(first.summary.sourceKey, 'elementalskill', 'row 1 source');
eq(first.summary.sourceLabel.stages[0].chs, '技能伤害', 'row 1 stage');
eq(first.critMode, 'crit', 'row 1 all-crit -> crit');
near(first.summary.sourceLabel.stages[0].mult, 5.916, 'row 1 multiplier (L13, the C3-raised column)', 1e-6);
eq(first.statOverrides.enemyLevel, 110, 'enemy level carried onto the row');
eq(first.element, 'Anemo', 'hit element capitalised');
first.note?.startsWith('gcsim') ? ok(`row note: ${first.note}`) : fail('row 1 note missing');

eq(second.picked.stageIndex, 8, 'row 2 stage index');
eq(second.summary.sourceLabel.stages[8].chs, '苍噬伤害', 'row 2 stage name');
eq(second.summary.sourceLabel.stages[second.picked.stageIndex].hits, 2, 'row 2 hit count merged to 2');
eq(second.critMode, 'avg', 'row 2 mixed crit -> avg');
second.note?.includes('暴击混合') ? ok('row 2 note records the mixed crit') : fail('row 2 note');

/* --- 2. the team round-trips --------------------------------------------- */
console.log('\n2. team identity, from character_details alone');
const unit = doc.team.units[0];
eq(unit.char.id, charId, 'char id');
eq(unit.char.level, 95, 'char level');
eq(unit.char.constellation, 6, 'constellation');
eq(unit.char.talents.skill, 13, 'skill talent raised by C3 (+3)');
eq(unit.char.talents.burst, 13, 'burst talent raised by C5 (+3)');
eq(unit.weapon.id, '12515', 'weapon id resolved from gcsim name');
eq(unit.weapon.refine, 1, 'weapon refine');
eq(unit.artifacts.sets[0].slots.flower.setId, '15044', 'set filled its 4 slots');
eq(unit.artifacts.sets[0].slots.circlet.setId, null, 'the off-piece slot is left empty');

/* --- 3. the app's own reader accepts it ---------------------------------- */
console.log('\n3. parseConfigFile');
try {
  const parsedDoc = parseConfigFile(JSON.stringify(doc));
  const described = describeImport(parsedDoc);
  eq(described.units, 1, 'units');
  eq(described.axes, 1, 'axes');
  eq(described.entries, 2, 'entries');
  eq(parsedDoc.axes[0].entries[0].note, first.note, 'note survives a round trip');
} catch (e) {
  fail(`parseConfigFile threw: ${e.message}`);
}

console.log(bad ? `\n${bad} PROBLEMS` : '\nall checks passed');
process.exit(bad ? 1 : 0);