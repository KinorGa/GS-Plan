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
//   - each row's buff cards are the ones ITS OWN hits carried, at the log's
//     numbers -- a self-buff that only reached 法尔伽 must not land on another
//     row, and a status that did not apply must not become a card
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
const talentDamage = read('data/talent-damage.json');
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
    // The `add stats` aggregate, in gcsim's own attribute order. Real varka
    // values, plus an Anemo goblet and a Dmg% the app has nowhere to put:
    //
    //   1 DEF%    2 DEF   3 HP    4 HP%   5 ATK   6 ATK%  7 ER   8 EM
    //   9 CR     10 CD   11 Heal 12 Pyro% 16 Anemo%        21 Dmg%
    stats: [
      0, 0.109, 18.5, 4780, 0, 357.7, 1.288, 0.065, 102.6, 0.397, 1.492,
      0, 0.3, 0, 0, 0, 0.466, 0, 0, 0, 0, 0.1, 0, 0, 0,
    ],
  }],
  target_details: [{ level: 110 }],
  logs: [
    { event: 'damage', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 100 } },
    // Two back-to-back hits of one ability: must merge into ONE row of 2.
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 50 } },
    { event: 'damage', char_index: 0, frame: 11, logs: { abil: 'Azure Devour', ele: 'anemo', crit: false, damage: 60 } },
    { event: 'damage', char_index: 0, frame: 12, logs: { abil: 'swirl-pyro', ele: 'pyro', crit: false, damage: 30 } },
    { event: 'damage', char_index: 0, frame: 13, logs: { abil: 'Varka C2', ele: 'anemo', crit: true, damage: 70 } },
    { event: 'damage', char_index: 0, frame: 14, logs: { abil: 'Made Up Ability', ele: 'anemo', crit: true, damage: 10 } },
    { event: 'calc', char_index: 0, frame: 10, logs: { abil: 'Windbound Execution', talent: 5.916 } },
  ],
};

/** The set bonuses `buildUnitSources` needs to name the 2/4-piece sources. */
const artifactInfo = read('data/artifact/chs/15044.json');
const setBonuses = { 15044: artifactInfo?.info?.setBonuses };
const { doc, report } = importGcsim({ sample, mapping, catalogues, charData, talentDamage });

eq(report.damageEvents, 6, 'damage events');
eq(report.entries, 3, 'entries written');
eq(report.mappedHits, 4, 'mapped hits');
eq(report.ignoredHits, 1, 'ignored reaction hits');
eq(report.unmappedHits, 1, 'unmapped hits reported, not silently dropped');

const [first, second, third] = doc.axes[0].entries;
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

// A constellation hit has no row on the talent table; it comes from the curated
// talent-damage.json, which is exactly why that file is passed to buildSources.
eq(third.summary.sourceKey, 'const2', 'row 3 source (curated constellation)');
eq(third.summary.sourceLabel.stages[0].chs, '攻击力倍率伤害', 'row 3 stage');
near(third.summary.sourceLabel.stages[0].mult, 8, 'row 3 multiplier (C2 = 800%)');
eq(third.critMode, 'crit', 'row 3 crit mode');

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
  eq(described.entries, 3, 'entries');
  eq(parsedDoc.axes[0].entries[0].note, first.note, 'note survives a round trip');
} catch (e) {
  fail(`parseConfigFile threw: ${e.message}`);
}

