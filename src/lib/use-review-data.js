// The data layer of the talent-damage review page.
//
// WHY THIS IS SEPARATE FROM THE PAGE
//
// The review page is a table of ~1400 rows with a filter bar over it. Loading,
// joining against the character list, deriving the per-character totals and
// applying the filters are all data concerns with no JSX in them, and keeping
// them inside the component made it 470 lines long -- long enough that finding
// the filter logic meant scrolling past four hundred lines of table markup.
//
// Everything here is pure except the two fetches, so it can be reasoned about
// (and tested) without rendering anything.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DAMAGE_TYPE_OPTIONS } from '../components/ElementGlyph';

/** The Chinese element name for an id suffix like `10000005_ANEMO` (the Traveler). */
const SUFFIX_LABEL = Object.fromEntries(
  DAMAGE_TYPE_OPTIONS.map(([k, label]) => [k.toUpperCase(), label.chs])
);

/**
 * The verdict of one row, as one of four readable states.
 *
 * Four, not two: `damage` alone cannot distinguish "reviewed and ruled out" from
 * "never looked at", and that distinction is the whole point of keeping every slot
 * in the file. `no` is a row the generator never even considered a candidate.
 */
export function verdictOf(r) {
  if (r.damage === true) return 'on';
  if (r.needsReview) return 'review';
  if (!r.candidate) return 'no';
  return 'off';
}

/**
 * Load the curated table plus the character metadata, and expose the rows and
 * the filtered views over them.
 */
