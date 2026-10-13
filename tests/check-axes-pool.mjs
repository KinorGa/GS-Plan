// The pools: a configuration's repeated descriptors, written once and pointed at
// by index (see src/lib/axes-pool.js).
//
// The two ways this can go wrong are both silent, and both are covered here:
//
//   THE KEY IS TOO COARSE. Pool a buff by `key` alone and `atkPct = 25` swallows
//   `atkPct = 18`: a row comes back with a number it never had, which is a wrong
//   damage figure rather than a cosmetic difference. The VALUE is part of a
//   buff's identity, and so is the difference between a number and its string.
//
//   THE UNPACKED ROWS SHARE AN OBJECT. A pool that hands the same object to every
//   row turns "these two rows have the same value" into "these two rows are the
//   same row" -- editing one moves the other, and the app edits drops in place.
//
// It also pins the two directions of the file boundary: a document with no pools
// (every file written before this) still loads, and a pooled file loads to the
// same axes as the inline one.
import fs from 'node:fs';
import { packAxes, unpackAxes } from '../src/lib/axes-pool.js';
import { buildConfigFile, parseConfigFile } from '../src/lib/config-file.js';

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} ${ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

/* ------------------------------------------------------------- a fixture -- */

const source = { kind: 'artifact2', name: { chs: '天之美赐', en: 'Gift' }, owner: { id: 'c1' }, libKey: 'artifact:1:2' };
const otherSource = { ...source, libKey: 'artifact:2:2' };
const label = { ...source, stages: [{ chs: '技能伤害', mult: 1.5, hits: 1 }] };
const drop = (id, src, buffs) => ({ id, source: { ...src }, buffs: buffs.map((b) => ({ ...b })) });

const doc = {
  version: 2,
  activeId: 'ax1',
  axes: [{
    id: 'ax1',
    name: '',
    entries: [
      {
        id: 'e1',
        charId: 'c1',
        drops: [
          drop('d1', source, [{ key: 'atkPct', value: 25, tag: '' }]),
          drop('d2', source, [{ key: 'atkPct', value: 25, tag: '' }]),
        ],
        summary: { sourceKey: 'k', sourceLabel: label },
      },
      {
        id: 'e2',
        charId: 'c1',
        drops: [
          drop('d3', source, [{ key: 'atkPct', value: 18, tag: '' }]),
          drop('d4', source, [{ key: 'atkPct', value: '15', tag: '' }]),
          drop('d5', source, [{ key: 'atkPct', value: 15, tag: '' }]),
        ],
        summary: { sourceKey: 'k', sourceLabel: label },
      },
      {
        id: 'e3',
        kind: 'segment',
        name: '循环',
        children: [{ id: 'e4', charId: 'c2', drops: [drop('d6', otherSource, [])] }],
      },
    ],
  }],
};

console.log('1. the pool is built from the whole descriptor, value included');
const packed = packAxes(doc);
check('distinct sources', packed.pools.sources.length, 2);
// 25, 18, "15", 15 -- four buffs, not one. `25` is written twice and pooled once.
check('distinct buffs (value is identity)', packed.pools.buffs.map((b) => b.value), [25, 18, '15', 15]);
check('distinct source labels', packed.pools.sourceLabels.length, 1);

console.log('\n2. rows carry an index, and identical rows share it');
const rows = packed.axes[0].entries;
const d = (i, j) => rows[i].drops[j];
check('a drop has no inline source', 'source' in d(0, 0), false);
check('two identical drops, one pool entry', d(0, 0).sourceRef === d(0, 1).sourceRef, true);
check('two identical buffs, one pool entry', d(0, 0).buffRefs[0] === d(0, 1).buffRefs[0], true);
check('SAME key, different value -> different entry', d(1, 0).buffRefs[0] !== d(0, 0).buffRefs[0], true);
check('a number and its string are different entries', d(1, 1).buffRefs[0] !== d(1, 2).buffRefs[0], true);
check('the summary points at the label', 'sourceLabelRef' in rows[0].summary, true);
check('a segment s own children are pooled too', 'sourceRef' in rows[2].children[0].drops[0], true);

console.log('\n3. expanding gives back exactly the document that went in');
const back = unpackAxes(packed);
check('round trip is identical', JSON.stringify(back), JSON.stringify(doc));

console.log('\n4. expanding CLONES, so no two rows share an object to write through');
const b0 = back.axes[0].entries[0].drops[0];
const b1 = back.axes[0].entries[0].drops[1];
check('equal in value', JSON.stringify(b0.source), JSON.stringify(b1.source));
check('but not the same object', b0.source !== b1.source, true);
b0.source.name.chs = '改了';
check('editing one row leaves the other alone', b1.source.name.chs, '天之美赐');
check('and leaves the pool alone', packed.pools.sources[0].name.chs, '天之美赐');
b0.buffs[0].value = 99;
check('as does editing a buff', b1.buffs[0].value, 25);

console.log('\n5. a file from before the pools still loads');
const inline = { version: 1, axes: doc.axes, activeId: 'ax1' };
check('no pools -> passed through untouched', unpackAxes(inline) === inline, true);

console.log('\n6. a ref that names nothing is dropped, not guessed at');
const broken = unpackAxes({ pools: { sources: [], buffs: [] }, axes: [{ id: 'a', entries: [{ id: 'e', drops: [{ id: 'd', sourceRef: 9, buffRefs: [0, 4] }] }] }] });
const brokenDrop = broken.axes[0].entries[0].drops[0];
check('no source invented', 'source' in brokenDrop, false);
check('unknown buff refs dropped', brokenDrop.buffs, []);

console.log('\n7. the file the export writes is the file the import reads');
const text = buildConfigFile({ team: { units: [] }, axes: doc.axes, activeId: doc.activeId });
check('the pools are in the text', text.includes('"pools"'), true);
check('the kind is unchanged', JSON.parse(text).kind, 'lunaris-config');
check('the version moved to 2', JSON.parse(text).version, 2);
const viaPools = parseConfigFile(text);
const viaInline = parseConfigFile(JSON.stringify({ kind: 'lunaris-config', version: 1, team: { units: [] }, axes: doc.axes, activeId: doc.activeId }));
check('both routes load the same axes', JSON.stringify(viaPools.axes), JSON.stringify(viaInline.axes));

/* ------------------------------------------- the real rotation, when present */

const REAL = 'data/gcsim-config.json';
if (fs.existsSync(REAL)) {
  console.log('\n8. the imported 400-row rotation round-trips');
  // The file on disk is whatever this version writes, so the INLINE form is
  // derived from it rather than assumed -- the check is that packing and
  // expanding is the identity, whichever shape it starts in.
  const onDisk = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const real = unpackAxes(onDisk);
  const realPacked = packAxes(real);
  check('round trip is identical', JSON.stringify(unpackAxes(realPacked)), JSON.stringify(real));
  const before = JSON.stringify(real, null, 2).length;
  const after = JSON.stringify(realPacked, null, 2).length;
  console.log(`  info  pretty ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB`);
  check('it is one axis of many rows', real.axes.length, 1);
  check('every source is pooled to a handful', realPacked.pools.sources.length < 100, true);
  check('every buff is pooled to a handful', realPacked.pools.buffs.length < 200, true);
} else {
  console.log(`\n8. skipped: ${REAL} is not on this machine (it is gitignored)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);