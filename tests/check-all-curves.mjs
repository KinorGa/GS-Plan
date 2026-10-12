// Verify EVERY cell of the 5-star main-stat curves against the reference table.
//
// The table was transcribed by hand, so this transcribes it a second time from
// the reference image and compares all 315 values. A single wrong cell is the
// failure mode here -- it produces a plausible-looking number that nobody
// notices -- so the check is exhaustive rather than sampled.
//
// Usage: node tests/check-all-curves.mjs
import fs from 'node:fs';

// --- 5-star reference, +0..+20, transcribed from the table ----------------
// Rows in the order the reference lists them.
const REFERENCE_5STAR = {
  hpPct: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  atkPct: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  defPct: '8.7 11.2 13.7 16.2 18.6 21.1 23.6 26.1 28.6 31.0 33.5 36.0 38.5 40.9 43.4 45.9 48.4 50.8 53.3 55.8 58.3',
  er: '7.8 10.0 12.2 14.4 16.6 18.8 21.0 23.2 25.4 27.6 29.8 32.0 34.2 36.4 38.6 40.8 43.0 45.2 47.4 49.6 51.8',
  em: '28 35.9 43.8 51.8 59.7 67.6 75.5 83.5 91.4 99.3 107.2 115.2 123.1 131 138.9 146.9 154.8 162.7 170.6 178.6 186.5',
  atk: '47 60 73 86 100 113 126 139 152 166 179 192 205 218 232 245 258 271 284 298 311',
  critRate: '4.7 6.0 7.3 8.6 9.9 11.3 12.6 13.9 15.2 16.5 17.9 19.2 20.5 21.8 23.2 24.5 25.8 27.1 28.4 29.8 31.1',
  critDmg: '9.3 12.0 14.6 17.3 19.9 22.5 25.2 27.8 30.5 33.1 35.7 38.4 41.0 43.7 46.3 49.0 51.6 54.2 56.9 59.5 62.2',
  healBonus: '5.4 6.9 8.4 10.0 11.5 13.0 14.5 16.1 17.6 19.1 20.6 22.1 23.7 25.2 26.7 28.2 29.8 31.3 32.8 34.3 35.9',
  hp: '717 920 1123 1326 1530 1733 1936 2139 2342 2545 2749 2952 3155 3358 3561 3764 3968 4171 4374 4577 4780',
  // All seven elements share one line.
  pyroDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  electroDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  cryoDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  hydroDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  anemoDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  geoDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  dendroDmg: '7.0 9.0 11.0 12.9 14.9 16.9 18.9 20.9 22.8 24.8 26.8 28.8 30.8 32.8 34.7 36.7 38.7 40.7 42.7 44.6 46.6',
  physBonus: '8.7 11.2 13.7 16.2 18.6 21.1 23.6 26.1 28.6 31.0 33.5 36.0 38.5 40.9 43.4 45.9 48.4 50.8 53.3 55.8 58.3',
};

// --- parse the shipped tables ---------------------------------------------
const src = fs.readFileSync('src/lib/artifact-curves.js', 'utf8');
const PCT = src.match(/PCT_CURVES = \{([\s\S]*?)\n\};/)[1];
const FLAT = src.match(/FLAT_CURVES = \{([\s\S]*?)\n\};/)[1];

const nums = (block, key) => {
  const m = block.match(new RegExp(`\\b${key}: \\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
};

// Which table each reference row lives in.
const FLAT_KEYS = new Set(['hp', 'atk', 'em']);

// Per-element keys resolve to the shared elemental curve at runtime. The
// exclusion matters: `critDmg` also ends in `Dmg`, and treating it as an element
// would compare the elemental row against the crit reference -- the same false
// positive `curveValue` guards against with its own `(?!crit)` lookahead.
const isElementKey = (k) => /^(?!crit)[a-z]+Dmg$/.test(k);

let cells = 0;
let bad = 0;

for (const [key, refLine] of Object.entries(REFERENCE_5STAR)) {
  const expected = refLine.split(/\s+/).map(Number);
  let actual;
  if (isElementKey(key)) {
    actual = nums(PCT, 'dmgBonus');
  } else {
    actual = nums(FLAT_KEYS.has(key) ? FLAT : PCT, key);
  }

  if (!actual) { console.log(`MISSING ROW: ${key}`); bad++; continue; }
  if (actual.length !== 21) {
    console.log(`WRONG LENGTH: ${key} has ${actual.length} cells, expected 21`);
    bad++;
    continue;
  }

  const wrong = [];
  for (let i = 0; i < 21; i++) {
    cells++;
    if (Math.abs(actual[i] - expected[i]) > 1e-9) {
      wrong.push(`+${i}: ${actual[i]} != ${expected[i]}`);
    }
  }
  if (wrong.length) {
    console.log(`MISMATCH ${key}: ${wrong.slice(0, 6).join('  ')}${wrong.length > 6 ? ` (+${wrong.length - 6} more)` : ''}`);
    bad += wrong.length;
  } else {
    console.log(`ok  ${key.padEnd(11)} 21/21 cells`);
  }
}

// Cross-checks that catch a row pointing at the wrong curve entirely.
const pctDef = nums(PCT, 'defPct');
const pctPhys = nums(PCT, 'physBonus');
const pctElem = nums(PCT, 'dmgBonus');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\ncross-checks:');
const checks = [
  ['physBonus == defPct (NOT the elemental line)', same(pctPhys, pctDef)],
  ['physBonus != dmgBonus', !same(pctPhys, pctElem)],
  ['dmgBonus == hpPct', same(pctElem, nums(PCT, 'hpPct'))],
];
for (const [label, ok] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

console.log(`\n${cells} cells checked, ${bad} problems`);
process.exit(bad ? 1 : 0);
