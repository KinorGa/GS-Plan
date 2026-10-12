// WHETHER A SOURCE IS ACTUALLY A BUFF.
//
// The pool lists every source a team has, and most of them are not buffs at all --
// 神里流·冰华 and 天目影打刀 are skill descriptions with nothing to fill in. In the
// generated data that is 3088 rows of which 867 carry numbers, and the rest are
// indistinguishable to a machine: a talent that grants nothing and a talent nobody
// has filled in yet both have zero buffs.
//
// So the answer is a human judgement, and it is stored HERE rather than in the
// library or in the exported document:
//
//   * it is the user's opinion, not a fact about the game. Official data is
//     replaced wholesale when it is regenerated, and a judgement kept inside it
//     would go with it.
//   * it is not part of a shared rotation. Somebody opening an exported config
//     should get the axis, not the exporter's notes about which talents matter.
//   * `lunaris-buff-library` holds the numbers a person transcribed. This holds a
//     different kind of statement, and mixing them would mean editing one to change
//     the other.
//
// THREE STATES, and the DEFAULT IS SHOWN:
//
//   unmarked  shown      the default, and it must be. A source nobody has looked at
//                        yet is far more likely to be a buff that has not been
//                        filled in than one to hide, and defaulting to hidden would
//                        silently drop real buffs out of every pool.
//   true      shown      confirmed a buff
//   false     HIDDEN     excluded from the pool -- and from the pool ONLY.
//
// A `false` source stays visible in the 增益库, always. Hiding it there too would
// make a mistyped mark permanent: the row would be gone from the one screen that
// could put it back. The library is the place errors are corrected, so it never
// hides anything; it offers a FILTER instead, which the user turns on deliberately.
//
// NUMBERS DO NOT DECIDE ANYTHING. A buff with no value yet is still a buff, and
// inferring the flag from `buffs.length` would have marked every not-yet-filled
// source as "not a buff" -- exactly the mistake this module exists to avoid.

const STORAGE_KEY = 'lunaris-buff-flags';

/**
 * The storage key, for a listener watching for edits made on another page.
 *
 * Exported so the string is written once: a second copy in a `storage` handler would
 * compare against a key nothing writes, and the listener would silently never fire.
 */
export const FLAGS_STORAGE_KEY = STORAGE_KEY;

/**
 * Drop the in-memory copy.
 *
 * `loadFlags` caches, which is right for a render path and wrong for a listener: a
 * `storage` event means another page changed the value, and re-reading through the
 * cache would hand back exactly the copy this page already has.
 */
export function invalidateFlags() {
  cache = null;
}

/** A remembered answer, so a re-render does not re-read storage. */
let cache = null;

/**
 * Read the flags.
 *
 * Returns `{ [libKey]: true | false }`. An absent key means UNMARKED -- it is not
 * stored as a third value, because "no entry" and "entry saying maybe" would be two
 * spellings of one state.
 *
 * A corrupt value yields an empty set rather than throwing: this runs during render,
 * and a blank pool is a far better failure than a blank page.
 */
export function loadFlags() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = normaliseFlags(parsed);
  } catch {
    cache = {};
  }
  return cache;
}

/** Keep only the keys that carry a real answer, so a stale one cannot linger. */
export function normaliseFlags(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw?.flags || raw || {})) {
    // Only booleans are meaningful. Anything else is a value this module has no
    // interpretation for, and guessing one would invent a decision nobody made.
    if (typeof v === 'boolean' && k) out[String(k)] = v;
  }
  return out;
}

/**
 * Persist flags, and keep the in-memory copy in step.
 *
 * RETURNS the saved set, so `setFlags(saveFlags(withFlag(...)))` works. It is written
 * that way at the call site, and without a return value React was handed `undefined`
 * -- the marks persisted correctly while every count and filter on the page kept
 * showing the old set, because the state it re-rendered from was gone.
 *
 * `saveLibrary` returns its value for the same reason; the two are used alike and
 * have to behave alike.
 */
export function saveFlags(next) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, flags: next }));
  } catch {
    // Quota or private mode: the change still applies for this session.
  }
  return next;
}

/**
 * One source's state, as three words rather than two.
 *
 * Callers should test this rather than `flags[key] === false`, because an unmarked
 * key reads as `undefined` and `undefined` is not the same as `false` -- a direct
 * comparison is how "nobody has decided" quietly becomes "not a buff".
 */
export function flagOf(flags, key) {
  const v = flags?.[key];
  if (v === true) return 'buff';
  if (v === false) return 'not-buff';
  return 'unmarked';
}

/**
 * Whether a source belongs in the POOL.
 *
 * Only an explicit `false` excludes it. Everything else is shown, including the
 * unmarked majority -- see the note at the top for why that default is load-bearing.
 */
export const isPooled = (flags, key) => flagOf(flags, key) !== 'not-buff';

/**
 * Set a source's state, or clear it.
 *
 * `state` is `'buff' | 'not-buff' | 'unmarked'`, so the caller speaks the same
 * vocabulary the filter does. Passing `'unmarked'` DELETES the key rather than
 * storing a third value, which keeps "no entry" the single spelling of that state.
 *
 * A new object is returned; the caller decides when to save.
 */
export function withFlag(flags, key, state) {
  const next = { ...(flags || {}) };
  if (state === 'unmarked') delete next[key];
  else next[key] = state === 'buff';
  return next;
}

/** Counts for the filter chips, so each one can show how much it would show. */
export function flagCounts(flags, keys) {
  const out = { buff: 0, 'not-buff': 0, unmarked: 0 };
  for (const k of keys || []) out[flagOf(flags, k)] += 1;
  return out;
}