/* --- 4. the panel, from `add stats` -------------------------------------- */
console.log('\n4. the artifact aggregate becomes one substat row per stat');
const slots = doc.team.units[0].artifacts.sets[0].slots;
const subs = Object.values(slots).flatMap((p) => p.subStats).filter(Boolean);
const byKey = Object.fromEntries(subs.map((s) => [s.key, s.value]));
eq(byKey.atkPct, 128.8, 'ATK% 1.288 becomes the panel\'s 128.8');
eq(byKey.atk, 357.7, 'flat ATK stays flat');
eq(byKey.hp, 4780, 'flat HP');
eq(byKey.critRate, 39.7, 'CRIT Rate 0.397 becomes 39.7');
eq(byKey.critDmg, 149.2, 'CRIT DMG 1.492 becomes 149.2');
eq(byKey.em, 102.6, 'EM is already a flat number');
eq(byKey.er, 6.5, 'ER 0.065 becomes 6.5');
eq(subs.filter((s) => s.key === 'atkPct').length, 1, 'the whole total is ONE row, not split into rolls');
// A goblet's element bonus is a MAIN stat, so it can only take a value the
// artifact curve has -- 0.466 is the +20 row, and that is where it lands.
eq(slots.goblet.mainStat, 'anemoDmg', 'an element bonus becomes the goblet main stat');
eq(slots.goblet.level, 20, 'at the level whose curve value it is');
eq(doc.team.units[0].artifacts.sets[0].slots.circlet.mainStat, null, 'nothing is invented on the off-piece');
// A number the app cannot hold is REPORTED, not silently dropped.
eq(
  report.statNotes.some((n) => n.kind === 'stat-unmapped' && n.index === 21),
  true,
  'a Dmg% the app has no field for is reported'
);
eq(
  report.statNotes.some((n) => n.kind === 'stat-unrepresentable' && n.key === 'pyroDmg'),
  true,
  'an element value that is not on the curve is reported rather than rounded'
);
eq(
  report.statNotes.some((n) => n.kind === 'stat-unmapped' && n.index === 12),
  false,
  'the representable pyro% does not raise a note'
);

/* --- 5. the buff cards, from each row's OWN hits ------------------------- */
console.log('\n5. buff cards follow the sample, row by row');
// The statuses a `damage` event lists are the ones that were LIVE for that hit,
// and the numbers they carry are the ones gcsim applied. So a row's cards are a
// fact about ITS OWN hits, not a team-wide apply: 法尔伽's C6 CRIT DMG reaches
// his rows because his hits carry the status, and nobody else's.
//
// The sample above carries no statuses at all, so nothing is attached -- which
// is the first thing to check.
eq(doc.axes[0].entries.every((e) => e.drops.length === 0), true, 'a log with no statuses attaches no cards');

const buffSample = {
  ...sample,
  logs: [
    // TWO statuses, ONE source: `a1-anemo` and `a1-pyro` are both p1, so they
    // must come out as a single card holding both.
    { event: 'damage', char_index: 0, frame: 20, logs: {
      abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 100,
      'varka-a1-anemo': ['status: added', 'expiry_frame: -1', 'anemo%: 0.25'],
      'varka-a1-pyro': ['status: added', 'expiry_frame: -1', 'pyro%: 0.25'],
      'a-day-carved-from-rising-winds-2pc': ['status: added', 'atk%: 0.18'],
    } },
    // Two hits of one ability: the status on BOTH hits is ONE mod, so one card
    // with one buff -- not two.
    { event: 'damage', char_index: 0, frame: 21, logs: {
      abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 50,
      'varka-c6-cdmg': ['status: added', 'expiry_frame: -1', 'cd: 0.80'],
    } },
    { event: 'damage', char_index: 0, frame: 21, logs: {
      abil: 'Azure Devour', ele: 'anemo', crit: false, damage: 60,
      'varka-c6-cdmg': ['status: added', 'expiry_frame: -1', 'cd: 0.80'],
    } },
    // The 4-piece's two halves are separate statuses, and both are its card.
    { event: 'damage', char_index: 0, frame: 22, logs: {
      abil: "Four Winds' Ascension", ele: 'anemo', crit: true, damage: 80,
      'blessing-of-pastoral-winds': ['status: added', 'atk%: 0.25'],
      'resolve-of-pastoral-winds': ['status: added', 'cr: 0.20'],
      'a-day-carved-from-rising-winds-2pc': ['status: added', 'atk%: 0.18'],
    } },
    // Everything that must NOT become a card -- and must be REPORTED instead.
    { event: 'damage', char_index: 0, frame: 23, logs: {
      abil: 'Varka C2', ele: 'anemo', crit: true, damage: 70,
      'lost-prayer': ['status: added', 'reason: conditions not met'],
      'made-up-status': ['status: added', 'atk%: 0.5'],
      'a-day-carved-from-rising-winds-2pc': ['status: added', 'weird%: 1'],
      'prune-c2': ['status: added', 'atk%: 0.40'],
    } },
  ],
};
const buffed = importGcsim({ sample: buffSample, mapping, catalogues, charData, talentDamage, setBonuses });
const bids = buffed.doc.axes[0].entries;
const keys = (e) => e.drops.map((d) => d.source.libKey).filter(Boolean);
eq(bids.length, 4, 'four rows');
eq(buffed.report.damageEvents, 5, 'five hits');

