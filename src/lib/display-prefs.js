// How many decimals the panels PRINT, remembered across reloads.
//
// WHY THIS IS NOT A COMPUTATION SETTING
//   Every number in the app is computed and stored at full precision; this only
//   decides how many of those digits reach the screen. A damage figure rounded
//   for display is still the exact one the next step multiplies, so moving this
//   can never change a total -- it just stops a cell built for five characters
//   from having to show `5766.678236`.
//
// WHY A STORE AND NOT A PROP
//   The precision is wanted by components in different trees (the card's summary
//   strip, an entry's buff chips) and by plain functions that are not components
//   at all (`zoneFactorLabel`). Threading it down as a prop would mean reaching
//   every one of them by hand; a module-level store is read where a number is
//   formatted, and the hook keeps the panels that show it in step when it moves.
//
// IT IS ONLY A HINT. A value edited by hand in devtools, or one left by an older
// build, is clamped back into range on read, so junk can never reach the screen.

import { useSyncExternalStore } from 'react';

/** The key this preference lives under, beside the axes and the library. */
export const DISPLAY_PRECISION_STORAGE_KEY = 'lunaris-display-precision';

/** Three decimals: what the damage card's summary strip already showed. */
export const DEFAULT_DISPLAY_PRECISION = 3;

/** Zero prints whole numbers; six is the most any panel here has ever wanted. */
export const MIN_DISPLAY_PRECISION = 0;
export const MAX_DISPLAY_PRECISION = 6;

/** Keep a number inside the range, and a whole number. */
const clamp = (n) =>
  Math.min(MAX_DISPLAY_PRECISION, Math.max(MIN_DISPLAY_PRECISION, Math.round(n)));

/** The stored value, repaired. Never throws, even with no `localStorage`. */
function readStored() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_DISPLAY_PRECISION;
    const raw = localStorage.getItem(DISPLAY_PRECISION_STORAGE_KEY);
    if (raw === null) return DEFAULT_DISPLAY_PRECISION;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : DEFAULT_DISPLAY_PRECISION;
  } catch {
    return DEFAULT_DISPLAY_PRECISION;
  }
}

let current = readStored();
const listeners = new Set();

/** The precision every formatter should use right now. */
export function getDisplayPrecision() {
  return current;
}

/** Move the precision and tell every subscribed panel. */
export function setDisplayPrecision(n) {
  const next = clamp(n);
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(DISPLAY_PRECISION_STORAGE_KEY, String(next));
  } catch {
    /* Private mode or quota: the setting still applies, it just forgets. */
  }
  for (const listener of listeners) listener();
}

/** The store, as `useSyncExternalStore` wants it. */
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current precision as a value a component re-renders on. */
export function useDisplayPrecision() {
  return useSyncExternalStore(subscribe, getDisplayPrecision);
}

/**
 * A number as the panels write it: grouped thousands, AT MOST `digits` decimals.
 *
 * `maximumFractionDigits` alone, not `minimum` too: a strip of `18.5` beside
 * `1,000.549` reads at least as well as `18.500` and `1,000.549`, and for a
 * whole number -- an enemy level, a hit count -- a run of trailing zeros is
 * noise. This is the same choice `Math.round(...).toLocaleString` already made
 * for the damage figures themselves.
 *
 * Defaults to the live setting, so a call site only has to name the number to
 * get the current precision -- it does not need to know this module exists.
 */
export function formatNumber(value, digits = current) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return n.toLocaleString('en-US', { maximumFractionDigits: clamp(digits) });
}
