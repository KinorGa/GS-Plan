// A SEGMENT OF A ROTATION: a container that owns the rows inside it.
//
// WHY THIS EXISTS. A rotation used to be a flat list, and every part of the app
// reached into that list directly:
//
//     updateEntries((list) => list.map((e) => (e.id === id ? patch(e) : e)))
//
// The moment a row could live INSIDE another row -- a loop holding seventeen entries
// so they can be moved and copied together -- that line stopped being true. It looks
// up an id across the top level only, so a row one level down was never found, and
// the edit was discarded without an error. Four separate bugs came out of that one
// shape, and all four were the same mistake in different clothes:
//
//   * `patchEntry` only looked at the top level, so EVERY edit inside a loop was
//     silently dropped -- a buff deleted, a stat typed, a card re-picked.
//   * `computeAxis` indexed only top-level ids, so a loop's members showed `—`.
//   * the paste re-issued ids at the levels it remembered and missed the rest, so a
//     pasted entry's buff cards all shared one id and any edit hit all of them.
//   * the same again one level up, for a pasted loop's members.
//
// Every one of those is "code outside the container reaching in and getting the
// depth wrong". So the container stops being a plain array and becomes an object
// that answers questions about its own contents. Callers no longer know there is a
// depth at all:
//
//     Segment.update(rows, id, patch)     instead of `list.map(...)`
//     Segment.clone(rows, id, mintId)     instead of re-issuing ids by hand
//     Segment.summary(rows)               instead of walking the tree to total it
//
// WHAT IT DELIBERATELY IS NOT. It holds no state, knows nothing about React, and is
// not a class -- it is a set of pure functions over the stored shape. The rows keep
// the exact shape they had, so `DamageEntry`, `EntryGroup` and the card's own
// editing logic are untouched: a row inside a segment is edited by the same code
// that edits a row at the top, it is just FOUND by the segment instead of by a
// top-level scan.
//
// A SEGMENT IS ITSELF A ROW. It sits in the same array as ordinary rows and carries
// `kind: 'segment'`, so ordering, selection and the axis total need no special case:
// `Segment.rows()` returns `[entry]` for an ordinary row, which makes every operation
// below total over both shapes without a branch at the call site.

/** The marker that says "this row holds other rows". */
export const SEGMENT_KIND = 'segment';

/** True for a row that contains other rows. */
export const isSegment = (row) => !!row && row[kindKey(row)] === SEGMENT_KIND;

/**
 * The field that distinguishes a segment from an entry.
 *
 * `kind` is the natural name and the one used in the stored file. The indirection is
 * here only to keep the single read in one place.
 */
function kindKey(row) {
  return 'kind';
}

/**
 * The rows a caller should treat as this row's contents.
 *
 * An ordinary entry returns ITSELF, so callers that only want "the rows here" do not
 * need to ask what shape they are holding. This is what lets `Segment.update` and
 * friends be total: one implementation covers both.
 */
export function rows(row) {
  return isSegment(row) ? (Array.isArray(row.children) ? row.children : []) : [row];
}

/**
 * Find a row by id, AT ANY DEPTH, and return a locator for it.
 *
 * Returns `null` when the id is unknown, which is how a caller tells "not here" from
 * "here and unchanged" -- the distinction that `list.map(...)` could not make, and
 * the reason the missing-row case was silent.
 *
 * The locator is `{ top, index, parent }`: `top` is the row to replace in the axis,
 * `parent` is the segment holding it (or `null` at the top), and `index` is where.
 * Callers do not need to understand it -- `Segment.update` and `Segment.remove` use
 * it for them -- but it is returned rather than kept private so a future operation
 * can be written without re-deriving the walk.
 */
export function locate(list, id) {
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (row.id === id) return { top: row, topIndex: i, parent: null, index: i };
    if (!isSegment(row)) continue;
    const kids = rows(row);
    for (let k = 0; k < kids.length; k += 1) {
      if (kids[k].id === id) return { top: row, topIndex: i, parent: row, index: k };
    }
  }
  return null;
}


/** The row with this id, at any depth, or `null`. */
export function get(list, id) {
  const at = locate(list, id);
  if (!at) return null;
  return at.parent ? rows(at.parent)[at.index] : at.top;
}

