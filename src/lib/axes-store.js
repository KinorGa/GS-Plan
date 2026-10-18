// The damage axes: a named list, one of which is active.
//
// WHY A LIST AND NOT ONE AXIS
//   A rotation is not one sequence. Single-target and AoE want different ones,
//   and so do "burst window" and "no burst". They belong to the SAME team and the
//   SAME configuration, so they live together rather than as separate documents
//   the user has to remember to save.
//
// WHAT IS STORED
//   `{ version, axes: [{ id, name, entries }], activeId }`
//
//   `activeId` is persisted even though it looks like UI state: being on axis 3
//   and reloading should come back to axis 3, the same way a document editor
//   reopens the file you had.
//
//   `name` is the user's own string and may be EMPTY. An unnamed axis renders as
//   a localised "Axis 1" rather than storing a translated default, so the name is
//   not frozen in whichever language happened to be active when it was created.

import { DAMAGE_TYPES, KEY_SUFFIX } from './elements';
import { packAxes, unpackAxes } from './axes-pool';
import { normaliseScalingBasis } from './damage';

const STORAGE_KEY = 'lunaris-axes';

/**
 * The previous single-axis key.
 *
 * Superseded, but read once so an existing rotation is adopted rather than
 * silently lost, then removed -- leaving it behind would resurrect old entries
 * the next time the new store is empty, after a clear.
 */
const LEGACY_ROTATION_KEY = 'lunaris-rotation';

/**
 * Bumped only when a change would break an older reader.
 *
 * 2 -- a stored row now keeps its repeated descriptors in pools (see
 * `axes-pool.js`) and carries `sourceRef`/`buffRefs` instead of an inline
 * `source`/`buffs`. A reader that does not know about the pools sees a drop with
 * no source and DISCARDS it, so every row would come back empty. The number is
 * not decoration: it is what a future reader will check before trusting a file.
 */
export const AXES_VERSION = 2;

/** A fresh axis. `name` empty means "unnamed"; the UI renders a fallback. */
export const blankAxis = (id) => ({ id, name: '', entries: [] });

/**
 * The next free axis id.
 *
 * Derived from the list, not a module counter: a counter restarts on every page
 * load, so an axis added after a restore would take an id an existing axis holds
 * -- and two axes sharing an id means switching between them silently edits both.
 */
