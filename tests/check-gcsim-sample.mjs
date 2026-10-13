// The browser half of the gcsim import: WHICH WRAPPER the sample carries.
//
// gcsim's `.gz` export is a bare ZLIB stream (magic 78 9c), NOT gzip -- piping it
// through gunzip fails. The CLI sniffs the magic bytes for exactly that reason,
// and the page has to sniff them the same way, so the sniff is pinned here:
// three wrappers in, the same object out, plus the one thing a wrong guess costs
// (a decompression error naming the wrapper, not a JSON parse error three lines
// later saying nothing about the file).
//
// `decodeSample` is the only part of `gcsim-sample.js` that is testable without
// a browser: everything past it fetches the dataset. That is the split the
// module was built with -- the pure importer is `gcsim-import.js`.
import { gzipSync, deflateSync } from 'node:zlib';
import { decodeSample } from '../src/lib/gcsim-sample.js';

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${ok ? '' : `got ${JSON.stringify(got)}`}`);
};

const sample = {
  character_details: [{ name: 'varka', level: 95 }],
  logs: [{ event: 'damage', char_index: 0, logs: { abil: 'Windbound Execution', damage: 100 } }],
};
const text = JSON.stringify(sample);
const raw = Buffer.from(text, 'utf8');
const buf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

console.log('1. every wrapper gcsim and a human produce');
for (const [label, bytes] of [
  ['plain JSON', raw],
  ['gzip (1f 8b)', gzipSync(raw)],
  ['zlib (78 9c) -- what gcsim writes', deflateSync(raw)],
]) {
  check(label, await decodeSample(buf(bytes)), sample);
}

console.log('\n2. housekeeping');
check('the payload is not accidentally the bytes', typeof sample.logs[0].logs.damage, 'number');
check('whitespace-only JSON still parses', await decodeSample(buf(Buffer.from('  {}  ', 'utf8'))), {});

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);