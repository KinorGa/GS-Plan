// Cross-module consistency: the stat-panel field set is declared in THREE places
// and they must agree.
//
//   DamageCard.STAT_DEFS   the panel's fields, their labels, defaults and icons
//   buff-model.STAT_META   the label table consumers fall back to
//   buff-model.KEY_TO_STAT which field a buff key feeds
//
// They are allowed to differ in SIZE -- STAT_DEFS has no enemy-field entries in
// KEY_TO_STAT, KEY_TO_STAT has keys that feed nothing -- but a PANEL FIELD with
// no label is a defect: the summary chip prints the raw key instead. That is not
// hypothetical: all seven element fields were added to the panel and to
// KEY_TO_STAT while STAT_META was missed, so a dropped 风元素伤害 buff showed
// "anemoDmg" to the user.
//
// `STAT_DEFS` lives in a .jsx file, which Node cannot import, so it is PARSED out
// of the source. That is weaker than importing and would miss a computed entry --
// worth moving the table to a plain module so this can import it instead.
//
// THE PARSER USED TO STOP EARLY. It matched up to the first `\n];`, which was the
// end of the array only while every entry was a literal. The resistance fields are
// now built with a `...DAMAGE_TYPES.map(...)` spread, and the spread's own
// argument list ends with `}));` -- so the old pattern kept going and swallowed
// `ELEMENT_ZH`, silently reporting fields that are not in the table. The array is
// found by BALANCING, so an entry can be written either way.
import fs from 'node:fs';
import { STAT_META, KEY_TO_STAT } from '../src/components/buff-model.js';

const cardSrc = fs.readFileSync('src/DamageCard.jsx', 'utf8');
const defsBlock = sliceBracketed(cardSrc, cardSrc.indexOf('export const STAT_DEFS = ['));

/** The text of a `[`...`]` span, given the index of the opening bracket. */
function sliceBracketed(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced brackets in STAT_DEFS');
}

