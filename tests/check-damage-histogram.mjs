// The axis summary's damage-segment histogram grouping.
//
// REF: src/components/AxisSummary.jsx (SegmentHistogram)
//
// The chart's x-axis is one stage's CAST NUMBER. These checks pin the two things
// that are easy to get backwards: parts of one compound row must stack in one
// occurrence, and two different stages/sources must not be merged just because
// their numbers are next to each other in the part list.
import { groupDamageSegments } from '../src/lib/damage-histogram.js';

let pass = 0, fail = 0;
const ok = (name, good, detail = '') => {
  if (good) { pass += 1; console.log('PASS  ' + name); }
  else { fail += 1; console.log('FAIL  ' + name + '  ' + detail); }
};
const close = (a, b) => Math.abs(a - b) < 1e-9;

const source = { key: 'elementalskill', name: '元素战技·烈风终坠' };
const part = (over) => ({
  charId: 'c',
  sourceKey: 'elementalskill',
  source,
  stageIndex: 7,
  stageName: '四风将起伤害',
  entryId: 'e17',
  order: 0,
  partIndex: 0,
  partCount: 1,
  element: 'Pyro',
  amount: 100,
  ...over,
});

const parts = [
  part({ entryId: 'e17', order: 0, partIndex: 0, element: 'Pyro', amount: 914276 }),
  part({ entryId: 'e17', order: 1, partIndex: 1, element: 'Anemo', amount: 451864 }),
  // Deliberately out of rotation order: grouping sorts by `order`.
  part({ entryId: 'e19', order: 4, partIndex: 0, element: 'Pyro', amount: 700000 }),
  part({ entryId: 'e18', order: 2, partIndex: 0, element: 'Pyro', amount: 800000 }),
  // Same source, different stage: must be its own group.
  part({ entryId: 'e20', order: 6, stageIndex: 1, stageName: '狂飙突进·一段伤害', amount: 500000 }),
  // Different source, same stage index: also its own group.
  part({ entryId: 'e21', order: 8, sourceKey: 'const2', source: { key: 'const2', name: '命之座 2' }, amount: 300000 }),
];

const groups = groupDamageSegments(parts);
ok('three source/stage groups', groups.length === 3, String(groups.length));

const rx = groups.find((g) => g.key === 'elementalskill|index:7');
ok('四风将起 stage is grouped separately', !!rx);
ok('three releases, not four parts', rx?.occurrences.length === 3, String(rx?.occurrences.length));
ok('occurrences are in rotation order',
  rx?.occurrences.map((o) => o.entryId).join(',') === 'e17,e18,e19');
ok('the two halves of one cast are one stacked occurrence',
  rx?.occurrences[0].parts.length === 2
  && rx?.occurrences[0].parts[0].partIndex === 0
  && rx?.occurrences[0].parts[1].partIndex === 1);
ok('the first cast totals both halves',
  close(rx?.occurrences[0].total, 914276 + 451864),
  String(rx?.occurrences[0].total));
ok('the stage has both segment indices',
  rx?.parts.map((p) => p.partIndex).join(',') === '0,1');
ok('the stage total sums every release',
  close(rx?.total, 914276 + 451864 + 800000 + 700000));

const stage1 = groups.find((g) => g.key === 'elementalskill|index:1');
ok('a different stage of the same source is not merged', stage1?.total === 500000);
const const2 = groups.find((g) => g.key === 'const2|index:7');
ok('the same stage index from another source is not merged', const2?.total === 300000);

const empty = groupDamageSegments([]);
ok('no parts produce no groups', Array.isArray(empty) && empty.length === 0);

// The selector's vocabulary comes from the source's stage table, not from the
// rows that happen to exist in the current axis.
const catalog = groupDamageSegments(parts, [
  { sourceKey: 'elementalskill', source, stageIndex: 7, stageName: '四风将起伤害' },
  { sourceKey: 'elementalskill', source, stageIndex: 0, stageName: '技能伤害' },
]);
const missing = catalog.find((g) => g.key === 'elementalskill|index:0');
ok('a stage absent from the axis is still selectable', !!missing);
ok('an absent stage has no occurrences and zero total',
  missing?.occurrences.length === 0 && missing?.total === 0);
ok('catalogue order is stable, not damage order',
  catalog[0]?.key === 'elementalskill|index:7'
  && catalog[1]?.key === 'elementalskill|index:0',
  catalog.map((g) => g.key).join(','));

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
