// Segment.update is the one walk every row edit goes through. It must report a
// no-op as a no-op: callers such as the summary reporter rely on the SAME list
// reference to stop a report -> write -> render cycle. Returning a fresh list
// made the debounced axes save reset on every render, so nested notes never hit
// localStorage while their card was open.
import * as Segment from '../src/lib/rotation-segment.js';

let pass = 0, fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + '  ' + detail); }
};

const plain = { id: 'e1', note: '', statOverrides: {} };
const member = { id: 'e2', note: '', statOverrides: {} };
const loop = { id: 's1', kind: 'segment', children: [member] };
const list = [plain, loop];

ok('unknown id returns the same list', Segment.update(list, 'missing', (e) => ({ ...e })) === list);
ok('a same-entry replacement returns the same top-level list', Segment.update(list, 'e1', (e) => e) === list);
ok('a same-entry replacement returns the same loop list', Segment.update(list, 'e2', (e) => e) === list);

const top = Segment.update(list, 'e1', (e) => ({ ...e, note: 'top' }));
ok('a real top-level edit returns a new list', top !== list);
ok('a real top-level edit changes only that row', top[0].note === 'top' && top[1] === loop);

const nested = Segment.update(list, 'e2', (e) => ({ ...e, note: 'nested' }));
ok('a real loop edit returns a new list', nested !== list);
ok('a real loop edit changes only that member',
  nested[1].children[0].note === 'nested' && nested[0] === plain);
ok('the original list is not mutated',
  plain.note === '' && member.note === '' && list[1] === loop);

console.log('\n' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
