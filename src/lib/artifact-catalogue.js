// Loading and indexing the artifact catalogue.
//
// DATA SOURCES
//   /data/artifactlist.json            every set: names, rarity, setIcon
//   /data/artifact/<lang>/<id>.json    one set's five pieces, each with its OWN
//                                      name and icon
//
// The piece icons are the interesting part: a set's five pieces have distinct
// artwork (`UI_RelicIcon_15047_1` .. `_5`), not a shared emblem, which is what
// lets the row show five different pictures for one set.
//
// There are 66 sets, so both are loaded once and indexed. Kept apart from
// `artifact-model.js` so a consumer that only needs the RULES (a calculator, a
// test) does not drag 66 file requests along with it.

import { useCallback, useEffect, useState } from 'react';
import { SLOTS } from './artifact-model';
import { createPromiseCache, fetchJson, fetchJsonOrThrow } from './json-cache';

/**
 * One entry per language, because a detail file is per-language: the piece
 * names differ between `chs` and `en`.
 *
 * Keying the cache on the language is what makes switching language refetch
 * rather than serve the other locale's names.
 */
const cache = createPromiseCache();

/** Discard the cached catalogue so the next load refetches. */
export function invalidateArtifacts() {
  cache.invalidate();
}

/**
 * Load the artifact catalogue: every set plus its five piece names/icons.
 *
 * Resolves to `{ sets, list }`, where `sets` is keyed by set id for lookup and
 * `list` is the display order for a picker grid.
 */
export function loadArtifacts(lang = 'chs') {
  return cache.get(lang, async () => {
    const list = await fetchJsonOrThrow('/data/artifactlist.json');

    const ids = Object.keys(list);
    const details = await Promise.all(
      ids.map((id) => fetchJson(`/data/artifact/${lang}/${id}.json`))
    );

    /** setId -> { id, chsName, enName, qualityType, setIcon, pieces, bonuses } */
    const sets = {};
    ids.forEach((id, i) => {
      const meta = list[id];
      const d = details[i];
      const pieces = {};
      for (const [slot, p] of Object.entries(d?.info?.pieces || {})) {
        pieces[slot] = { icon: p.icon, name: p.name };
      }
      sets[id] = {
        id,
        chsName: meta.chsName,
        enName: meta.enName,
        qualityType: meta.qualityType,
        setIcon: meta.setIcon,
        pieces,
        bonuses: d?.info?.setBonuses || null,
      };
    });

    return { sets, list: displayOrder(sets) };
  });
}

/**
 * The set list as a picker should show it.
 *
 * Placeholders are dropped. Set 15000 is unreleased content: its name is
 * literally "???" in every language and its `setIcon` is an empty string, so it
 * would render as a broken tile that no user could identify. Detected by that
 * evidence rather than by hardcoding the id, so any future placeholder is
 * caught the same way.
 *
 * 5-stars sort first: a build reaches for one far more often, and there are 66
 * sets.
 */
function displayOrder(sets) {
  const isPlaceholder = (s) =>
    !s.setIcon ||
    /^\?+$/.test((s.enName || '').trim()) ||
    /^\?+$/.test((s.chsName || '').trim());

  return Object.values(sets)
    .filter((s) => !isPlaceholder(s))
    .sort(
      (a, b) =>
        (a.qualityType === 'QUALITY_ORANGE' ? 0 : 1) -
          (b.qualityType === 'QUALITY_ORANGE' ? 0 : 1) ||
        (a.enName || '').localeCompare(b.enName || '')
    );
}

/**
 * The icon for one slot of one set.
 *
 * Falls back to the set emblem when a particular piece has no artwork (9 pieces
 * are absent upstream), so a slot never renders an empty box.
 */
export function pieceIcon(sets, setId, slotKey) {
  const s = setId ? sets?.[setId] : null;
  if (!s) return null;
  return s.pieces?.[slotKey]?.icon || s.setIcon || null;
}

/**
 * The build's dominant set -- the one holding the most slots, or null.
 *
 * The row tints itself with this set's rarity colour, so the panel takes on the
 * colour of the build rather than an arbitrary one.
 */
export function dominantSetOf(sets, bonuses) {
  if (!bonuses?.length) return null;
  const top = bonuses.reduce((a, b) => (b.pieces > a.pieces ? b : a));
  return sets?.[top.setId] || null;
}

/** React binding for the artifact catalogue. */
export function useArtifacts(lang = 'chs') {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadArtifacts(lang)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [lang, attempt]);

  const retry = useCallback(() => {
    invalidateArtifacts();
    setData(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    sets: data?.sets || null,
    list: data?.list || [],
    error,
    retry,
    loading: !data && !error,
  };
}

// Re-exported so a consumer iterating `SLOTS` does not need two imports.
export { SLOTS };