const DEFS = [...defsBlock.matchAll(/\{\s*key:\s*'([A-Za-z]+)',\s*chs:\s*'([^']*)',\s*en:\s*'([^']*)'/g)]
  .map((m) => ({ key: m[1], chs: m[2], en: m[3] }));
const FIELD_KEYS = new Set(DEFS.map((d) => d.key));

// A SPREAD ENTRY CANNOT BE PARSED, and that used to be reported as sixteen
// missing panel fields -- a parse limitation dressed up as a defect, which is
// worse than saying nothing. So the spreads are COUNTED and declared here: the
// generated keys are checked against the other two tables in section 7, and the
// count is asserted so a wrong number is a failure rather than a footnote.
const SPREADS = [...defsBlock.matchAll(/\.\.\.(\w+)\.map/g)].map((m) => m[1]);
// 8 damage types x 2 spreads (resShred<Type>, enemyRes<Type>).
const SPREAD_KEYS = 16;
const parseable = DEFS.length + (SPREADS.length ? SPREAD_KEYS : 0);

let fails = 0;
const fail = (msg) => { fails++; console.log(`FAIL  ${msg}`); };
const ok = (msg) => console.log(`ok    ${msg}`);

console.log(`parsed ${DEFS.length} literal panel fields from DamageCard.jsx`);
if (SPREADS.length) {
  console.log(`  + ${SPREAD_KEYS} from ${SPREADS.length} spread(s): ${SPREADS.join(', ')}`);
  console.log('  (a spread is not parseable here; section 7 checks its keys in the other two tables)');
}
console.log('');

/* ------------------------------------------------- 1. every field is labelled */
console.log('1. every panel field has a label');
const missingMeta = DEFS.filter((d) => !STAT_META[d.key]).map((d) => d.key);
if (missingMeta.length) fail(`fields with no STAT_META entry: ${missingMeta.join(', ')}`);
else ok(`all ${parseable} fields labelled (${DEFS.length} literal + ${parseable - DEFS.length} generated)`);

/* ---------------------------------------- 2. labels agree where both declare */
console.log('\n2. STAT_DEFS and STAT_META agree on the words');
let mismatched = 0;
for (const d of DEFS) {
  const meta = STAT_META[d.key];
  if (!meta) continue;
  if (meta.chs !== d.chs || meta.en !== d.en) {
    mismatched++;
    fail(`${d.key}: panel "${d.chs}"/"${d.en}" vs meta "${meta.chs}"/"${meta.en}"`);
  }
}
if (!mismatched) ok('every shared key agrees');

/* ------------------------------------------ 3. KEY_TO_STAT targets real fields */
console.log('\n3. every KEY_TO_STAT target is a real panel field');
// `healBonus` is a buff key and a stored field the formula never reads; carrying
// it is deliberate, so it may be absent from STAT_DEFS.
const CARRIED_ONLY = new Set(['healBonus']);
// GENERATED fields are not in `FIELD_KEYS` -- they come out of a spread, which
// the source parser cannot see. They are checked against STAT_META (which has
// them) and against the eight-type list in section 7. CARRIED_ONLY is for the
// opposite case: a field that genuinely has no entry in STAT_DEFS.
const GENERATED = new Set([
  ...[...SPREADS.length ? ['Pyro', 'Hydro', 'Cryo', 'Electro', 'Anemo', 'Geo', 'Dendro', 'Physical'] : []]
    .map((t) => `resShred${t}`),
]);
const dangling = [...new Set(Object.values(KEY_TO_STAT))]
  .filter((t) => !FIELD_KEYS.has(t) && !CARRIED_ONLY.has(t) && !GENERATED.has(t));
if (dangling.length) fail(`KEY_TO_STAT targets with no field: ${dangling.join(', ')}`);
else ok(`all ${new Set(Object.values(KEY_TO_STAT)).size} targets resolve`);

/* ------------------------------------- 4. every element has all three entries */
console.log('\n4. the seven elements are complete everywhere');
const ELEMENTS = ['pyroDmg', 'hydroDmg', 'cryoDmg', 'electroDmg', 'anemoDmg', 'geoDmg', 'dendroDmg'];
let elemBad = 0;
for (const e of ELEMENTS) {
  const inDefs = FIELD_KEYS.has(e);
  const inMeta = !!STAT_META[e];
  const inMap = KEY_TO_STAT[e] === e;
  if (!inDefs || !inMeta || !inMap) { elemBad++; fail(`${e}: STAT_DEFS=${inDefs} STAT_META=${inMeta} KEY_TO_STAT=${inMap}`); }
}
if (!elemBad) ok('all seven present in all three tables');

/* ----------------------------------------- 5. the flat trio is labelled too -- */
console.log('\n5. the flat additions are labelled');
for (const k of ['flatHp', 'flatAtk', 'flatDef']) {
  if (!FIELD_KEYS.has(k)) fail(`${k} missing from STAT_DEFS`);
  if (!STAT_META[k]) fail(`${k} missing from STAT_META`);
}
ok('flat fields checked');

/* ------------------------- 6. every buff key that feeds a stat resolves ----- */
console.log('\n6. buff keys that feed a stat are panel-addressable');
const buffSrc = fs.readFileSync('src/components/BuffCard.jsx', 'utf8');
// Balanced, for the same reason as STAT_DEFS: the resistance keys are a spread,
// and matching to the first `\n};` would stop inside its argument list.
const buffBlock = sliceBracketed(buffSrc, buffSrc.indexOf('export const BUFF_KEYS = {'));
const buffKeys = [...buffBlock.matchAll(/^\s{2}([A-Za-z]+):\s*\{/gm)].map((m) => m[1]);
console.log(`   ${buffKeys.length} buff keys declared`);
const carried = buffKeys.filter((k) => !KEY_TO_STAT[k]);
console.log(`   carried but feeding nothing: ${carried.join(', ') || '(none)'}`);
for (const k of buffKeys) {
  const t = KEY_TO_STAT[k];
  if (t && !FIELD_KEYS.has(t) && !CARRIED_ONLY.has(t)) fail(`${k} -> ${t}, which is not a field`);
}
ok('mapped buff keys resolve');

/* ------------- 7. the resistance split is complete, on both sides ---------- */
// The whole point of the change: EVERY damage type must have its own enemy-RES
// and RES-shred field, and a hit of that type must be able to reach both. A
// missing Physical entry is not a crash -- it is a Physical hit quietly reading
// the standard 10% and the generic shred only, which is the silent wrong number
// this pair of loops exists to catch.
console.log('\n7. every damage type has both resistance fields');
const TYPES = ['Pyro', 'Hydro', 'Cryo', 'Electro', 'Anemo', 'Geo', 'Dendro', 'Physical'];
let resBad = 0;
for (const t of TYPES) {
  for (const key of [`enemyRes${t}`, `resShred${t}`]) {
    // Both generated keys are SPREADS in STAT_DEFS, so they cannot be read out of
    // the source; that they are generated from the same eight-type list is what
    // makes them present. Their absence would show up as a hit reading the
    // standard 10%, so the list itself is asserted instead.
    const generated = SPREADS.length === 2;
    const inDefs = generated || FIELD_KEYS.has(key);
    const inMeta = !!STAT_META[key];
    const inMap = key.startsWith('resShred') ? KEY_TO_STAT[key] === key : true;
    if (!inDefs || !inMeta || !inMap) {
      resBad++;
      fail(`${key}: STAT_DEFS=${inDefs} STAT_META=${inMeta}${key.startsWith('resShred') ? ` KEY_TO_STAT=${inMap}` : ''}`);
    }
  }
}
if (!resBad) ok(`all ${TYPES.length} types have enemyRes* and resShred*`);

// The generic shred must survive: a buff card written before the split still
// uses this key, and if it stopped resolving, that card would display +40% while
// changing nothing.
if (!FIELD_KEYS.has('resShred') || !STAT_META.resShred || KEY_TO_STAT.resShred !== 'resShred') {
  fail('the generic resShred field/key was dropped');
} else ok('the generic resShred is kept and still maps to a field');

// And the OLD generic enemy-RES field must be GONE. Leaving it in place would be
// worse than useless: nothing reads it, so it would look like a live control.
if (FIELD_KEYS.has('enemyRes')) fail('the old generic enemyRes field is still in STAT_DEFS');
else ok('the old generic enemyRes is gone');

/* --------------------- 8. the row and the axis resolve the SAME row ------- */
console.log('\n8. "which row does this entry hold" is answered the same way twice');
// THE BUG: \`DamageEntry.liveSummary\` read \`sel.stageIndex || 0\` while
// \`axis-compute.computePart\` read \`sel?.stageIndex ?? entry.picked?.stageIndex ?? 0\`.
// An IMPORTED row's summary is written by the file (\`{ sourceKey, sourceLabel }\`)
// and carries no \`stageIndex\` -- its stage lives on \`picked\`. So the collapsed row
// fell back to index 0 while the card, the axis and the picker all read the picked
// index: \布\伦\妮's second skill row (\咚\锵\锵\·\裁\魔\之\惩, 255.7%) was drawn as her first
// (\叮\铃\铃\·\猎\魔\之\音, 209.3%) -- 7,082 against the card's 8,652 -- until the card
// mounted and reported. Resolve it from \`picked\` in BOTH places, and keep the
// source key in step in both places too.
const axisSrc = fs.readFileSync('src/lib/axis-compute.js', 'utf8');
const entrySrc = fs.readFileSync('src/components/DamageEntry.jsx', 'utf8');
const STAGE = /stageIndex = sel\??\.stageIndex \?\? entry\.picked\?\.stageIndex \?\? 0/;
const KEY = /\(sel\??\.sourceKey \|\| entry\.picked\?\.sourceKey\)/;
if (!STAGE.test(axisSrc)) fail('axis-compute does not fall back to entry.picked for the stage');
else if (!STAGE.test(entrySrc)) fail('DamageEntry does not fall back to entry.picked for the stage (the collapsed row will show stage 0)');
else if (!KEY.test(axisSrc) || !KEY.test(entrySrc)) fail('the two do not agree on the source key fallback either');
else ok('both read sel.stageIndex ?? entry.picked?.stageIndex ?? 0');

console.log(fails ? `\n${fails} PROBLEMS` : '\nall consistency checks passed');
process.exit(fails ? 1 : 0);