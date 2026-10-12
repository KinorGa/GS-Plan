// The buff library: what every source in the game actually grants.
//
// WHY THIS EXISTS SEPARATELY FROM THE TEAM
//   A team document says WHICH sources are in play (this weapon, this set, these
//   constellations). It cannot say what they DO, because:
//
//     - upstream publishes prose descriptions and opaque `params` arrays, not
//       stat tables. Verified: a weapon carries no stat table at all, and an
//       artifact's `params` are unlabelled floats.
//     - the same weapon on two different teams grants the same buffs, so the
//       values belong to the WEAPON, not to the team wearing it.
//
//   So the library is keyed by the source's OWN identity (a weapon id, a set id
//   plus 2/4, a character id plus a slot) and lives independently of any team.
//   Edit a weapon once and every team using it sees the edit.
//
// KEYED BY ID, NOT BY NAME
//   Names change between languages and are not unique (several characters have a
//   talent called the same thing). Ids are stable, so an edit made today still
//   applies after a data refresh that renames things.
//
// WHAT IS STORED
//   `{ [sourceKey]: [{ key, value, tag }] }` -- the buff list for that source,
//   in the same shape `BuffCard` and `foldBuffs` already consume. Nothing is
//   derived here; a source with no entry simply has no buffs yet.
//
//   The library is DENSE BY EXCEPTION: 2078 sources exist and only the ones a
//   human has filled in are stored, so the saved object stays small.

import { createPromiseCache, fetchJson } from './json-cache';
import { isPlaceholderChar } from './catalogue';

/** Bumped only when a change would break an older reader. */
export const LIBRARY_VERSION = 2;

/** The refinements a weapon can be at, in order. */
export const REFINE_RANKS = [1, 2, 3, 4, 5];

/**
 * The identity of a source, as a stable string.
 *
 * Deliberately NOT the same as `buff-sources.js`'s per-unit `sourceId`: that one
 * includes the unit (`u1:weapon`) because two units carrying the same weapon are
 * two pool entries. The LIBRARY entry is shared, so it is keyed by the thing
 * itself -- `weapon:11515`, `artifact:15044:2`, `talent:10000128:p1`.
 *
 * WHY A WEAPON ALSO CARRIES ITS REFINEMENT
 *   A weapon's passive scales with refinement: R1 grants +20% ATK where R5 grants
 *   +40%. Those are different numbers for the same weapon, so they are different
 *   library entries -- `weapon:11515:r1` .. `weapon:11515:r5`. A single entry per
 *   weapon could only ever be right at one refinement.
 *
 *   No other kind needs a rank dimension. An artifact set bonus is fixed; each
 *   constellation is already its own source (`c1`..`c6`); a talent's LEVEL scales
 *   its damage multipliers, which are the damage card's input rather than a buff
 *   value.
 *
 * @param {object} ref  `{ kind, id, slot }`
 */
export const sourceKey = ({ kind, id, slot }) =>
  [kind, id, slot].filter((p) => p !== undefined && p !== null && p !== '').join(':');

/** The library key for one weapon at one refinement. */
export const weaponKey = (id, refine = 1) =>
  sourceKey({ kind: 'weapon', id, slot: `r${clampRefine(refine)}` });

/** A refinement number inside 1..5, defaulting to 1 for anything unusable. */
export const clampRefine = (n) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 1;
};

/** Parse a key back into its parts, for display and for lookup. */
export function parseSourceKey(key) {
  const [kind, id, slot] = String(key).split(':');
  return { kind, id, slot: slot || null };
}

/* ------------------------------------------------------------------ storage */

const STORAGE_KEY = 'lunaris-buff-library';

let cache = null;

/**
 * Drop the in-memory copy, so the next `loadLibrary` re-reads storage.
 *
 * Needed because the durable FILE is read asynchronously at startup: without this the
 * pages would already be holding the cache's copy, and the file -- the one that
 * survives a cleared cache, and so the one more likely to be current -- would be
 * overwritten by it on the next edit. The same reason `buff-flags` has one.
 */
export function invalidateLibrary() {
  cache = null;
}

/**
 * The whole library, or an empty one when nothing is stored yet.
 *
 * A MIGRATION IS WRITTEN BACK. `normaliseLibrary` brings an older key shape up to
 * date (a v1 weapon key carried no refinement), but normalising in memory alone
 * leaves `localStorage` holding the old form: a reload re-migrates identically,
 * yet an EXPORT would emit the stale version, and any other reader of the same
 * key would still see keys the rest of the app no longer looks up.
 */
