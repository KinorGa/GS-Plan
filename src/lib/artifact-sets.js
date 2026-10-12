// The container that lets one unit hold SEVERAL artifact configurations.
//
// WHAT CHANGED AND WHY
//   A unit used to hold exactly one build: `unit.artifacts` WAS the five-slot
//   object. A build is a thing people keep more than one of -- "the crit set",
//   "the EM set", "the one I am still rolling" -- and swapping between them meant
//   editing the same five slots back and forth and losing the previous numbers.
//
//   So `unit.artifacts` is now a CONTAINER:
//
//       { active: 'a1', sets: [ { id, name, slots: {flower,...} }, ... ] }
//
//   `slots` is exactly the old build object, so `artifact-model.js` and
//   `ArtifactRow` do not change at all: they still see five independent slots.
//   Only the layer that OWNS the build changed, and it changed in one place.
//
// SELECTING IS USING. `active` names the set every derived number reads, so there
//   is no "apply" step: a consumer calls `activeArtifacts(unit)` and gets the slots
//   of whichever set is active. The stat panel, the 2/4-piece pool sources, the
//   `$` formula scope and the damage rows all read through that one selector, so
//   they cannot disagree about which build is in play.
//
// BACK-COMPATIBLE ON READ. `activeArtifacts` still accepts a bare five-slot build
//   (a hand-built unit, or a file written before this feature), so no caller has
//   to know the container exists unless it is CHANGING which set is active.

import { SLOTS, blankPiece, blankSet } from './artifact-model';

/** Whether `raw` is an OLD-style bare build (slot keys directly on it). */
export function looksLikeBuild(raw) {
  return !!raw && typeof raw === 'object' && SLOTS.some((s) => s.key in raw);
}

/**
 * One build's slots, normalised to a complete five-slot object.
 *
 * Only keys that exist in the model are copied, so a stray sixth key in a file
 * cannot introduce a slot the row would not render, and each piece is merged over
 * a blank one so a partial piece in a file is still renderable.
 */
export function normaliseSlots(raw) {
  const slots = blankSet();
  for (const { key } of SLOTS) {
    const piece = raw?.[key];
    if (piece && typeof piece === 'object') slots[key] = { ...blankPiece(), ...piece };
  }
  return slots;
}

/** A fresh, unnamed set. Its id is assigned by `addArtifactSet` / `normaliseArtifacts`. */
export const blankArtifactSet = (name = null) => ({ id: null, name: name || null, slots: blankSet() });

/** A fresh container: one blank set, active. */
export function blankArtifacts() {
  return { active: 'a1', sets: [{ id: 'a1', name: null, slots: blankSet() }] };
}

/**
 * The next free set id, derived from the list rather than a counter.
 *
 * A counter would restart after a reload and hand out an id a restored set
 * already holds, so renaming one config would rename another.
 */
export function nextArtifactSetId(sets) {
  const highest = (sets || []).reduce((max, s) => {
    const n = Number(String(s?.id || '').replace(/^a/, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `a${highest + 1}`;
}

/**
 * Fill in anything a loaded container is missing, migrating the OLD shape.
 *
 * The old shape -- `artifacts` being the bare build -- is wrapped as a single set
 * named nothing, which is what it was: one build. This is the whole migration; a
 * file written before this feature loads with its numbers intact.
 */
export function normaliseArtifacts(raw) {
  let sets;
  if (Array.isArray(raw?.sets) && raw.sets.length) {
    sets = raw.sets.map((s, i) => ({
      id: typeof s?.id === 'string' && s.id ? s.id : `a${i + 1}`,
      name: typeof s?.name === 'string' ? s.name : null,
      slots: normaliseSlots(s?.slots),
    }));
  } else if (looksLikeBuild(raw)) {
    sets = [{ id: 'a1', name: typeof raw.name === 'string' ? raw.name : null, slots: normaliseSlots(raw) }];
  } else {
    sets = [{ id: 'a1', name: null, slots: blankSet() }];
  }

  // Guarantee unique ids even if a file repeated one -- the id is how `active`
  // addresses a set, so a duplicate would make one of them unreachable.
  const seen = new Set();
  for (const s of sets) {
    let id = s.id;
    let n = 1;
    while (seen.has(id)) id = `${s.id}-${n++}`;
    s.id = id;
    seen.add(id);
  }

  const active = typeof raw?.active === 'string' && seen.has(raw.active) ? raw.active : sets[0].id;
  return { active, sets };
}

/**
 * The five slots of the unit's ACTIVE set, or the bare build when a unit still
 * carries the old shape.
 *
 * THIS IS THE ONE SELECTOR every derived reader goes through. Keeping it in one
 * place is what makes "selecting is using" true rather than a property four
 * call sites have to remember.
 */
export function activeArtifacts(unit) {
  const raw = unit?.artifacts;
  if (Array.isArray(raw?.sets)) {
    const found = raw.sets.find((s) => s.id === raw.active) || raw.sets[0];
    return found?.slots || null;
  }
  return looksLikeBuild(raw) ? raw : null;
}

/* --------------------------------------------------------------- updates */

/** Make `id` the active set. An unknown id is ignored rather than clearing. */
export function setActiveArtifactSet(artifacts, id) {
  if (!(artifacts?.sets || []).some((s) => s.id === id)) return artifacts;
  return { ...artifacts, active: id };
}

/** Append a set and make it active, because adding one is to use it. */
export function addArtifactSet(artifacts, name = null) {
  const sets = artifacts?.sets || [];
  const set = { ...blankArtifactSet(name), id: nextArtifactSetId(sets) };
  return { active: set.id, sets: [...sets, set] };
}

/** Rename a set. A blank name becomes `null`, which renders as the default label. */
export function renameArtifactSet(artifacts, id, name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  return {
    ...artifacts,
    sets: (artifacts?.sets || []).map((s) => (s.id === id ? { ...s, name: clean || null } : s)),
  };
}

/**
 * Remove a set. The LAST one cannot be removed -- a unit always has a build, the
 * same way an axis always has one -- so it is refused rather than leaving nothing.
 * When the active set is the one removed, the first remaining set becomes active.
 */
export function removeArtifactSet(artifacts, id) {
  const sets = artifacts?.sets || [];
  if (sets.length <= 1) return artifacts;
  const next = sets.filter((s) => s.id !== id);
  if (next.length === sets.length) return artifacts;
  const active = artifacts.active === id ? next[0].id : artifacts.active;
  return { ...artifacts, active, sets: next };
}

/** Replace one set's slots, leaving which set is active alone. */
export function setArtifactSlots(artifacts, id, slots) {
  return {
    ...artifacts,
    sets: (artifacts?.sets || []).map((s) => (s.id === id ? { ...s, slots } : s)),
  };
}
