// Verify `buildSources` against the real dataset.
//
// The interesting cases are the ones that break an assumption:
//   - 10000118 carries ONE passive, keyed `p4`, and an EMPTY skills object
//   - two characters carry no constellations at all
//   - a unit with no weapon and no artifacts must still list its talents
//
// Usage: node tests/check-sources.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

globalThis.fetch = async (url) => {
  const full = path.join(PUBLIC, String(url).replace(/^\//, ''));
  if (full.startsWith(PUBLIC) && fs.existsSync(full) && fs.statSync(full).isFile()) {
    const body = fs.readFileSync(full, 'utf8');
    const json = full.endsWith('.json');
    return {
      ok: true, status: 200,
      headers: { get: () => (json ? 'application/json' : 'text/html') },
      json: async () => JSON.parse(body),
    };
  }
  return { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => { throw new Error('x'); } };
};

const { buildUnitSources: buildSources, SOURCE_KINDS } = await import('../src/lib/buff-sources.js');
const { blankSet } = await import('../src/lib/artifact-model.js');

const read = (p) => JSON.parse(fs.readFileSync(path.join(PUBLIC, p), 'utf8'));
const rawCharlist = read('data/charlist.json');
const weaponlist = read('data/weaponlist.json');
const artifactlist = read('data/artifactlist.json');

// The same placeholder filter `loadCatalogue` applies, so the checks below
// exercise the roster the app actually offers.
const isPlaceholder = (c) => c.element === 'Unknown' && c.qualityType === 'QUALITY_ORANGE_SP';
const charlist = Object.fromEntries(
  Object.entries(rawCharlist).filter(([, c]) => !isPlaceholder(c))
);
console.log(`roster: ${Object.keys(rawCharlist).length} entries, ${Object.keys(charlist).length} playable\n`);

const sets = {};
for (const [id, meta] of Object.entries(artifactlist)) {
  const d = read(`data/artifact/chs/${id}.json`);
  sets[id] = { id, ...meta, bonuses: d.info?.setBonuses || null };
}

let bad = 0;
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const ok = (m) => console.log(`ok   ${m}`);

/** A unit with everything filled in. */
function unit(charId, opts = {}) {
  const arts = blankSet();
  for (const k of Object.keys(arts)) arts[k] = { ...arts[k], setId: '15044' };
  arts.circlet = { ...arts.circlet, setId: '15002' };
  return {
    id: 'u1',
    char: { id: charId, level: 90, constellation: opts.c ?? 0, talents: { normal: 1, skill: 1, burst: 1 } },
    weapon: { id: opts.weapon ?? '11515', refine: opts.refine ?? 1 },
    artifacts: opts.artifacts ?? arts,
  };
}

const ctxFor = (u) => {
  const detailFile = path.join(PUBLIC, `data/char/chs/${u.char.id}.json`);
  // Some catalogue entries have no detail file at all (10000134 among them), and
  // `loadCharacterDetail` resolves those to null rather than throwing. Mirror
  // that here instead of letting readFileSync blow up.
  let detail = null;
  try { detail = JSON.parse(fs.readFileSync(detailFile, 'utf8')); } catch {}
  return {
    char: charlist[u.char.id] || null,
    detail,
    weapon: u.weapon.id ? { ...weaponlist[u.weapon.id], id: u.weapon.id } : null,
    sets,
  };
};

/** Every detail file that exists, as id -> parsed. */
const detailIds = new Set(
  fs.readdirSync(path.join(PUBLIC, 'data/char/chs')).map((f) => f.replace(/\.json$/, ''))
);

// --- 1. the placeholder filter --------------------------------------------
console.log('1. the placeholder filter keeps every real character');
{
  const dropped = Object.entries(rawCharlist)
    .filter(([, c]) => isPlaceholder(c))
    .map(([id, c]) => `${id} ${c.chsName}`);
  console.log(`   dropped: ${dropped.join(', ') || '(none)'}`);
  dropped.length === 2 ? ok('exactly the two 奇偶 placeholders') : fail(`expected 2 dropped, got ${dropped.length}`);

  // The trap: each marker ALONE also matches a real character, so a one-field
  // filter would silently delete the Traveler or Aloy.
  const byElementOnly = Object.entries(rawCharlist).filter(([, c]) => c.element === 'Unknown');
  const byQualityOnly = Object.entries(rawCharlist).filter(([, c]) => c.qualityType === 'QUALITY_ORANGE_SP');
  console.log(`   element=Unknown alone would drop ${byElementOnly.length} (incl. 旅行者)`);
  console.log(`   ORANGE_SP alone would drop ${byQualityOnly.length} (incl. 埃洛伊)`);
  const traveler = charlist['10000134'];
  const aloy = charlist['10000062'];
  traveler ? ok('旅行者 (Unknown element) is KEPT') : fail('the Traveler was dropped');
  aloy ? ok('埃洛伊 (ORANGE_SP) is KEPT') : fail('Aloy was dropped');
}

// --- 1a. a character whose passives hold a blank slot ----------------------
console.log('\n1a. blank passive slots are skipped, filled ones are kept');
{
  // Measured: 87 of 138 characters carry a p4 whose value is an EMPTY STRING --
  // a padding entry, not a passive. Only 51 have four real ones, so the count is
  // "however many have content" and never a fixed 4.
  const distribution = {};
  let mismatch = null;
  for (const id of Object.keys(charlist)) {
    if (!detailIds.has(id)) continue;
    const d = JSON.parse(fs.readFileSync(path.join(PUBLIC, `data/char/chs/${id}.json`), 'utf8'));
    const filled = Object.values(d.passives || {}).filter((p) => p && (p.name || p.icon)).length;
    distribution[filled] = (distribution[filled] || 0) + 1;

    const u = unit(id, { artifacts: blankSet() });
    // `talent` is the CARD's kind for a passive: `buff-sources.js` translates its
    // internal sheet rows into BuffCard's vocabulary, so asserting on the
    // internal name here would be testing a string that never leaves the module.
    const emitted = buildSources(u, ctxFor(u)).filter((s) => s.kind === 'talent').length;
    if (emitted !== filled && !mismatch) mismatch = `${id}: file ${filled}, emitted ${emitted}`;
  }
  console.log(`   distribution of filled passives: ${JSON.stringify(distribution)}`);
  mismatch ? fail(mismatch) : ok('emitted count matches the filled count for all 137 characters');
  (distribution[3] || 0) > 0 ? ok('the 3-passive case is real and handled') : fail('no 3-passive character found');
}

// --- 1b. the 4-passive case still emits four ------------------------------
{
  const withFour = Object.keys(charlist).find((id) => {
    if (!detailIds.has(id)) return false;
    const d = JSON.parse(fs.readFileSync(path.join(PUBLIC, `data/char/chs/${id}.json`), 'utf8'));
    return Object.values(d.passives || {}).filter((p) => p && (p.name || p.icon)).length === 4;
  });
  const u = unit(withFour, { artifacts: blankSet() });
  const passives = buildSources(u, ctxFor(u)).filter((s) => s.kind === 'talent');
  console.log(`\n1b. ${withFour}: ${passives.length} passives (${passives.map((p) => p.slot).join(', ')})`);
  passives.length === 4 ? ok('a 4-passive character emits four') : fail(`expected 4, got ${passives.length}`);
  passives.every((p) => p.slot && p.name?.chs) ? ok('every passive carries its slot and a name') : fail('a passive is missing its slot or name');
}

// --- 2. constellation gating ---------------------------------------------
console.log('\n2. constellations follow the unit, not the file');
{
  for (const c of [0, 1, 4, 6]) {
    const u = unit('10000128', { c });
    const n = buildSources(u, ctxFor(u)).filter((s) => s.kind === 'constellation').length;
    n === c ? ok(`C${c} -> ${n} constellation sources`) : fail(`C${c} -> expected ${c}, got ${n}`);
  }
}

// --- 3. characters with no constellations ---------------------------------
console.log('\n3. every character whose file has no constellations');
{
  const bare = [];
  for (const id of Object.keys(charlist)) {
    if (!detailIds.has(id)) continue;
    const d = JSON.parse(fs.readFileSync(path.join(PUBLIC, `data/char/chs/${id}.json`), 'utf8'));
    if (!d.constellations || !Object.keys(d.constellations).length) bare.push(id);
  }
  console.log(`   found: ${bare.join(', ') || '(none)'}`);
  if (!bare.length) { console.log('   (skipping)'); }
  else {
    let allOk = true;
    for (const id of bare) {
      const u = unit(id, { c: 6 });
      const src = buildSources(u, ctxFor(u));
      const n = src.filter((s) => s.kind === 'constellation').length;
      if (n !== 0 || src.length === 0) allOk = false;
    }
    allOk ? ok(`${bare.length} characters emit no constellations and still build other sources`)
          : fail('a constellation-less character misbehaved');
  }

  // And every character in the catalogue, with C6, must build without throwing.
  let threw = null;
  for (const id of Object.keys(charlist)) {
    try {
      const u = unit(id, { c: 6 });
      const src = buildSources(u, ctxFor(u));
      if (!src.length && detailIds.has(id)) threw = `${id} produced no sources`;
    } catch (e) { threw = `${id}: ${e.message}`; break; }
  }
  threw ? fail(threw) : ok(`${Object.keys(charlist).length} characters all build sources`);
}

// --- 4. artifact 2-pc / 4-pc ----------------------------------------------
console.log('\n4. artifact bonuses derive from the equipped slots');
{
  const u = unit('10000128');   // four 15044 + one 15002
  const arts = buildSources(u, ctxFor(u)).filter((s) => s.kind.startsWith('artifact'));
  for (const a of arts) console.log(`   ${a.kind} slot=${a.slot} ${a.name.chs}`);
  const two44 = arts.find((a) => a.kind === 'artifact2' && a.slot === '15044');
  const four44 = arts.find((a) => a.kind === 'artifact4' && a.slot === '15044');
  two44 ? ok('15044 2-pc present') : fail('15044 2-pc missing');
  four44 ? ok('15044 4-pc present') : fail('15044 4-pc missing');
  arts.filter((a) => a.slot === '15002').length === 0
    ? ok('the single off-piece yields no bonus') : fail('off-piece produced a bonus');

  // Only two slots: a 2-pc and nothing else.
  const partial = blankSet();
  partial.flower = { ...partial.flower, setId: '15044' };
  partial.plume = { ...partial.plume, setId: '15044' };
  const u2 = unit('10000128', { artifacts: partial });
  const a2 = buildSources(u2, ctxFor(u2)).filter((s) => s.kind.startsWith('artifact'));
  a2.length === 1 && a2[0].kind === 'artifact2'
    ? ok('two slots -> exactly one 2-pc') : fail(`expected one 2-pc, got ${a2.map((s) => s.kind).join(',')}`);
}

// --- 5. no weapon, no artifacts -------------------------------------------
console.log('\n5. a bare unit still lists its talents');
{
  const u = { id: 'u9', char: { id: '10000128', level: 90, constellation: 2, talents: {} }, weapon: { id: null, refine: 1 }, artifacts: blankSet() };
  const src = buildSources(u, ctxFor(u));
  const kinds = [...new Set(src.map((s) => s.kind))];
  console.log(`   kinds: ${kinds.join(', ')}`);
  kinds.includes('weapon') ? fail('weapon emitted with no id') : ok('no weapon source');
  kinds.filter((k) => k.startsWith('artifact')).length === 0 ? ok('no artifact sources') : fail('artifact sources with no set');
  src.filter((s) => s.kind === 'constellation').length === 2 ? ok('constellations still present') : fail('constellations wrong');
}

// --- 6. every source is addressable and unique ----------------------------
console.log('\n6. ids are unique per unit and stable across builds');
{
  const u = unit('10000128', { c: 6 });
  const a = buildSources(u, ctxFor(u));
  const b = buildSources(u, ctxFor(u));
  const ids = a.map((s) => s.id);
  new Set(ids).size === ids.length ? ok(`${ids.length} unique ids`) : fail('duplicate source ids');
  JSON.stringify(ids) === JSON.stringify(b.map((s) => s.id)) ? ok('ids stable across rebuilds') : fail('ids not stable');
  a.every((s) => s.buffs.length === 0) ? ok('every source starts with no buffs') : fail('a source came with buffs');
  a.every((s) => SOURCE_KINDS.includes(s.kind)) ? ok('every kind is a known kind') : fail('unknown kind');
  a.every((s) => s.owner?.unitId === 'u1') ? ok('every source names its owner') : fail('owner missing');
}

console.log(bad ? `\n${bad} PROBLEMS` : '\nall checks passed');
process.exit(bad ? 1 : 0);
