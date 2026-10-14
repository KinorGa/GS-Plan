// Verify the gcsim importer produces a document the planner can actually load.
//
// Driven by a SYNTHETIC sample rather than the 5 MB dump, so it runs anywhere the
// char dataset is present: the importer's only inputs are the sample and the
// mapping table, and a two-hit log exercises the same merge / crit-mode / mapping
// branches a real one does.
//
// What is checked, in order of what would break a user silently:
//   - a mapped hit becomes a row with the right source, stage and HIT COUNT
//   - the hits of ONE cast (same `source_frame`) become one entry even when
//     another ability lands between them, and a part that is not the same hit
//     twice (a moved stack, a mixed crit) keeps one child per distinct outcome
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
    // Two hits of one ability, one crit and one not: the same SKILL, but not
    // the same HIT -- they must not be averaged into a single number.
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
eq(second.summary.sourceLabel.stages[second.picked.stageIndex].hits, 2, 'row 2 keeps both of its hits');
eq(second.critMode, 'avg', 'row 2 mixed crit -> avg at the row level');
second.note?.includes('暴击混合') ? ok('row 2 note records the mixed crit') : fail('row 2 note');
// ONE CRIT AND ONE NOT IS NOT ONE HIT. A single child could only report their
// AVERAGE, which matches neither roll -- so the run keeps one child per outcome.
eq(second.children?.length, 2, 'a mixed-crit part splits into one child per outcome');
eq(second.children.map((c) => c.critMode).join(','), 'crit,never', 'each child keeps its own crit outcome');

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
      abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 60,
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

// 2. a repeated hit is TWO INDEPENDENT PARTS, not one `×2` row.
//
// gcsim logged two Azure Devour hits on the same frame. They used to merge into
// one child carrying `hits: 2`, which the row drew as `×2 = ...`; a reaction or a
// stack that moved BETWEEN the two could then only be reported as their average.
// The row now holds one child per hit, and each keeps its own card -- the parent
// owns none, which is the whole reason the split exists.
eq(bids[1].children?.length, 2, 'two logged hits become two independent parts');
eq(bids[1].drops.length, 0, 'the parent holds no card of its own');
eq(bids[1].children.every((c) => c.drops.length === 1), true, 'each part keeps its own card');
eq(bids[1].children[0].drops[0].buffs.length, 1, 'the status is one buff, not two');
eq(bids[1].children[0].drops[0].buffs[0].value, 80, "C6 CRIT DMG, from the log's own 0.80");
eq(bids[1].children[0].drops[0].source.rank, 'C6', 'the constellation keeps its rank chip');

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

/* --- 6. a run of distinct parts splits, and the axis agrees ---------------- */
console.log('\n6. distinct parts become children, and the axis computes each one');
// 苍噬 (Azure Devour) fires two halves in ONE cast. gcsim logs them back to
// back with different elements and different \`calc.talent\` values, and they
// must NOT be merged into one row: the halves meet different resistances and
// carry different coefficients, so a single number is a number that belongs to
// neither of them.
const splitSample = {
  ...sample,
  logs: [
    { event: 'damage', char_index: 0, frame: 30, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 100 } },
    { event: 'calc', char_index: 0, frame: 30, logs: { abil: 'Azure Devour', talent: 1.5 } },
    { event: 'damage', char_index: 0, frame: 31, logs: { abil: 'Azure Devour', ele: 'cryo', crit: true, damage: 200 } },
    { event: 'calc', char_index: 0, frame: 31, logs: { abil: 'Azure Devour', talent: 3.0 } },
  ],
};
const split = importGcsim({ sample: splitSample, mapping, catalogues, charData, talentDamage, setBonuses });
const splitRows = split.doc.axes[0].entries;
eq(splitRows.length, 1, 'one cast is one entry, not one row per hit');
const parent = splitRows[0];
eq(parent.children?.length, 2, 'two distinct parts become two children');
eq(parent.summary.parts?.length, 2, 'the summary carries a part per child');
eq(parent.children.map((c) => c.partIndex).join(','), '0,1', 'children are indexed by part');
eq(parent.children[0].element, 'Anemo', 'part 1 keeps its own element');
eq(parent.children[1].element, 'Cryo', 'part 2 keeps its own element');
// The only card a status-less hit carries is the 倍率乘区 ratio the importer
// derives from gcsim's coefficient -- no log status became a card.
eq(
  parent.children.every((c) => c.drops.length === 1 && c.drops[0].source.libKey === 'mult-zone'),
  true,
  'a log with no statuses attaches only the 倍率乘区 ratio card',
);
// The row must be able to NAME ITSELF without a card: the parent header reads
// the stored summary, and a card only reports one once the row is expanded --
// which is why an imported compound row showed "—" until it was opened, and
// then appeared to change into 苍噬伤害 on expand.
eq(
  Boolean(parent.summary.sourceLabel?.stages?.[parent.picked?.stageIndex]),
  true,
  'the parent carries its own stage label (the header can name it before any card mounts)'
);