export function nextAxisId(axes) {
  const highest = (axes || []).reduce((max, a) => {
    const n = Number(String(a?.id || '').replace(/^ax/, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `ax${highest + 1}`;
}

/** The next free entry id WITHIN one axis. */
export function nextEntryId(entries) {
  const highest = (entries || []).reduce((max, e) => {
    const n = Number(String(e?.id || '').replace(/^e/, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `e${highest + 1}`;
}

/**
 * Bring a stored axis list up to date, repairing anything missing.
 *
 * Accepts three shapes, because all three exist in the wild:
 *   `{ version, axes, activeId }`   the current form
 *   `{ version, entries }`          the previous single rotation
 *   `[...entries]`                  a bare list, which is what a hand-written
 *                                   file most obviously looks like
 *
 * A `pools` key is NOT this function's business -- `unpackAxes` has already put
 * an inline `source` back on every drop by the time it gets here, and a drop
 * with no source is discarded below.
 *
 * Always returns at least ONE axis, so the UI never has to render an empty
 * selector, and `activeId` always names a real axis.
 */
export function normaliseAxes(raw) {
  let axes = [];
  let activeId = null;

  if (Array.isArray(raw)) {
    // A bare list of entries -> one axis holding them.
    axes = [{ ...blankAxis('ax1'), entries: repairEntries(raw) }];
  } else if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.axes)) {
      axes = raw.axes.map((a, i) => repairAxis(a, i));
    } else if (Array.isArray(raw.entries)) {
      // The legacy single rotation.
      axes = [{ ...blankAxis('ax1'), entries: repairEntries(raw.entries) }];
    }
    activeId = raw.activeId || null;
  }

  // Guarantee at least one axis.
  if (!axes.length) axes = [blankAxis('ax1')];

  // Guarantee unique ids, so switching axes cannot edit two at once.
  const seen = new Set();
  for (const a of axes) {
    if (!a.id || seen.has(a.id)) a.id = nextAxisId(axes.filter((x) => seen.has(x.id)));
    seen.add(a.id);
  }

  if (!activeId || !axes.some((a) => a.id === activeId)) activeId = axes[0].id;

  return { version: AXES_VERSION, axes, activeId };
}

/** One axis, with its entries repaired. */
function repairAxis(a, index) {
  return {
    ...a,
    id: String(a?.id || `ax${index + 1}`),
    name: typeof a?.name === 'string' ? a.name : '',
    entries: repairEntries(a?.entries),
  };
}

/** Entries, with anything the card cannot draw removed. */
function repairEntries(list, depth = 0) {
  const entries = [];
  const seen = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue;
    let id = String(e.id || '');
    if (!id || seen.has(id)) id = nextEntryId(entries);
    seen.add(id);

    /**
     * A LOOP IS AN ENTRY THAT HOLDS OTHER ENTRIES.
     *
     * It branches HERE, before the ordinary fields, because everything below
     * assumes `children` means "the parts of one talent row" -- and for a loop they
     * are independent rows. `repairChildren` enforces a UNIQUE `partIndex`, sorts by
     * it and DROPS anything without one, so running a loop through it would discard
     * every entry inside: the loop would come back EMPTY after a reload, with the
     * data still in the file and nothing on screen to explain it. That failure is
     * silent and total, which is why this branch is first and why it has its own
     * test.
     *
     * The children go through `repairEntries` -- the SAME repair a top-level entry
     * gets, because that is exactly what they are.
     *
     * `depth` IS ENFORCED, and the check must come before this branch. A loop
     * inside a loop cannot be rendered -- `EntryGroup` draws a member with the
     * SAME component it uses at the top level, so an inner segment would be an
     * unopenable header -- and it cannot be EDITED either: `rotation-segment`'s
     * `locate` descends exactly one level, so a row two levels down is never
     * found and every edit to it is silently dropped. That is the same class of
     * failure as the one this branch exists for, so an inner loop is FLATTENED to
     * its entries here. It used to be kept verbatim -- `depth` was passed down
     * and never read -- so a hand-edited file or a stale `localStorage` could
     * reintroduce the uneditable shape. `merge` refuses to create one, so this
     * is the only way back in.
     */
    if (e.kind === 'segment' && depth > 0) {
      entries.push(...repairEntries(e.children, depth));
      continue;
    }

    if (e.kind === 'segment') {
      const kids = repairEntries(e.children, depth + 1);
      // A loop with nothing in it is not a group, it is a line that cannot be
      // opened -- so it is dropped rather than kept as an empty shell.
      if (!kids.length) continue;
      entries.push({
        id,
        kind: 'segment',
        name: String(e.name || ''),
        children: kids,
        expanded: false,
      });
      continue;
    }

    entries.push({
      ...e,
      id,
      charId: e.charId || 'none',
      // Omitted stays omitted: a child with no value of its own inherits the
      // parent at compute time, and defaulting it to `atk` here would freeze that
      // inheritance on the first load. A stored value, including the Chinese
      // spelling an imported file may carry, is normalised once.
      ...(e.scalingBasis != null
        ? { scalingBasis: normaliseScalingBasis(e.scalingBasis) }
        : {}),
      // A drop without a `source` cannot be rendered, so it is dropped here
      // rather than crashing the card.
      drops: (Array.isArray(e.drops) ? e.drops : []).filter((d) => d && d.source),
      // Only the fields the user CHANGED. The panel itself is derived from the
      // team now, so a stored whole panel would freeze values the team should
      // still be driving.
      //
      // An older entry's `stats` is DISCARDED rather than promoted to overrides:
      // those numbers were the card's hardcoded defaults (one demo character's
      // stats applied to everyone), so keeping them would pin every entry to
      // numbers that were never this character's. Deleting them lets the entry
      // re-derive, which is the improvement.
      statOverrides: repairOverrides(e.statOverrides),
      summary: e.summary || null,
      // THE CHILD ENTRIES, for a talent row that carries more than one number.
      //
      // Repaired exactly like a top-level entry -- its own drops, its own
      // overrides -- because a child IS an ordinary entry that happens to sit
      // under a parent. Sharing anything with the parent or with a sibling would
      // defeat the reason the split exists: the halves meet different
      // resistances, so a buff belongs to one of them.
      //
      // Absent for an entry whose row has a single number, which is most of them,
      // so a saved axis written before this existed loads unchanged.
      children: repairChildren(e.children),
      // Never restored as open: which entry is expanded is a property of the
      // moment, and a restored axis reads better collapsed.
      expanded: false,
    });
  }
  return entries;
}

/**
 * A parent's children, or `undefined` when there are none.
 *
 * `undefined` rather than `[]`: the planner treats "no children" as the ordinary
 * single-hit entry, and an empty array would be a third state meaning the same
 * thing -- one more branch for every reader to get wrong.
 */
function repairChildren(list) {
  if (!Array.isArray(list) || !list.length) return undefined;
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    // `partIndex` decides WHERE the child sits and WHICH coefficient it uses, so
    // a child without one is unrenderable rather than defaultable.
    const partIndex = Number(c.partIndex);
    if (!Number.isInteger(partIndex) || partIndex < 0 || seen.has(partIndex)) continue;
    seen.add(partIndex);
    out.push({
      ...c,
      id: String(c.id || `p${partIndex}`),
      partIndex,
      ...(c.scalingBasis != null
        ? { scalingBasis: normaliseScalingBasis(c.scalingBasis) }
        : {}),
      // Null is a REAL state here: it means "the user has not said what element
      // this half is", and the child says so on screen. It must not be coerced to
      // the skill's element, which would state something the data does not.
      element: c.element || null,
      drops: (Array.isArray(c.drops) ? c.drops : []).filter((d) => d && d.source),
      statOverrides: repairOverrides(c.statOverrides),
      expanded: false,
    });
  }
  // Sorted, so the children always read in the order the numbers appear in the
  // talent text regardless of how they were stored.
  out.sort((a, b) => a.partIndex - b.partIndex);
  return out.length ? out : undefined;
}

/**
 * Bring a saved override set up to date.
 *
 * THE ONE THING THAT MUST NOT BE SKIPPED HERE. Enemy resistance used to be a
 * SINGLE field, `enemyRes`, defaulting to 10. It is now one field per damage
 * type. A saved override of `{ enemyRes: 30 }` -- "this boss takes less" --
 * would otherwise become `{ enemyRes: 30 }` pointing at a field nothing reads
 * any more, so every hit would fall back to the standard 10% and the damage
 * would silently jump by about 20% with nothing on screen to explain it.
 *
 * So the old value is SPREAD ACROSS all eight types. That is what "the enemy's
 * resistance" meant while there was one field, and it keeps the numbers a stored
 * rotation already produced.
 *
 * `resShred` is deliberately NOT migrated: the generic field still feeds the
 * formula, so an old shred keeps counting exactly as before.
 *
 * WHAT THIS MUST NOT DO. It keys off the PRESENCE of `enemyRes`, never off the
 * panel's values. An earlier version spread the panel's eight values instead,
 * which looked equivalent and was not: an entry with NO overrides still shows all
 * eight fields at their 10% default, so the first keystroke anywhere wrote eight
 * overrides -- each of which then legitimately beat the value derived from the
 * team, because that is what an override means. Editing one field silently froze
 * the enemy's resistances at the defaults.
 */
export function repairOverrides(raw) {
  if (!raw || typeof raw !== 'object' || !('enemyRes' in raw)) return raw || {};
  const overrides = { ...raw };
  const legacy = overrides.enemyRes;
  delete overrides.enemyRes;
  // A non-numeric legacy value is not silently dropped: the field is removed
  // (nothing reads it) and the per-type fields keep their own defaults, which is
  // the same reading as an absent value anywhere else.
  if (typeof legacy === 'number' && Number.isFinite(legacy)) {
    for (const t of DAMAGE_TYPES) {
      overrides[`enemyRes${KEY_SUFFIX[t]}`] ??= legacy;
    }
  }
  return overrides;
}

/**
 * The stored axes, or a fresh single axis.
 *
 * A corrupt value is treated as absent rather than thrown: this runs during
 * render, so one bad key would blank the page.
 */
export function loadAxes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // UNPACKED BEFORE NORMALISING: the pools are what put a `source` back on a
    // drop, and normalising a pooled row first would throw every drop away.
    if (raw) return normaliseAxes(unpackAxes(JSON.parse(raw)));
  } catch {
    return normaliseAxes(null);
  }

  // Nothing in the new key -- adopt the legacy rotation if there is one.
  try {
    const legacy = localStorage.getItem(LEGACY_ROTATION_KEY);
    if (legacy) {
      const adopted = normaliseAxes(unpackAxes(JSON.parse(legacy)));
      // Persist the adopted document before dropping the legacy key. Mount-time
      // saving is now change-driven, so waiting for the first edit would make a
      // reload before that edit lose the migration entirely.
      saveAxes(adopted);
      // Removed so it cannot resurrect entries after a later clear.
      localStorage.removeItem(LEGACY_ROTATION_KEY);
      return adopted;
    }
  } catch {
    // A corrupt legacy value is simply ignored.
  }

  return normaliseAxes(null);
}

/**
 * Persist the axes.
 *
 * PACKED, for the same reason the exported file is: the repeated descriptors
 * are the bulk of the document, and the quota this has to fit in is about 5 MB
 * -- which a single imported rotation used to reach on its own.
 */
export function saveAxes(state) {
  try {
    // The planner normalises on LOAD and every mutation keeps that shape, so
    // normalising the whole document again here only added a full tree walk to a
    // hot path. Callers that start from an arbitrary document go through
    // `normaliseAxes` explicitly (as the planner does).
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packAxes(state)));
  } catch (err) {
    warnSaveFailed(err);
  }
  return state;
}

/**
 * Say so when a write is lost.
 *
 * ONCE per session, and to the console. This runs inside a `useEffect` on every
 * edit, so a dialog would re-open on the next keystroke and be worse than the
 * problem it reports -- but swallowing it entirely (which is what this did) left
 * the page rendering state that a refresh would silently revert.
 */
let warnedSaveFailed = false;
function warnSaveFailed(err) {
  if (warnedSaveFailed) return;
  warnedSaveFailed = true;
  console.error('配置没能写入 localStorage（多半是配额已满），本次改动刷新后会丢失。请导出 JSON 备份。', err);
}

/**
 * Replace the whole axis list, e.g. on import.
 *
 * Unlike `saveAxes` this does NOT normalise, because the caller has already
 * parsed a document through `parseConfigFile` -- and normalising twice would
 * renumber ids the file deliberately specified. `packAxes` is safe to run here:
 * it rewrites descriptors only, and has no opinion about ids.
 */
export function replaceAxes(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packAxes(state)));
  } catch (err) {
    warnSaveFailed(err);
  }
  return state;
}