/**
 * Replace one row's fields, wherever it sits.
 *
 * `fn` receives the row and returns the replacement, so a caller can spread it or
 * compute something from it. The list is returned UNCHANGED (the same reference)
 * when the id is unknown, so React skips the render rather than re-rendering every
 * row for nothing.
 */
export function update(list, id, fn) {
  const at = locate(list, id);
  if (!at) return list;
  if (!at.parent) return list.map((row, i) => (i === at.topIndex ? fn(row) : row));
  return list.map((row, i) => {
    if (i !== at.topIndex) return row;
    const kids = rows(row);
    return { ...row, children: kids.map((c, k) => (k === at.index ? fn(c) : c)) };
  });
}

/** Remove one row, wherever it sits. A segment that empties out is dropped with it. */
export function remove(list, id) {
  const at = locate(list, id);
  if (!at) return list;
  if (!at.parent) return list.filter((row) => row.id !== id);
  return list.map((row, i) => {
    if (i !== at.topIndex) return row;
    const kids = rows(row).filter((c) => c.id !== id);
    // AN EMPTY SEGMENT IS NOT A ROW. Keeping it would leave a header that opens onto
    // nothing, so removing the last member removes the container in the same step.
    return kids.length ? { ...row, children: kids } : null;
  }).filter(Boolean);
}


/**
 * A DEEP COPY WITH NEW IDS, for pasting.
 *
 * `mintId(parentId, depth)` returns an id for one node. Every id inside the copy
 * comes from it, INCLUDING the ones inside a segment's own rows -- which is the
 * whole point. This used to be hand-written at three places in the paste, one per
 * level, and both times a level was forgotten the copy silently shared ids with the
 * original: a buff card addressed by id then matched every card at once, so deleting
 * one row deleted it everywhere.
 *
 * With the copy done here there is exactly one rule -- every node in the tree gets a
 * fresh id -- and no level can be missed, because no level is written out by hand.
 *
 * The ids are DERIVED, not random (`e7-m2-d0`), so a pasted file stays readable and
 * the same paste is reproducible. Uniqueness comes from the root id, which the caller
 * mints from the axis, plus the position of each node below it.
 */
export function clone(row, mintId) {
  const copy = (node, idFor, depth) => {
    const id = idFor(node);
    const next = { ...node, id };

    /**
     * A DROP'S BUFFS ARE COPIED, not shared.
     *
     * `{ ...d }` gave the copy its own drop object but the SAME `buffs` array, so
     * editing a value in the copy wrote through to the original -- the two rows
     * disagreed with nothing on screen explaining why, which is the failure this
     * whole function exists to prevent at the level of ids. It was reachable on
     * paste too, and on duplicating an axis it is the difference between "two
     * variants" and "one variant in two places".
     *
     * The buff row is copied too, not just the array: a shared `{ key, value }`
     * has the same problem one level further down.
     */
    const copyDrops = (drops, idPrefix) => (
      Array.isArray(drops)
        ? drops.map((d, i) => ({
          ...d,
          id: `${idPrefix}-d${i}`,
          buffs: Array.isArray(d.buffs) ? d.buffs.map((b) => ({ ...b })) : d.buffs,
        }))
        : drops
    );

    // The buff cards, each with an id of its own. They are addressed by id wherever
    // they are edited, so two sharing one are not two cards.
    if (Array.isArray(node.drops)) {
      next.drops = copyDrops(node.drops, id);
    }
    // The compound parts of a talent row -- NOT rows, so they are copied in place
    // rather than recursed into as segments.
    if (Array.isArray(node.children) && !isSegment(node)) {
      next.children = node.children.map((c, i) => {
        const childId = `${id}-p${i}`;
        return {
          ...c,
          id: childId,
          drops: copyDrops(c.drops, childId),
        };
      });
    }
    // A segment's MEMBERS are rows, so they get the same treatment at the next
    // level down -- which is the recursion this function exists for.
    if (isSegment(node)) {
      next.children = rows(node).map((kid, i) => copy(kid, () => `${id}-m${i}`, depth + 1));
    }
    return next;
  };
  return copy(row, mintId, 0);
}