// 1. per-row attribution, and values come from the LOG, already x100.
eq(keys(bids[0]).join(' | '), 'artifact:15044:2 | talent:10000128:p1', 'row 1 cards, sorted by source key');
eq(
  bids[0].drops.find((d) => d.source.libKey === 'talent:10000128:p1').buffs
    .map((b) => `${b.key}=${b.value}`).join(','),
  'anemoDmg=25,pyroDmg=25',
  'two statuses naming one source become one card holding both'
);
eq(bids[0].drops[0].buffs[0].value, 18, "a fraction becomes the panel's percent (0.18 -> 18)");
eq(bids[0].drops[0].source.kind, 'artifact2', 'the card keeps the source kind the pool renders');
eq(bids[0].drops[0].source.owner.id, charId, 'and the owner, so a formula would read the right panel');

// 2. a status listed on several hits of one row is ONE mod.
eq(keys(bids[1]).length, 1, 'row 2 carries one card');
eq(bids[1].drops[0].buffs.length, 1, 'the repeated status is one buff, not two');
eq(bids[1].drops[0].buffs[0].value, 80, "C6 CRIT DMG, from the log's own 0.80");
eq(bids[1].drops[0].source.rank, 'C6', 'the constellation keeps its rank chip');

// 3. the 4-piece has two statuses; both land on its one card.
eq(keys(bids[2]).join(' | '), 'artifact:15044:2 | artifact:15044:4', 'row 3 cards');
eq(
  bids[2].drops[1].buffs.map((b) => `${b.key}=${b.value}`).join(','),
  'atkPct=25,critRate=20',
  '风起之日 4件套 carries both halves'
);

// 4. a drop is PER-ROW state: the shared source is copied, not aliased.
const a2 = bids[0].drops.find((d) => d.source.libKey === 'artifact:15044:2');
const c2 = bids[2].drops.find((d) => d.source.libKey === 'artifact:15044:2');
eq(a2 !== c2, true, 'two rows share a source key but not one object');
a2.buffs[0].value = 1;
eq(c2.buffs[0].value, 18, 'editing one row leaves the other alone');

// 5. nothing becomes a card that should not, and every reason is REPORTED.
eq(bids[3].drops.length, 0, 'row 4 attaches nothing');
const notes = buffed.report.buffs.notes;
eq(notes.some((n) => n.kind === 'buff-inactive' && n.status === 'lost-prayer'), true, 'a `reason:` status reads as "did not apply", not as unreadable');
eq(notes.some((n) => n.kind === 'buff-status-unknown' && n.status === 'made-up-status'), true, 'a status the table does not name is reported');
eq(notes.some((n) => n.kind === 'buff-line-unknown' && n.line === 'weird%'), true, 'a stat line the app cannot read is reported');
eq(notes.some((n) => n.kind === 'buff-source-missing' && n.source === 'constellation:10000132:c2'), true, 'a source this team does not have is reported, not dropped quietly');

// 6. the report says which source reached how far.
eq(
  buffed.report.buffs.cards.map((c) => c.libKey).sort().join(' | '),
  'artifact:15044:2 | artifact:15044:4 | constellation:10000128:c6 | talent:10000128:p1',
  'the report names every attached source'
);
eq(buffed.report.buffs.cards.find((c) => c.libKey === 'artifact:15044:2').hits, 2, 'the 2-piece reached two of the five hits');

console.log(bad ? `\n${bad} PROBLEMS` : '\nall checks passed');
process.exit(bad ? 1 : 0);