// The numbers themselves: the axis must compute each child at GCSIM'S
// coefficient. That coefficient is no longer stored absolutely -- it is the
// TABLE's coefficient times the 倍率乘区 ratio the importer derived from
// \`calc.talent\` -- so the check multiplies the pair back together. Doing it that
// way is also what proves the pair is right: the row keeps a clean table number
// (which follows a later talent-level change) and the product still equals what
// gcsim rolled.
const multZoneRatio = (entry) => {
  const card = entry.drops.find((d) => d.source.libKey === 'mult-zone');
  return card?.buffs?.[0]?.value ?? 1;
};
const { computeAxis } = await import('../src/lib/axis-compute.js');
const { activeArtifacts } = await import('../src/lib/artifact-sets.js');
const stats = read('data/stats-compact.json');
const catalogue = {
  chars: read('data/charlist.json'),
  weapons: read('data/weaponlist.json'),
  stats,
};
const crew = split.doc.team.units.map((u) => ({
  id: u.char.id,
  element: catalogue.chars[u.char.id]?.element,
  level: u.char.level ?? 90,
  constellation: u.char.constellation ?? 0,
  refine: u.weapon?.refine ?? 1,
  talents: u.char.talents || null,
  weaponId: u.weapon?.id ?? null,
  artifacts: activeArtifacts(u),
  detail: charData[u.char.id],
}));
const axis = computeAxis(split.doc.axes[0].entries, crew, catalogue, talentDamage);
const computed = axis.byId.get(parent.id);
eq(computed.parts.length, 2, 'the axis computes both parts');
near(computed.parts[0].mult * multZoneRatio(parent.children[0]), 1.5, "part 1 computes to gcsim's coefficient", 1e-6);
near(computed.parts[1].mult * multZoneRatio(parent.children[1]), 3.0, "part 2 computes to gcsim's coefficient", 1e-6);
eq(computed.parts[0].element, 'Anemo', 'part 1 is measured against its own element');
eq(computed.parts[1].element, 'Cryo', 'part 2 is measured against its own element');
near(
  computed.total,
  computed.parts.reduce((n, p) => n + p.total, 0),
  'the row total is the sum of its parts (nothing double-counts, nothing is dropped)',
  1e-9
);
eq(computed.parts[1].perHit > computed.parts[0].perHit, true, 'the larger coefficient hits harder');

/* --- 6b. a repeated hit splits too, not just a distinct one ---------------- */
console.log('\n6b. a repeated hit is one part per hit, not one `×2` row');
// THE ROOT OF "it shows four when collapsed but two when expanded". The TABLE
// spells a repeat (`168.48%*2`) and the row kept it as `hits: 2`, while a gcsim
// run logs each hit, so the same talent read `4 段` imported and `2 段` from the
// table. Both now split: a part is always ONE hit.
const repeated = {
  ...sample,
  logs: [
    { event: 'damage', char_index: 0, frame: 50, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 100 } },
    { event: 'calc', char_index: 0, frame: 50, logs: { abil: 'Azure Devour', talent: 1.5 } },
    { event: 'damage', char_index: 0, frame: 50, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 100 } },
    { event: 'calc', char_index: 0, frame: 50, logs: { abil: 'Azure Devour', talent: 1.5 } },
  ],
};
const rep = importGcsim({ sample: repeated, mapping, catalogues, charData, talentDamage, setBonuses });
const repRow = rep.doc.axes[0].entries[0];
eq(repRow.children?.length, 2, 'two identical hits are still two parts, not one ×2');
eq(repRow.summary.parts.every((p) => p.hits === 1), true, 'every part is exactly ONE hit');
eq(repRow.summary.partCount, 2, 'the row counts its parts, not its kinds of hit');

