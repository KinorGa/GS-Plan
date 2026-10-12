// Legal substat totals: the numbers a substat can ACTUALLY show, per rarity.
//
// A substat rolls one of four tiers. The four tiers of a stat are
//     u * {7, 8, 9, 10}          where   u = topTier / 10
// i.e. the 0.7 / 0.8 / 0.9 / 1.0 multiples of that stat's top tier. Verified
// against every row of ReliquaryAffixExcelConfigData.json (AnimeGameData2, the
// same data Genshin Optimizer reads) for 3/4/5-star.
//
// HIGH PRECISION, NOT THE GAME'S 2-DECIMAL DISPLAY. The data file stores each
// cell rounded to two decimals -- flat HP's bottom tier is written `209.13` --
// but the value it is rounding is exactly `298.75 * 0.7 = 209.125`, and a real
// total is a SUM of such cells, so the rounding is not free: six bottom-tier
// rolls sum to 1254.75 exactly, while six times the displayed 209.13 is 1254.78.
// This module therefore works in the exact tiers (`u * {7,8,9,10}`, which are
// always three decimals) and only ever compares/display that. A typed 209.13 is
// still ACCEPTED, because it is that same roll as shown by the game -- see the
// tolerance in `matchLegal`.
//
// A substat can appear on a piece `n` times -- once when the piece has four
// substats, plus every upgrade that happened to land on that same line. `n`
// therefore runs from 1 up to the rarity cap, which is the cap Genshin Optimizer
// itself uses:
//
//     { 3: 2, 4: 4, 5: 6 }        // 5-star: one initial roll + five upgrades
//
// A total is then `u * (sum of n multipliers)`. Because {7,8,9,10} is a run of
// consecutive integers, the multiplier-sums reachable with EXACTLY n terms form
// the contiguous interval [7n, 10n]. That gives two facts worth knowing:
//
//   * a total can be reachable with several different n at once (the intervals
//     overlap, e.g. 28..30 is both 3 and 4 rolls);
//   * a few totals are reachable with NO n at all (the gaps between intervals).
//     Inside the whole possible range the only unreachable multipliers are
//     11, 12 and 13 -- e.g. flat HP can never read 328.625 / 358.5 / 388.375.
//
// The module is pure data + pure functions so the legality can be checked from a
// test without React, and so the editor's dropdown and any future save-file
// validator agree by construction.

/** The four tier multipliers, low tier first. */
export const TIER_MUL = [7, 8, 9, 10];

/**
 * How many times one substat can appear, per rarity (stars).
 *
 * NOT simply "upgrades + 1". A piece has four substat SLOTS and starts with fewer
 * than four, so the first upgrade(s) are spent FILLING the empty slots before any
 * upgrade can deepen an existing line. With GO's model
 * (`artSubstatRollData`: initial count low..high, numUpgrades):
 *
 *   rarity  initial  upgrades  slots to fill   max hits on one line
 *     3★     1..2       3          4-2 = 2       1 + (3-2) = 2
 *     4★     2..3       4          4-3 = 1       1 + (4-1) = 4
 *     5★     3..4       5          4-4 = 0       1 + (5-0) = 6
 *
 * which is exactly the cap Genshin Optimizer publishes:
 * `rollsForRarity = { 3: 2, 4: 4, 5: 6 }`. (1★/2★ would be 1 and 3; no set in
 * this app rolls below 3★.)
 */
export const SUBSTAT_MAX_ROLLS = { 1: 1, 2: 3, 3: 2, 4: 4, 5: 6 };

/**
 * The exact unit `u = topTier / 10` for every substat, per rarity, in the SAME
 * units the editor stores: percentage stats as plain numbers (5.83 means 5.83%)
 * and flats as plain numbers (29.875 HP). Derived from the top tier of each row:
 *
 *   5-star  hp 298.75  atk 19.45  def 23.15  hp%/atk% 5.83  def% 7.29
 *           em 23.31  er 6.48  crit 3.89  critdmg 7.77
 *   4-star  hp 239     atk 15.56  def 18.52  hp%/atk% 4.66  def% 5.83
 *           em 18.65  er 5.18  crit 3.11  critdmg 6.22
 *   3-star  hp 143.4   atk 9.34   def 11.11  hp%/atk% 3.5   def% 4.37
 *           em 13.99  er 3.89  crit 2.33  critdmg 4.66
 */
export const SUBSTAT_UNIT = {
  5: {
    hp: 29.875, atk: 1.945, def: 2.315,
    hpPct: 0.583, atkPct: 0.583, defPct: 0.729,
    em: 2.331, er: 0.648, critRate: 0.389, critDmg: 0.777,
  },
  4: {
    hp: 23.9, atk: 1.556, def: 1.852,
    hpPct: 0.466, atkPct: 0.466, defPct: 0.583,
    em: 1.865, er: 0.518, critRate: 0.311, critDmg: 0.622,
  },
  3: {
    hp: 14.34, atk: 0.934, def: 1.111,
    hpPct: 0.35, atkPct: 0.35, defPct: 0.437,
    em: 1.399, er: 0.389, critRate: 0.233, critDmg: 0.466,
  },
};

