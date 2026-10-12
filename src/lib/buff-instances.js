// Buff instances: a template source the user has instantiated with values of
// its own, bound to damage entries by splicing tagged copies into their drops.
//
// WHY A SECOND POOL
//   The template pool copies a source at DRAG TIME: the entry keeps its own
//   snapshot and nothing links the two afterwards. That is right for a quick
//   one-off, and unmanageable at fifty entries -- typing the same weapon's
//   numbers fifty times, then changing one of them.
//
//   An instance is the fix: ONE definition (the template snapshot plus the
//   values the user typed), bound to as many entries as needed. Two instances
//   of one template are two definitions, because their values differ -- the
//   instance is the unit of "this buff, at these numbers", not the template.
//
// THE BINDING IS NOT STORED HERE
//   An instance holds NO list of entry ids. "Which entries have it" is derived
//   from the entries' drops, each of which carries the `instanceId` that
//   spliced it there. Deriving rather than storing is what keeps the two sides
//   honest: a drop deleted on the entry side unbinds itself, and an instance
//   deleted here can find every copy it left behind.
//
// PERSISTED IN LOCALSTORAGE
//   The same home the axes and the buff library use. An instance's values are
//   typed by hand, so losing them on a reload would be the one thing worse
//   than not having instances.

import { useEffect, useState } from 'react';

/** Where instances live, the way the axes live in their own key. */
export const INSTANCES_STORAGE_KEY = 'lunaris-buff-instances';

/**
 * The drop id of a spliced instance copy.
 *
 * DETERMINISTIC, not a counter: a re-splice (the instance's values changed)
 * must replace the copy it left before, and a deterministic id is what makes
 * "replace in place" possible. A counter would hand the new copy a fresh id
 * and leave the old one looking like a second buff.
 */
export const instanceDropId = (id) => `inst-${id}`;

/** Load the instances, repairing whatever a bad write damaged. */
export function loadInstances() {
  try {
    return normaliseInstances(JSON.parse(localStorage.getItem(INSTANCES_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

/**
 * Bring a stored instance list up to date.
 *
 * An entry without an id or a template cannot be rendered or re-spliced, so it
 * is dropped rather than kept -- the same repair `normaliseAxes` does for axes.
 * A duplicate id is dropped too: two instances with one id would splice into
 * entries under the same tag and unbind together, which is not two instances.
 */
export function normaliseInstances(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !item.id || !item.template) continue;
    const id = String(item.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      seq: Number(item.seq) || out.length + 1,
      template: { ...item.template },
      buffs: Array.isArray(item.buffs)
        ? item.buffs.map((b) => ({ key: b?.key ?? '', value: b?.value ?? '', tag: b?.tag || '' }))
        : [],
    });
  }
  return out;
}

/** Persist. A quota error keeps the session's copy; there is nothing else to do. */
export function saveInstances(list) {
  try {
    localStorage.setItem(INSTANCES_STORAGE_KEY, JSON.stringify(list || []));
  } catch {
    /* Storage full or blocked: the in-memory list still works this session. */
  }
}

/**
 * The next free instance id, FROM THE LIST.
 *
 * A module counter restarts at 1 after a reload and would hand out an id a
 * restored instance already holds -- the exact bug `nextEntryId` documents in
 * `axes-store.js`. The list is the only record that survives a reload.
 */
export function nextInstanceId(list) {
  const highest = (list || []).reduce((max, i) => {
    const n = Number(String(i?.id || '').replace(/^i/, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `i${highest + 1}`;
}

/**
 * An instance built from a template card.
 *
 * The template snapshot is COPIED, not referenced: the pool re-derives on every
 * team edit, and an instance must keep the shape it was created from even after
 * its source leaves the pool (a flag change, a weapon swap). `libKey` travels
 * with the snapshot, which is how instances of one template are counted.
 */
export function instanceFromTemplate(template, list = []) {
  const libKey = template?.libKey || null;
  const seq = list.filter((i) => (i.template?.libKey || null) === libKey).length + 1;
  return {
    id: nextInstanceId(list),
    seq,
    template: {
      kind: template?.kind,
      icon: template?.icon,
      iconKind: template?.iconKind,
      rank: template?.rank || '',
      name: template?.name || null,
      owner: template?.owner || null,
      libKey,
    },
    buffs: (template?.buffs || []).map((b) => ({
      key: b?.key ?? '',
      value: b?.value ?? '',
      tag: b?.tag || '',
    })),
  };
}

/**
 * Bind or unbind one instance on one entry's drop list.
 *
 * THE WHOLE MECHANISM. Binding appends one drop tagged with the instance id;
 * unbinding removes every drop so tagged. Re-splicing -- which is what a value
 * edit on the instance does to each bound entry -- REPLACES the copy in place,
 * so changing a number does not jump the card to the end of the row.
 *
 * `snapshot` carries the instance as it is NOW (`{ template, buffs }`); a
 * bind/unbind passes it, an unbind passes `null` and only cleans up.
 *
 * @param {Array}  drops      The entry's current drops.
 * @param {string} instanceId
 * @param {boolean} on        Bind when true, unbind when false.
 * @param {object} [snapshot] `{ template, buffs }` -- required to bind.
 * @returns {Array} A new drop list; `drops` is not mutated.
 */
export function spliceInstance(drops, instanceId, on, snapshot) {
  const list = Array.isArray(drops) ? drops : [];
  const without = list.filter((d) => !d || d.instanceId !== instanceId);
  if (!on || !snapshot) return without;
  const drop = {
    id: instanceDropId(instanceId),
    instanceId,
    source: { ...snapshot.template },
    buffs: (snapshot.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
  };
  const at = list.findIndex((d) => d && d.instanceId === instanceId);
  if (at === -1) return [...without, drop];
  // `without` is the list minus exactly the one tagged drop, so index `at`
  // still points at the same neighbours: the copy goes back where it was.
  return [...without.slice(0, at), drop, ...without.slice(at)];
}

/**
 * The instances, persisted.
 *
 * Lives HERE rather than in the planner because everything instance-shaped
 * (create, update, remove, persistence) belongs to the pool that renders them;
 * the planner only answers with `entries` and the splice callback.
 */
export function useInstances() {
  const [instances, setInstances] = useState(() => loadInstances());

  useEffect(() => {
    saveInstances(instances);
  }, [instances]);

  const create = (template) => {
    const inst = instanceFromTemplate(template, instances);
    setInstances((list) => [...list, inst]);
    return inst;
  };
  const update = (id, patch) =>
    setInstances((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id) => setInstances((list) => list.filter((i) => i.id !== id));

  return { instances, create, update, remove };
}