/* --- 7. one cast, however its hits are interleaved -------------------------- */
console.log('\n7. a cast is a cast, even when another ability lands between its hits');
// THE BUG THIS GUARDS. 杜林's burst fires its three parts on ONE frame, but gcsim
// does not always log them back to back -- other abilities land between them.
// Merging only CONSECUTIVE same-ability hits therefore split the cast 2+1 and
// the row read "2 段" where the log has three. The cast is the unit: every
// damage event carries the `source_frame` its cast began on, so grouping by
// (character, ability, source_frame) keeps all three together.
const interleaved = {
  ...sample,
  logs: [
    { event: 'damage', char_index: 0, frame: 40, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 100, source_frame: 40 } },
    { event: 'calc', char_index: 0, frame: 40, logs: { abil: 'Azure Devour', talent: 1.5 } },
    // Another ability's hit lands INSIDE the cast: the old adjacency rule cut
    // the cast apart here.
    { event: 'damage', char_index: 0, frame: 41, logs: { abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 10, source_frame: 41 } },
    { event: 'damage', char_index: 0, frame: 42, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 200, source_frame: 40 } },
    { event: 'calc', char_index: 0, frame: 42, logs: { abil: 'Azure Devour', talent: 3.0 } },
    { event: 'damage', char_index: 0, frame: 44, logs: { abil: 'Azure Devour', ele: 'anemo', crit: true, damage: 300, source_frame: 40 } },
    { event: 'calc', char_index: 0, frame: 44, logs: { abil: 'Azure Devour', talent: 4.5 } },
  ],
};
const woven = importGcsim({ sample: interleaved, mapping, catalogues, charData, talentDamage, setBonuses });
const burst = woven.doc.axes[0].entries
  .find((e) => e.summary.sourceKey === 'elementalskill' && e.picked.stageIndex === 8);
eq(Boolean(burst), true, 'the cast is one entry');
eq(burst.children?.length, 3, 'all three parts of the cast stay in ONE entry');
// The parts carry the TABLE's coefficients now; gcsim's situational factor rides
// as a 倍率乘区 card on each child, so the PRODUCT is what has to match.
const wovenCoef = (i) => burst.summary.parts[i].mult * multZoneRatio(burst.children[i]);
[1.5, 3, 4.5].forEach((want, i) =>
  near(wovenCoef(i), want, `part ${i + 1} still computes to gcsim's coefficient`, 1e-6));
// AND EACH PART REPORTS ITS OWN INDEX. The axis used to hand back the CLAMPED
// table index, so a row with more children than the table has parts collapsed
// onto the last one: `EntryGroup` matches a child to its figure by index, so the
// row printed a dash where a part was missing and the SAME number twice where two
// children shared an index. 苍噬's drifted cast measured exactly that.
const wovenParts = computeAxis(woven.doc.axes[0].entries, crew, catalogue, talentDamage).byId.get(burst.id).parts;
eq(wovenParts.map((p) => p.partIndex).join(','), '0,1,2', 'a part keeps its own index past the table\'s part count');

/* --- 8. a coordinated attack lands on the 附伤 row, not on a talent --------- */
console.log('\n8. a team ability lands on the 附伤 row of ITS OWN damage type');
// 尼可 C1's coordinated attack (奥迹造影·合一 / `Arcane Projection: Unity`) fires
// under whoever is ON FIELD, so gcsim files it under THAT character, with their
// own calc, under an ability name that answers no row of their talent table.
// Mapping it to a talent row -- which the table used to do, per character, by
// hand -- put 14 hits of an Anemo coordinated attack on 法尔伽's 元素爆发, a talent
// the rotation never used. It now lands on the universal 附伤 row of the hit's own
// element, which every character carries for exactly this (`flatDamageSources`).
const coord = {
  ...sample,
  logs: [
    { event: 'damage', char_index: 0, frame: 60, logs: { abil: 'Arcane Projection: Unity', ele: 'anemo', crit: true, damage: 270792.5 } },
    { event: 'calc', char_index: 0, frame: 60, logs: { abil: 'Arcane Projection: Unity', talent: 7.1604 } },
  ],
};
const coordRun = importGcsim({ sample: coord, mapping, catalogues, charData, talentDamage, setBonuses });
const flatRows = coordRun.doc.axes[0].entries;
const flat = flatRows[0];
eq(flatRows.length, 1, 'the coordinated attack is ONE row');
eq(flat.summary.sourceKey, 'flatdmg-anemo', 'it is the Anemo 附伤 row');
eq(flat.summary.sourceLabel.chs, '附伤·风', 'labelled 附伤, not 元素爆发');
eq(flat.summary.sourceLabel.stages[0].chs, '附伤', 'the source carries one 附伤 stage');
eq(flat.scaling?.mult, 7.1604, "the multiplier comes from the run's own calc");
eq(flat.element, 'Anemo', 'the hit keeps the element the log gave it');
eq(flat.charId, '10000128', 'the damage still belongs to the character who dealt it');
eq(
  flatRows.some((e) => e.summary.sourceKey === 'elementalburst'),
  false,
  'nothing lands on 元素爆发'
);
// And the row computes: the 附伤 source is on the character's own list, so the
// axis can price it rather than falling back to `sources[0]`.
const coordParts = computeAxis(flatRows, crew, catalogue, talentDamage).byId.get(flat.id).parts;
eq(coordParts.length, 1, 'the axis computes its single part');
eq(coordParts[0].element, 'Anemo', 'and prices it as Anemo');

