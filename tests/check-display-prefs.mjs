// The display-precision store (see src/lib/display-prefs.js).
//
// WHY THIS IS CHECKED WITHOUT A BROWSER
//   The dangerous half of a preference like this is not the rendering, it is the
//   VALUE: a stored "3.7", a "99", a string, or a store that throws. Every one of
//   those has to come back as a sane number of decimals, because the panels print
//   with it and a bad value would either show nonsense or crash the card. The
//   browser check proves the pixels; this proves the arithmetic around the value.
import { spawnSync } from 'node:child_process';

let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} ${ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

/* --------------------------------- what a value ON DISK resolves to at import */

// The module reads `localStorage` once, when it is imported, so each stored value
// is tried in its own process -- a re-import in THIS one would hand back the
// already-loaded module and prove nothing.
const moduleUrl = new URL('../src/lib/display-prefs.js', import.meta.url).href;
const precisionFromStore = (stored) => {
  const code = `
    globalThis.localStorage = { getItem: () => ${JSON.stringify(stored)}, setItem() {} };
    const m = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(String(m.getDisplayPrecision()));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return Number(r.stdout);
};

check('nothing stored -> the default', precisionFromStore(null), 3);
check('a stored value is honoured', precisionFromStore('1'), 1);
check('junk is ignored -> the default', precisionFromStore('not-a-number'), 3);
check('an out-of-range value clamps', precisionFromStore('99'), 6);

/* ------------------------------------------- the live store in this process -- */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const mod = await import('../src/lib/display-prefs.js');
const KEY = mod.DISPLAY_PRECISION_STORAGE_KEY;

check('default is three', mod.getDisplayPrecision(), 3);
check('integer, no trailing zeros', mod.formatNumber(17841.2269), '17,841.227');
check('fewer digits when the number has fewer', mod.formatNumber(18.5), '18.5');
check('a whole number stays whole', mod.formatNumber(100), '100');
check('grouping is applied', mod.formatNumber(5199934.1234), '5,199,934.123');
check('an explicit precision overrides the store', mod.formatNumber(0.123456, 2), '0.12');
check('zero decimals rounds to a whole', mod.formatNumber(2.6, 0), '3');
check('a huge digit count still clamps', mod.formatNumber(0.123456, 99), '0.123456');
check('non-finite falls back to the raw text', mod.formatNumber(NaN), 'NaN');

mod.setDisplayPrecision(1);
check('setting moves the live value', mod.getDisplayPrecision(), 1);
check('the new value is persisted', store.get(KEY), '1');
check('the formatter follows the setting', mod.formatNumber(17841.2269), '17,841.2');

mod.setDisplayPrecision(99);
check('too many decimals clamps to the max', mod.getDisplayPrecision(), mod.MAX_DISPLAY_PRECISION);
mod.setDisplayPrecision(-4);
check('a negative clamps to the min', mod.getDisplayPrecision(), mod.MIN_DISPLAY_PRECISION);
mod.setDisplayPrecision(2.6);
check('a fraction rounds to a whole', mod.getDisplayPrecision(), 3);

console.log(fails ? `FAILED: ${fails}` : 'all display-pref checks passed');
process.exit(fails ? 1 : 0);