export function loadLibrary() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = { version: LIBRARY_VERSION, entries: {} };
      return cache;
    }
    const parsed = JSON.parse(raw);
    const normalised = normaliseLibrary(parsed);
    cache = normalised;
    // Only rewrite when something actually changed, so visiting a page does not
    // touch storage every time.
    if (parsed?.version !== normalised.version) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalised));
      } catch {
        // Quota or private mode: the migrated copy still works in memory.
      }
    }
  } catch {
    // A corrupt value must not blank the page: this runs during render.
    cache = { version: LIBRARY_VERSION, entries: {} };
  }
  return cache;
}

/** Persist a library, and keep the in-memory copy in step. */
export function saveLibrary(next) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private mode: the edit still applies for this session.
  }
  return next;
}

/**
 * Every field defaulted, and unknown keys preserved.
 *
 * A file written by a newer version should survive a round trip rather than
 * being silently stripped, the same rule the team document follows.
 */
export function normaliseLibrary(raw) {
  const entries = {};
  for (const [rawKey, v] of Object.entries(raw?.entries || {})) {
    if (!Array.isArray(v)) continue;

    // MIGRATION v1 -> v2. A v1 library keyed weapons without a refinement
    // (`weapon:11515`). Those entries move to R1, which is what they were
    // recorded against by default, rather than being dropped -- losing a
    // human's transcribed numbers to a schema change would be the worst
    // possible outcome of this edit.
    const key = migrateKey(rawKey);

    const buffs = v
      .map((b) => ({
        key: String(b?.key || '').trim(),
        value: b?.value ?? 0,
        tag: b?.tag ?? '',
      }))
      // A buff with no stat key is not a buff; dropping it silently is better
      // than rendering a nameless row.
      .filter((b) => b.key);

    // Two v1 weapons could not collide, but a migration could in principle
    // produce a duplicate key; the first one recorded wins rather than being
    // silently overwritten.
    if (buffs.length && !entries[key]) entries[key] = buffs;
  }
  return { ...raw, version: LIBRARY_VERSION, entries };
}

/** Bring an older key shape up to the current one. */
function migrateKey(key) {
  const { kind, id, slot } = parseSourceKey(key);
  // `weapon:11515` -> `weapon:11515:r1`
  if (kind === 'weapon' && !slot) return weaponKey(id, 1);
  return key;
}

/** The buffs recorded for one source, or an empty list. */
export const buffsFor = (library, key) => (key ? library?.entries?.[key] || [] : []);

/**
 * Set one source's buffs.
 *
 * An EMPTY list removes the entry rather than storing `[]`, so the saved object
 * records only what a human actually filled in.
 */
export function setBuffs(library, key, buffs) {
  const entries = { ...library.entries };
  if (!buffs || !buffs.length) delete entries[key];
  else entries[key] = buffs;
  return { ...library, entries };
}

/** How many sources have at least one buff, and how many buffs in total. */
export function libraryStats(library) {
  const keys = Object.keys(library?.entries || {});
  let buffs = 0;
  for (const k of keys) buffs += library.entries[k].length;
  return { sources: keys.length, buffs };
}

/* ------------------------------------------------------- import / export --- */

export const serialiseLibrary = (lib) => JSON.stringify(normaliseLibrary(lib), null, 2);

export function parseLibrary(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('expected an object at the top level');
  if (raw.entries && typeof raw.entries !== 'object') throw new Error('"entries" must be an object');
  return normaliseLibrary(raw);
}

/* ------------------------------------------------------------- the index --- */

/** The built index, per language. See `loadSourceIndex`. */
const indexCache = createPromiseCache();

/**
 * Every source that exists in the game, for the editor to list.
 *
 * 2078 entries across weapons, artifact sets, and every character's talents,
 * passives and constellations. Built on demand rather than at startup: it needs
 * the whole weapon list, the whole artifact list and 138 detail files, which is
 * far too much to load before the planner can render.
 *
 * A source carries a `desc` (the upstream prose) but no `buffs` -- the editor
 * shows the description beside the fields so a human has something to read while
 * deciding the numbers.
 */
