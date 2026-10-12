// Shared JSON fetching for the local dataset.
//
// The static server answers an unknown path with `index.html` and a 200 (SPA
// fallback), so a 200 does NOT imply JSON -- `r.json()` on that response throws
// "Unexpected token '<'". Every loader in this repo therefore has to check the
// content type, and the artifact, catalogue and character-detail loaders had
// each grown their own copy of that check.

/**
 * Fetch a dataset file and parse it as JSON.
 *
 * @param   {string} url
 * @returns {Promise<any|null>} The parsed body, or `null` when the path did not
 *          yield JSON at all. `null` rather than a throw, so a caller that can
 *          tolerate a missing optional file does not have to catch.
 */
export async function fetchJson(url) {
  const r = await fetch(url);
  const type = r.headers.get('content-type') || '';
  return r.ok && type.includes('json') ? r.json() : null;
}

/** As `fetchJson`, but a missing file is an error the caller can report. */
export async function fetchJsonOrThrow(url) {
  const r = await fetch(url);
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.includes('json')) {
    throw new Error(`cannot load ${url} (HTTP ${r.status})`);
  }
  return r.json();
}

/**
 * A promise cache, for loaders that share one request across many components.
 *
 * Caches the PROMISE, not the resolved value, so concurrent callers join a
 * single in-flight request instead of racing. That distinction is the whole
 * point: the builder and the artifact row each mount a card per row, and
 * without it every card re-requests the same hundreds of kilobytes.
 *
 * A rejected promise is never retained. Holding one is the subtle version of
 * this bug -- the first caller reports the error correctly, and every later
 * caller is handed the same already-rejected promise, so one transient blip
 * leaves the component permanently broken with a reload as the only way out.
 *
 * @param {() => Promise<any>} load
 * @returns {{ get: (key: string, load: () => Promise<any>) => Promise<any>,
 *             invalidate: (key?: string) => void }}
 */
export function createPromiseCache() {
  /** @type {Map<string, Promise<any>>} */
  const entries = new Map();

  return {
    get(key, load) {
      const hit = entries.get(key);
      if (hit) return hit;

      const p = load().catch((e) => {
        // Only drop our own entry: a later load may already have replaced it.
        if (entries.get(key) === p) entries.delete(key);
        throw e;
      });
      entries.set(key, p);
      return p;
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