export function useReviewData({
  q = '',
  filter = 'all',
  charId = '',
  onlyPending = false,
  facetElement = '',
  facetRarity = '',
  facetWeapon = '',
} = {}) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [names, setNames] = useState({});
  // The character's own attributes, for faceted filtering. Separate from `names`
  // because a facet is a property of the CHARACTER, not of this file.
  const [meta, setMeta] = useState({});

  useEffect(() => {
    fetch('/data/talent-damage.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDoc)
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => {
    fetch('/data/charlist.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const src = j?.characters || j || {};
        const base = {};
        for (const [id, c] of Object.entries(src)) base[id] = c?.chsName || c?.enName || id;

        // DISAMBIGUATE NAMES THAT COLLIDE.
        //
        // The 14 旅行者 variants all carry the plain name "旅行者" -- the element
        // lives in the id's suffix (`10000005_ANEMO`). Fourteen identically
        // labelled tiles are unusable in a picker, so a name is qualified by its
        // suffix when it is not unique. Done generically rather than by special
        // casing 旅行者, because the next multi-form character would otherwise hit
        // the same wall silently.
        const counts = {};
        for (const n of Object.values(base)) counts[n] = (counts[n] || 0) + 1;

        const outNames = {};
        const outMeta = {};
        for (const [id, c] of Object.entries(src)) {
          const n = base[id];
          const suffix = id.includes('_') ? id.split('_')[1] : null;
          outNames[id] = counts[n] > 1 && suffix ? `${n}·${SUFFIX_LABEL[suffix] || suffix}` : n;
          // Rarity comes from `qualityType`, whose `_SP` variant (3 characters) is
          // still a five-star -- matching on `ORANGE` rather than equality is what
          // stops those three falling out of every filter.
          const quality = String(c?.qualityType || '');
          outMeta[id] = {
            element: c?.element || null,
            rarity: quality.includes('ORANGE') ? 5 : quality.includes('PURPLE') ? 4 : null,
            weapon: c?.weaponType || null,
          };
        }
        setNames(outNames);
        setMeta(outMeta);
      })
      .catch(() => {});
  }, []);

  const chars = doc?.characters || {};

  /** Every row, flattened, with its character id. */
  const rows = useMemo(() => {
    const out = [];
    for (const [id, entries] of Object.entries(chars)) {
      for (const [slot, e] of Object.entries(entries)) out.push({ id, slot, ...e });
    }
    // Enabled first, then the ones wanting review, then the rest -- the rows that
    // need attention should not be buried under a thousand obvious non-hits.
    const rank = { on: 0, review: 1, off: 2, no: 3 };
    return out.sort((a, b) => {
      const d = rank[verdictOf(a)] - rank[verdictOf(b)];
      if (d) return d;
      return a.id.localeCompare(b.id) || a.slot.localeCompare(b.slot);
    });
  }, [chars]);

  /**
   * Per-character totals, so the picker can show WHERE THE WORK IS.
   *
   * A flat list of 138 names is not a useful control: the effort is not spread
   * evenly (59 characters have something enabled, 113 have something to review,
   * 11 are finished), so a reviewer scrolling an alphabetical list is looking for
   * a needle they cannot see. Sorting by pending work turns it into a to-do list.
   */
  const perChar = useMemo(() => {
    const out = {};
    for (const [id, entries] of Object.entries(chars)) {
      let on = 0, review = 0, total = 0;
      for (const v of Object.values(entries)) {
        total++;
        if (v.damage === true) on++;
        if (v.needsReview) review++;
      }
      out[id] = { on, review, total, name: names[id] || id };
    }
    return out;
  }, [chars, names]);

  /** Whether a character passes the element/rarity/weapon facets. */
  const passesFacets = useCallback(
    (id) => {
      const m = meta[id];
      if (!m) return true; // metadata not loaded yet; do not hide everything
      if (facetElement && m.element !== facetElement) return false;
      if (facetRarity && m.rarity !== facetRarity) return false;
      if (facetWeapon && m.weapon !== facetWeapon) return false;
      return true;
    },
    [meta, facetElement, facetRarity, facetWeapon]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (charId && r.id !== charId) return false;
      if (!passesFacets(r.id)) return false;
      if (onlyPending && perChar[r.id]?.review === 0) return false;
      if (filter !== 'all') {
        const v = verdictOf(r);
        if (filter === 'on' && v !== 'on') return false;
        if (filter === 'review' && v !== 'review') return false;
        if (filter === 'off' && v !== 'no' && v !== 'off') return false;
      }
      if (!needle) return true;
      return (
        r.id.includes(needle) ||
        String(names[r.id] || '').toLowerCase().includes(needle) ||
        String(r.name || '').toLowerCase().includes(needle) ||
        String(r.text || '').toLowerCase().includes(needle) ||
        String(r.slot).includes(needle)
      );
    });
  }, [rows, q, filter, charId, names, onlyPending, perChar, passesFacets]);

  /** The characters the rail offers, most-pending first, facets applied. */
  const pickerChars = useMemo(
    () =>
      Object.entries(perChar)
        .filter(([id]) => passesFacets(id))
        .sort((a, b) => {
          // Most to review first, then most enabled, then by name -- the list reads
          // as "what still needs me", not as an arbitrary id ordering.
          if (b[1].review !== a[1].review) return b[1].review - a[1].review;
          if (b[1].on !== a[1].on) return b[1].on - a[1].on;
          return String(a[1].name).localeCompare(String(b[1].name), 'zh');
        })
        .map(([id, v]) => ({ id, ...v })),
    [perChar, passesFacets]
  );

  const counts = useMemo(() => {
    const s = { chars: Object.keys(chars).length, total: rows.length, on: 0, review: 0 };
    for (const r of rows) {
      if (r.damage === true) s.on++;
      if (r.needsReview) s.review++;
    }
    return s;
  }, [rows, chars]);
  /** Apply one edit to one row. Editing IS verifying -- a person looked. */
  const patch = useCallback((id, slot, changes) => {
    setDoc((d) => ({
      ...d,
      characters: {
        ...d.characters,
        [id]: {
          ...d.characters[id],
          [slot]: { ...d.characters[id][slot], ...changes, verified: true },
        },
      },
    }));
  }, []);

  return { doc, err, names, meta, rows, visible, perChar, pickerChars, counts, patch };
}