export function loadSourceIndex(lang = 'chs') {
  return indexCache.get(lang, async () => {
    const [chars, weapons, artifacts] = await Promise.all([
      fetchJson('/data/charlist.json'),
      fetchJson('/data/weaponlist.json'),
      fetchJson('/data/artifactlist.json'),
    ]);
    if (!chars || !weapons || !artifacts) {
      throw new Error('cannot load the catalogues');
    }

    const out = [];

    // --- weapons, one row per REFINEMENT -----------------------------------
    // A weapon's passive scales with refinement, so R1 and R5 are separate
    // entries to fill in. Emitting one row per weapon would let a human record
    // only one refinement's numbers with no way to say which.
    for (const [id, w] of Object.entries(weapons)) {
      for (const r of REFINE_RANKS) {
        out.push({
          key: weaponKey(id, r),
          kind: 'weapon',
          id,
          slot: `r${r}`,
          refine: r,
          name: { chs: w.chsName, en: w.enName },
          icon: w.weaponIcon,
          iconKind: 'weapon',
          rank: `R${r}`,
          owner: null,
          desc: null,
        });
      }
    }

    // --- artifact sets, 2-pc and 4-pc --------------------------------------
    // All 66 detail files at once rather than one per iteration: a sequential
    // await inside this loop made the whole index wait on 66 round trips.
    const setIds = Object.keys(artifacts);
    const setDetails = await Promise.all(
      setIds.map((id) => fetchJson(`/data/artifact/${lang}/${id}.json`))
    );
    setIds.forEach((id, i) => {
      const a = artifacts[id];
      const bonuses = setDetails[i]?.info?.setBonuses || null;
      for (const pieces of [2, 4]) {
        const desc = bonuses?.[`${pieces}pc`]?.description || null;
        // A set with no bonus text is a placeholder entry (set 15000), and a
        // 2-pc/4-pc row for it would be an empty row nobody can act on.
        if (!desc) continue;
        out.push({
          key: sourceKey({ kind: 'artifact', id, slot: pieces }),
          kind: 'artifact',
          id,
          slot: String(pieces),
          name: {
            chs: `${a.chsName} · ${pieces}件套`,
            en: `${a.enName} ${pieces}-Pc`,
          },
          icon: a.setIcon,
          iconKind: 'artifact',
          rank: `${pieces}pc`,
          owner: null,
          desc,
        });
      }
    });

    // --- every character's talents, passives and constellations ------------
    // The two 奇偶 placeholders are skipped at the source, by the same rule the
    // catalogue uses. Indexing them would put six fillable rows in the editor
    // for a character no player can select, which reads as a bug in the data.
    const charIds = Object.keys(chars).filter((id) => !isPlaceholderChar(chars[id]));
    const charDetails = await Promise.all(
      charIds.map((id) => fetchJson(`/data/char/${lang}/${id}.json`))
    );
    charIds.forEach((charId, i) => {
      const c = chars[charId];
      const detail = charDetails[i];
      if (!detail) return;

      const owner = { id: charId, name: `${c.chsName} / ${c.enName}`, element: c.element };

      const SKILLS = [
        ['normalattack', 'normal'],
        ['elementalskill', 'skill'],
        ['elementalburst', 'burst'],
      ];
      for (const [field, kind] of SKILLS) {
        const s = detail.skills?.[field];
        if (!s) continue;
        out.push({
          key: sourceKey({ kind: 'talent', id: charId, slot: kind }),
          kind: 'talent',
          id: charId,
          slot: kind,
          name: { chs: s.name, en: s.name },
          icon: s.icon,
          iconKind: 'skill',
          rank: '',
          owner,
          desc: s.description || null,
        });
      }

      for (const key of Object.keys(detail.passives || {}).sort()) {
        const p = detail.passives[key];
        if (!p || !(p.name || p.icon)) continue;
        out.push({
          key: sourceKey({ kind: 'talent', id: charId, slot: key }),
          kind: 'talent',
          id: charId,
          slot: key,
          name: { chs: p.name, en: p.name },
          icon: p.icon,
          iconKind: 'talent',
          rank: '',
          owner,
          desc: p.description || null,
        });
      }

      for (let n = 1; n <= 6; n++) {
        const con = detail.constellations?.[`const${n}`];
        if (!con) continue;
        out.push({
          key: sourceKey({ kind: 'constellation', id: charId, slot: `c${n}` }),
          kind: 'constellation',
          id: charId,
          slot: `c${n}`,
          name: { chs: con.name, en: con.name },
          icon: con.icon,
          iconKind: 'talent',
          rank: `C${n}`,
          owner,
          desc: con.description || null,
        });
      }
    });

    return out;
  });
}

/** Discard the index so the next load refetches. Used by the editor's retry. */
export const invalidateSourceIndex = () => indexCache.invalidate();