// 8b. the calc-only cards follow a TEAM ability too.
// 尼可's C4 flat and C6 ignore-def exist ONLY on the calc event -- no damage
// event ever lists them as a status -- so the guard that decodes them has to
// accept a `teamAbilities` ability as well as a per-character one. It used to
// look the ability up in the per-character table alone, and the moment
// `Arcane Projection: Unity` moved to `teamAbilities` every one of those cards
// vanished: the row fell to 42-53% of what gcsim rolled.
console.log('\n8b. a team ability keeps its calc-only cards (尼可 C4 / C6)');
const coordCalc = {
  ...sample,
  character_details: [
    sample.character_details[0],
    // The coordinated attack is 尼可's, so her constellations must be on the
    // team for `buildUnitSources` to have a source to hand the cards to.
    {
      name: 'nicole', element: 'pyro', cons: 6, level: 95,
      talents: { attack: 10, skill: 10, burst: 10 },
      weapon: sample.character_details[0].weapon, sets: {}, stats: [],
    },
  ],
  logs: [
    { event: 'damage', char_index: 0, frame: 60, logs: { abil: 'Arcane Projection: Unity', ele: 'anemo', crit: true, damage: 270792.5 } },
    { event: 'calc', char_index: 0, frame: 60, logs: { abil: 'Arcane Projection: Unity', talent: 6, flat_dmg: 14217.207703220192, ignore_def: 0.4 } },
  ],
};
const coordCalcCharData = { ...charData, 10000131: read('data/char/chs/10000131.json') };
const coordCalcRun = importGcsim({
  sample: coordCalc, mapping, catalogues, charData: coordCalcCharData, talentDamage, setBonuses,
});
const coordFlat = coordCalcRun.doc.axes[0].entries[0];
const cardValue = (entry, libKey, key) => {
  const card = entry.drops.find((d) => d.source.libKey === libKey);
  return (card?.buffs || []).find((b) => b.key === key)?.value;
};
eq(
  coordFlat.drops.some((d) => d.source.libKey === 'constellation:10000131:c6'),
  true,
  "尼可's C6 rides the 附伤 row"
);
eq(cardValue(coordFlat, 'constellation:10000131:c6', 'defIgnore'), 40, 'and carries the 40% defence ignore');
near(cardValue(coordFlat, 'talent:10000131:p4', 'flatDmg'), 14217.207703, "尼可's p4 flat_dmg rides it too", 1e-6);

/* --- 9. the calc event corrects the log's ROUNDED stats ------------------- */
console.log('\n9. the calc event carries the stats the log only rounds');
// Every `dmg%` / `cd` a status contributes is written to the log at TWO DECIMALS,
// but the calc event carries the EXACT totals the run applied (`bonus_dmg`,
// `ele_per`, `cd`). 法尔伽's Wolf weapon shows 7.5% CRIT DMG per stack, logged as
// 22 at three stacks where the run used 22.5 -- summing the rounded cards left
// the row 0.1-0.4% low. The mismatch is reconciled against the calc, onto the
// hit's largest matching card, and the corrected value still rounds to what the
// log showed.
const rounded = {
  ...sample,
  logs: [
    {
      event: 'damage', char_index: 0, frame: 80,
      logs: {
        abil: 'Windbound Execution', ele: 'anemo', crit: true, damage: 1,
        // 7.5% CRIT DMG AND DMG per stack, three stacks: the real 22.5, logged 22.
        'gest-of-the-mighty-wolf-stacks': ['status: added', 'expiry_frame: 100', 'cd: 0.22', 'dmg%: 0.22'],
      },
    },
    {
      event: 'calc', char_index: 0, frame: 80,
      // `ele_per` is the panel's Anemo goblet (0.466); the run's total 伤害加成 is
      // 0.691, i.e. a generic 0.225 -- not the 0.22 the status line rounded to.
      // No `cr`: this hit carries no CRIT Rate source, and a rate the log cannot
      // name is exactly what the cap is there to REPORT rather than fold in.
      logs: { abil: 'Windbound Execution', talent: 5.916, cd: 2.601, ele_per: 0.466, bonus_dmg: 0.691 },
    },
  ],
};
const roundRun = importGcsim({ sample: rounded, mapping, catalogues, charData, talentDamage, setBonuses });
const roundRow = roundRun.doc.axes[0].entries[0];
near(cardValue(roundRow, 'weapon:12515:r1', 'dmgBonus'), 22.5, 'the rounded 22% DMG card is reconciled to 22.5', 1e-6);
near(cardValue(roundRow, 'weapon:12515:r1', 'critDmg'), 22.5, 'the rounded 22% CRIT DMG card too', 1e-6);
eq(
  (roundRun.report.buffs.notes || []).some((n) => n.kind?.startsWith('buff-calc-stat')),
  false,
  'a live calc leaves no rounding note: the residue was fully explained'
);

console.log(bad ? `\n${bad} PROBLEMS` : '\nall checks passed');
process.exit(bad ? 1 : 0);
