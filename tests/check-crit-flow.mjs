// Does a multi-part row's SUMMARY reflect the crit mode the user picked?
// The screenshots show the card changing (152,254 vs 39,963) while the row and the
// axis summary stay at 443,081 in both.
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('data/lunaris-config-2026-10-07.json', 'utf8'));
const ax = d.axes[0];

console.log('=== a SEGMENT: where does its critMode live? ===');
const multi = ax.entries.find((e) => (e.children || []).length);
console.log('parent entry.critMode      :', JSON.stringify(multi.critMode));
console.log('parent summary.critMode    :', JSON.stringify(multi.summary.critMode));
for (const c of multi.children) {
  console.log('  child part', c.partIndex,
    ' critMode:', JSON.stringify(c.critMode),
    ' figure:', c.figure ?? null);
}

console.log('');
console.log('=== a SINGLE row for comparison ===');
const single = ax.entries.find((e) => !(e.children || []).length);
console.log('entry.critMode   :', JSON.stringify(single.critMode));
console.log('summary.critMode :', JSON.stringify(single.summary.critMode));

console.log('');
console.log('=== so: whose critMode does the CARD actually read? ===');
console.log('For a single row, DamageEntry passes entry.critMode down.');
console.log('For a child, EntryGroup passes child.critMode.');
console.log('A child with critMode undefined -> the card defaults to avg.');
console.log('');
const anyChildCrit = multi.children.some((c) => c.critMode);
console.log('does ANY child in this file carry a critMode?', anyChildCrit);

console.log('');
console.log('=== AND: does the parent summary carry the CHILDREN sums? ===');
console.log('parent perHit:', multi.summary.perHit, ' (not damage)');
console.log('parent total :', multi.summary.total);
console.log('=> the axis summary has nothing real to read for a multi row.');
