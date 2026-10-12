// Assemble the data `buildUnitSources` needs, per unit.
//
// `lib/buff-sources.js` is pure: given a unit and its loaded data it returns the
// sources. This module is the React side -- it loads the catalogue and each
// unit's detail file through the existing caches and hands the result over.
//
// WHY NOT ONE FETCH PER SOURCE
//   A unit's sources come from three places: the character catalogue (element,
//   names), the character's detail file (skills, passives, constellations) and
//   the artifact catalogue (set names and bonus text). All three are already
//   cached module-wide -- `loadCharacterDetail` for 66 detail files, `loadArtifacts`
//   for the sets -- so a four-unit team resolves from two shared requests rather
//   than four.

import { useEffect, useMemo, useState } from 'react';
import { useCatalogue, loadCharacterDetail } from './catalogue';
import { loadArtifacts } from './artifact-catalogue';
import { buffsFor, loadLibrary, parseLibrary } from './buff-library';
import { loadFlags, invalidateFlags, isPooled, FLAGS_STORAGE_KEY } from './buff-flags';
import { buildUnitSources } from './buff-sources';

/** Where the library lives, so `useLibrary` can watch for changes to it. */
const LIBRARY_STORAGE_KEY = 'lunaris-buff-library';

/**
 * Load one character's detail file, tracking completion.
 *
 * `useCharacterDetail` already exists but returns `null` for both "loading" and
 * "failed"; the pool wants to distinguish them so a permanently failed load can
 * stop showing a spinner. Kept local rather than changing that hook's contract,
 * which two other components depend on.
 */
function useDetail(charId, lang) {
  const [state, setState] = useState({ id: null, detail: null });

  useEffect(() => {
    if (!charId) { setState({ id: null, detail: null }); return; }
    let alive = true;
    loadCharacterDetail(charId, lang).then((d) => {
      if (alive) setState({ id: charId, detail: d });
    });
    return () => { alive = false; };
  }, [charId, lang]);

  // Report the previous character's detail as absent rather than stale: showing
  // unit B the skills of unit A while B loads would mislabel every source.
  return state.id === charId ? state.detail : null;
}

/**
 * Every buff source for a team, in pool order.
 *
 * @param   {Array}  units  Units from the team document.
 * @param   {string} lang
 * @returns {Array} Sources, ready for `BuffPool`.
 */
export function useTeamSources(units, lang = 'chs') {
  const { catalogue } = useCatalogue();
  const [sets, setSets] = useState(null);
  const library = useLibrary();
  /**
   * Whether each source is a buff at all.
   *
   * Watched the same way the library is, and for the same reason: the marks are made
   * on the 增益库 page, which is a separate document. Without a listener an edit
   * there would not reach this hook until a reload, and the pool would keep offering
   * a card the user had just excluded.
   */
  const flags = useFlags();

  // The artifact catalogue is a module-level promise cache, so this resolves
  // once for the whole page regardless of how many units are on screen.
  useEffect(() => {
    let alive = true;
    loadArtifacts(lang).then((d) => { if (alive) setSets(d.sets); }).catch(() => {});
    return () => { alive = false; };
  }, [lang]);

  // One hook per unit is not possible in a loop, so the detail files are loaded
  // into a map keyed by character id. The map is keyed by ID rather than by
  // unit, so two units sharing a character share one request.
  const charIds = useMemo(
    () => [...new Set((units || []).map((u) => u?.char?.id).filter(Boolean))],
    [units]
  );
  const details = useDetails(charIds, lang);

  return useMemo(
    () =>
      (units || []).flatMap((u) =>
        buildUnitSources(u, {
          char: catalogue?.chars?.[u?.char?.id] || null,
          detail: details[u?.char?.id] || null,
          weapon: catalogue?.weapons?.[u?.weapon?.id] || null,
          sets,
        })
      )
        // Attach the buffs a human has recorded for each source. Done here
        // rather than inside `buildUnitSources` so that module stays a pure
        // description of a unit's sheet, with no idea a library exists.
        .map((s) => ({ ...s, buffs: buffsFor(library, s.libKey) }))
        /**
         * AND DROP THE ONES MARKED "NOT A BUFF".
         *
         * This is the ONLY place a mark hides anything. The 增益库 lists every source
         * whatever its mark, because that is the screen where a mistake gets undone;
         * the pool is the screen that should only offer things you can actually drop
         * onto a row.
         *
         * Only an explicit `false` is removed. An unmarked source stays -- most
         * sources are unmarked, and defaulting to hidden would quietly empty the pool
         * of every buff nobody has looked at yet.
         */
        .filter((s) => isPooled(flags, s.libKey)),
    [units, catalogue, details, sets, library, flags]
  );
}

/**
 * The buff library, kept in step with edits made on another page.
 *
 * The editor is a separate document, so an edit there lands in `localStorage`.
 * Without this the pool would show stale values until a reload, which reads as
 * "my edit did nothing".
 */
function useLibrary() {
  const [library, setLibrary] = useState(() => loadLibrary());

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== LIBRARY_STORAGE_KEY || !e.newValue) return;
      try { setLibrary(parseLibrary(e.newValue)); } catch { /* ignore a bad write */ }
    };
    window.addEventListener('storage', onStorage);
    // `focus` as well as `storage`: navigating within the same tab (planner ->
    // editor -> back) does not fire a storage event, and coming back from the
    // editor is the common case.
    const onFocus = () => setLibrary(loadLibrary());
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return library;
}

/**
 * The buff marks, kept in step with edits made on another page.
 *
 * The same two listeners `useLibrary` needs and for the same reason: the marks are
 * made on the 增益库 document, so `storage` fires for another TAB and `focus` covers
 * navigating away and back within this one. Coming back from the editor is the
 * common case, and it fires no storage event at all.
 */
function useFlags() {
  const [flags, setFlags] = useState(() => loadFlags());

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== FLAGS_STORAGE_KEY || !e.newValue) return;
      // `loadFlags` caches, so the listener clears it first -- otherwise it would
      // hand back the copy this page already holds and the edit would not arrive.
      invalidateFlags();
      setFlags(loadFlags());
    };
    const onFocus = () => { invalidateFlags(); setFlags(loadFlags()); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return flags;
}

/** Detail files for many characters, keyed by id. Shared by units. */
function useDetails(charIds, lang) {
  const [map, setMap] = useState({});
  const key = charIds.join(',');

  useEffect(() => {
    if (!charIds.length) { setMap({}); return; }
    let alive = true;
    Promise.all(
      charIds.map(async (id) => [id, await loadCharacterDetail(id, lang)])
    ).then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // `key` is the stable identity of `charIds`; depending on the array itself
    // would refetch on every render, since it is rebuilt each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lang]);

  return map;
}