/**
 * THE ACCORDION: one row open at a time, WITHIN ITS OWN LEVEL.
 *
 * The rule has to be level-aware, and writing it at the call site got that wrong
 * twice. Collapsing every other `expanded` flag unconditionally also closed the
 * SEGMENT containing the row being opened -- and since a segment's members only exist
 * while it is open, expanding a member unmounted the member itself. A segment could
 * be opened but nothing inside it ever could, with the row visibly collapsing as you
 * clicked it.
 *
 * So: opening a row closes its SIBLINGS, and opening a top-level row closes the other
 * top-level rows, while a segment above it stays open because it is the container,
 * not a sibling. A segment's own `expanded` means "show my members", which is a
 * different question from which row is open, so a top-level toggle leaves it alone --
 * otherwise the axis would jump while editing beside an open segment.
 */
export function setOpen(list, id, open) {
  const at = locate(list, id);
  if (!at) return list;

  if (at.parent) {
    // A member: close its siblings, leave the segment open.
    const kids = rows(at.parent).map((c) => (
      c.id === id ? { ...c, expanded: open } : { ...c, expanded: false }
    ));
    return list.map((row, i) => (i === at.topIndex ? { ...row, children: kids } : row));
  }

  // A top-level row. Segments keep their own open state; entries close each other.
  return list.map((row) => {
    if (isSegment(row)) return row;
    return row.id === id ? { ...row, expanded: open } : { ...row, expanded: false };
  });
}

/** `setOpen` with the state flipped -- what a click on a row's triangle does. */
export function toggleOpen(list, id) {
  const row = get(list, id);
  if (!row) return list;
  return setOpen(list, id, !row.expanded);
}

/**
 * MERGE rows into a segment, in the order they appear on the axis.
 *
 * The selection is a set of ids, so the members are taken in AXIS ORDER rather than
 * click order -- which is what makes a Shift-click range come out as the rotation the
 * user sees. Taking them in click order was the obvious implementation and it is
 * wrong: the merged block would be shuffled.
 *
 * The segment lands where the FIRST member was, so merging never moves the block. If
 * it were appended instead, a user who merged rows 3-8 would find them at the end of
 * the axis and have to drag them back.
 *
 * Returns the SAME list when it cannot merge (fewer than two rows, or one of them is
 * itself a segment -- segments do not nest, because the group renders its members as
 * ordinary rows and a nested one would be a header that cannot be opened).
 */
export function merge(list, ids, { id, name = '' }) {
  const wanted = new Set(ids);
  const members = list.filter((row) => wanted.has(row.id));
  if (members.length < 2 || members.some(isSegment)) return list;

  const firstAt = list.findIndex((row) => row.id === members[0].id);
  const rest = list.filter((row) => !wanted.has(row.id));
  const segment = {
    id,
    kind: SEGMENT_KIND,
    name,
    children: members.map((row) => ({ ...row, expanded: false })),
    expanded: false,
  };
  // Clamped to the filtered list, so the index cannot point past the end.
  const at = Math.min(firstAt, rest.length);
  return [...rest.slice(0, at), segment, ...rest.slice(at)];
}

/**
 * UNDO A MERGE, putting the members back where the segment was.
 *
 * The order is preserved exactly, so a merge followed by a dissolve is a no-op --
 * which is the property that makes the feature safe to try.
 */
export function dissolve(list, segmentId) {
  const at = list.findIndex((row) => row.id === segmentId && isSegment(row));
  if (at < 0) return list;
  const kids = rows(list[at]).map((row) => ({ ...row, expanded: false }));
  return [...list.slice(0, at), ...kids, ...list.slice(at + 1)];
}

/**
 * The rows of a list in display order, FLATTENED for anything that wants a sequence.
 *
 * A segment contributes its members in place, so the result reads in the order the
 * axis shows. `index` is the position within the result, which is what a row's number
 * on screen shows -- a member numbered from its own segment's start was the bug that
 * made every row in a loop read "1".
 */
export function flatten(list) {
  const out = [];
  const visit = (row, depth) => {
    if (isSegment(row)) {
      rows(row).forEach((kid) => visit(kid, depth + 1));
      return;
    }
    out.push({ row, depth, index: out.length });
  };
  (list || []).forEach((row) => visit(row, 0));
  return out;
}
