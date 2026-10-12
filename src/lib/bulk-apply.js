// Apply ONE set of values across EVERY row on an axis.
//
// WHY THIS IS A MODULE AND NOT A FEW LINES IN THE PAGE
//   "every row" is a deeper claim than it looks. A row can sit at the top, inside
//   a LOOP (a segment), or be one PART of a COMPOUND row, and the three are not
//   read alike:
//
//     * a plain entry reads its OWN `statOverrides` and `critMode`;
//     * a loop member is a plain entry one level down, reached through the
//       segment's `children`;
//     * a compound row computes PER PART, reading each child's own
//       `statOverrides`, while the PARENT's overrides only form the base panel --
//       so a value written only to the parent is beaten by whatever the child
//       already had, which is exactly the "it said all rows and one row did not
//       change" failure.
//
//   The walk is therefore written once, here, and tested directly rather than
//   through the browser. It is pure: same list in, a new list out, no React.
//
// IT ONLY WRITES THE KEYS IT WAS GIVEN. A field left out of `stats` (and a null
// `critMode`) is untouched, so applying one value cannot quietly reset the rest.

import { isSegment } from './rotation-segment';
import { repairOverrides } from './axes-store';

/** The stat edits to merge into a row's existing overrides. */
function mergeOverrides(existing, stats) {
  return repairOverrides({ ...(existing || {}), ...stats });
}

/** One row's new fields, or the row unchanged when there is nothing to write. */
function patchRow(row, { critMode, stats }) {
  const hasStats = stats && Object.keys(stats).length > 0;
  const hasCrit = critMode != null && critMode !== '';
  if (!hasStats && !hasCrit) return row;

  const withOwn = {
    ...row,
    ...(hasCrit ? { critMode } : {}),
    ...(hasStats ? { statOverrides: mergeOverrides(row.statOverrides, stats) } : {}),
  };

  // A COMPOUND ROW'S PARTS ARE ROWS TOO, and their own overrides win -- so they
  // are written directly rather than left to the parent's base panel.
  if (Array.isArray(row.children) && row.children.length) {
    return {
      ...withOwn,
      children: row.children.map((c) => ({
        ...c,
        ...(hasCrit ? { critMode } : {}),
        ...(hasStats ? { statOverrides: mergeOverrides(c.statOverrides, stats) } : {}),
      })),
    };
  }
  return withOwn;
}

/** Every row the apply would touch, at any depth. */
function walk(row, visit) {
  if (isSegment(row)) {
    for (const kid of row.children || []) walk(kid, visit);
    return;
  }
  visit(row);
  for (const part of row.children || []) visit(part);
}

/**
 * How many rows a full apply reaches: top-level entries, loop members and the
 * parts of every compound row. Shown on the Apply button so "every entry" is a
 * number the user can check, not a promise.
 */
export function countBulkTargets(entries) {
  let n = 0;
  for (const row of entries || []) walk(row, () => { n += 1; });
  return n;
}

/**
 * The list with the values written to every row it holds.
 *
 * `critMode` is `null` to leave the crit mode alone, and `stats` may be empty;
 * passing neither returns the SAME list so React skips a pointless render.
 */
export function applyBulkSettings(entries, { critMode = null, stats = null } = {}) {
  const hasStats = stats && Object.keys(stats).length > 0;
  const hasCrit = critMode != null && critMode !== '';
  if (!hasStats && !hasCrit) return entries;
  return (entries || []).map((row) => {
    if (isSegment(row)) {
      return { ...row, children: (row.children || []).map((k) => patchRow(k, { critMode, stats })) };
    }
    return patchRow(row, { critMode, stats });
  });
}