/** Rarity every stat is *shown* at when nothing else is known (the default). */
export const DEFAULT_RARITY = 5;

/**
 * Three decimals -- the exact precision of `u * m`, since every unit is three
 * decimals and every multiplier an integer. Kept as the ONE rounding step so
 * float noise (`0.583 * 7 = 4.0810000000000004`) never reaches the UI.
 */
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * How far a typed number may sit from a legal value and still count as that
 * roll. 0.005 is half of the last digit the game itself shows, so a user
 * transcribing "209.13" off a screenshot matches the exact 209.125, while no two
 * legal totals are ever within 0.01 of each other (the tightest gap is a 3-star
 * CRIT Rate's 0.233), so nothing is ambiguous.
 */
const MATCH_TOL = 0.005;

/** Every multiset of `n` tier indices, low index first. */
function combinations(n) {
  const out = [];
  (function rec(start, left, acc) {
    if (left === 0) { out.push(acc.slice()); return; }
    for (let i = start; i < 4; i++) { acc.push(i); rec(i, left - 1, acc); acc.pop(); }
  })(0, n, []);
  return out;
}

const cache = new Map();

/**
 * Every legal total for `statKey` at `rarity`, ascending.
 *
 * Returns `null` for a stat with no unit at that rarity (nothing legal to show),
 * so a caller cannot mistake "no data" for "no legal values".
 *
 * Each entry is:
 *   { m, value, entries: [{ n, tiers: [1..4, ...] }] }
 * where `value = round3(u * m)`, `m` is the sum of tier multipliers, and each
 * `entries` item is one way to reach it: `n` rolls landing on the given tiers
 * (1..4 = the 0.7/0.8/0.9/1.0 tier).
 */
export function legalTotals(statKey, rarity = DEFAULT_RARITY) {
  const key = `${rarity}|${statKey}`;
  if (cache.has(key)) return cache.get(key);

  const u = SUBSTAT_UNIT[rarity]?.[statKey];
  const result = u ? build(u, SUBSTAT_MAX_ROLLS[rarity] ?? 6) : null;
  cache.set(key, result);
  return result;
}

function build(u, maxN) {
  const byM = new Map();
  for (let n = 1; n <= maxN; n++) {
    for (const combo of combinations(n)) {
      const m = combo.reduce((a, i) => a + TIER_MUL[i], 0);
      let e = byM.get(m);
      if (!e) { e = { m, value: round3(u * m), entries: [] }; byM.set(m, e); }
      e.entries.push({ n, tiers: combo.map((i) => i + 1) });
    }
  }
  const list = [...byM.values()].sort((a, b) => a.value - b.value);
  for (const e of list) e.entries.sort((a, b) => a.n - b.n);
  return list;
}

/** Just the legal values, ascending. Convenience for a picker. */
export function legalValues(statKey, rarity = DEFAULT_RARITY) {
  return (legalTotals(statKey, rarity) || []).map((e) => e.value);
}

/** A typed value as a number, or null when it is not a number. */
export function asNumber(value) {
  const n = parseFloat(String(value ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * The legal entry a value matches, or null.
 *
 * Matched within `MATCH_TOL`, so both the exact 209.125 and the game's displayed
 * 209.13 resolve to the same entry.
 */
export function matchLegal(statKey, rarity, value) {
  const n = asNumber(value);
  if (n == null) return null;
  return (legalTotals(statKey, rarity) || [])
    .find((e) => Math.abs(n - e.value) <= MATCH_TOL) || null;
}

/** Whether a value is one the game can show for this stat at this rarity. */
export const isLegalValue = (statKey, rarity, value) =>
  matchLegal(statKey, rarity, value) != null;

/**
 * The legal entry CLOSEST to a value -- what a picker highlights while the user
 * is mid-typing. Prefers the lower entry on a tie so the highlight does not jump
 * ahead of what was typed.
 */
export function nearestLegal(statKey, rarity, value) {
  const list = legalTotals(statKey, rarity);
  if (!list) return null;
  const n = asNumber(value);
  if (n == null) return list[0];
  let best = list[0];
  for (const e of list) {
    if (Math.abs(e.value - n) < Math.abs(best.value - n)) best = e;
  }
  return best;
}

/** The distinct roll counts an entry can come from, ascending. */
export const rollCountsOf = (entry) =>
  [...new Set((entry?.entries || []).map((x) => x.n))].sort((a, b) => a - b);

/** A one-line decomposition: `3次 · T1 + T3 + T4`. Empty for no entry. */
export function describeRolls(entry) {
  if (!entry) return '';
  return entry.entries
    .map((w) => `${w.n}次 · ${w.tiers.map((t) => `T${t}`).join(' + ')}`)
    .join('\n');
}

/**
 * The exact values of the four tiers for a stat, low tier first. Useful for a
 * tooltip that names the tiers a decomposition refers to.
 */
export function tierValues(statKey, rarity = DEFAULT_RARITY) {
  const u = SUBSTAT_UNIT[rarity]?.[statKey];
  return u ? TIER_MUL.map((m) => round3(u * m)) : null;
}
