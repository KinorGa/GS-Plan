// The team document as shared state.
//
// WHY A CONTEXT RATHER THAN STATE IN A PAGE
//   The requirement is that the team be readable by OTHER components -- a damage
//   card, a summary bar, a future calculator -- without every one of them being
//   handed the whole tree through props. A context is the smallest thing that
//   does that, and it keeps the update functions (`setUnit`, `addUnit`…)
//   next to the data they act on.
//
// WHY IT ALSO PERSISTS
//   A context only spans ONE page. The builder and the planner are separate
//   documents, so a context alone gave the planner an empty team -- which is
//   exactly what happened the first time these two pages were connected. The
//   team is therefore also written to `localStorage` and re-read on mount, so
//   "the team" means the same thing on every page of the app.
//
//   It is the SAME serialised document the export button produces, so there is
//   one format to reason about rather than a storage shape plus a file shape.
//
// WHAT IS AND IS NOT IN HERE
//   Only the document. Anything derived -- a character's stats, the artifact
//   bonus count, the buff pool -- is computed by the consumer from the document,
//   so a new consumer never has to be taught about a new field.
//
// The hook falls back to a local, throwaway team when used outside a provider,
// so a `TeamScope`-aware component can still be dropped into a page (or a
// standalone preview) that has no provider and it will render and be
// interactive rather than throwing.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  addUnit as addUnitTo, blankTeam, normaliseTeam, parseTeam, removeUnit as removeUnitFrom,
  serialiseTeam, withUnit,
} from './team-model';

const TeamCtx = createContext(null);

/** Where the live document lives between page loads. */
const STORAGE_KEY = 'lunaris-team';

/**
 * The stored team, or a blank one.
 *
 * A corrupt or unreadable value is treated as absent rather than thrown: this
 * runs during render, so one bad key in storage would blank every page in the
 * app. Private-mode storage denies reads entirely, which is also not an error.
 */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankTeam();
    return parseTeam(raw);
  } catch {
    return blankTeam();
  }
}

export function TeamProvider({ children, initial }) {
  const [team, setTeam] = useState(() => (initial ? normaliseTeam(initial) : readStored()));

  // Persist on every change. The serialised form is the same one the export
  // button writes, so the two cannot drift into different formats.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serialiseTeam(team));
    } catch {
      // Quota or private mode. The team still works on this page; it just will
      // not survive a reload, which is a degradation rather than a failure.
    }
  }, [team]);

  // Another TAB editing the team should update this one, or two open tabs would
  // each overwrite the other's work on their next keystroke.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try { setTeam(parseTeam(e.newValue)); } catch { /* ignore a bad write */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /**
   * Replace one unit by id.
   *
   * Accepts a patch object OR a function of the current unit, because the
   * artifact row updates a slot based on the piece it already holds and a plain
   * object would have to be rebuilt from a stale read.
   */
  const setUnit = useCallback((id, patch) => {
    setTeam((t) => {
      const current = (t.units || []).find((u) => u.id === id);
      if (!current) return t;
      const next = typeof patch === 'function' ? patch(current) : patch;
      return withUnit(t, id, next);
    });
  }, []);

  const addUnit = useCallback((charId) => {
    let created = null;
    setTeam((t) => {
      const next = addUnitTo(t, charId);
      created = next.units[next.units.length - 1]?.id ?? null;
      return next;
    });
    return created;
  }, []);

  const removeUnit = useCallback((id) => setTeam((t) => removeUnitFrom(t, id)), []);
  const replaceTeam = useCallback((next) => setTeam(normaliseTeam(next)), []);

  /** Serialise the current team. Reads the latest state, so it cannot be stale. */
  const exportTeam = useCallback(() => serialiseTeam(team), [team]);

  const importTeam = useCallback((text) => setTeam(parseTeam(text)), []);

  const value = useMemo(
    () => ({ team, units: team.units || [], setTeam, setUnit, addUnit, removeUnit, replaceTeam, exportTeam, importTeam }),
    [team, setUnit, addUnit, removeUnit, replaceTeam, exportTeam, importTeam]
  );

  return <TeamCtx.Provider value={value}>{children}</TeamCtx.Provider>;
}

/**
 * Read and write the team.
 *
 * Outside a provider this keeps its own state for the life of the component, so
 * a consumer is never forced to be wrapped just to render. That fallback is
 * per-hook rather than shared, which is the honest behaviour: without a
 * provider there is nothing to share.
 */
export function useTeam() {
  const ctx = useContext(TeamCtx);
  const fallback = useRef(null);
  const [, force] = useState(0);

  if (ctx) return ctx;

  if (!fallback.current) {
    let team = normaliseTeam(blankTeam());
    const listeners = new Set();
    const set = (updater) => {
      team = typeof updater === 'function' ? updater(team) : updater;
      for (const l of listeners) l();
    };
    fallback.current = {
      get team() { return team; },
      get units() { return team.units; },
      setTeam: set,
      setUnit: (id, patch) => set((t) => {
        const current = t.units.find((u) => u.id === id);
        if (!current) return t;
        return withUnit(t, id, typeof patch === 'function' ? patch(current) : patch);
      }),
      addUnit: (charId) => { set((t) => addUnitTo(t, charId)); return team.units[team.units.length - 1]?.id ?? null; },
      removeUnit: (id) => set((t) => removeUnitFrom(t, id)),
      replaceTeam: (next) => set(normaliseTeam(next)),
      exportTeam: () => serialiseTeam(team),
      importTeam: (text) => set(parseTeam(text)),
      subscribe: (fn) => { listeners.add(fn); force((n) => n + 1); return () => listeners.delete(fn); },
    };
  }

  return {
    team: fallback.current.team,
    units: fallback.current.units,
    setTeam: fallback.current.setTeam,
    setUnit: fallback.current.setUnit,
    addUnit: fallback.current.addUnit,
    removeUnit: fallback.current.removeUnit,
    replaceTeam: fallback.current.replaceTeam,
    exportTeam: fallback.current.exportTeam,
    importTeam: fallback.current.importTeam,
  };
}
