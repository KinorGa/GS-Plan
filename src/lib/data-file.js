// The app's own data, kept in a FILE.
//
// WHAT THIS REPLACES. The buff library's transcribed numbers and the "is this even a
// buff" marks lived only in `localStorage`. A browser cannot write to disk, so
// clearing the cache -- or switching browser, or moving machine -- destroyed hours of
// hand-typed work with no way back. The numbers had an export button as a partial
// answer; the marks had nothing at all.
//
// `serve.mjs` now exposes `GET`/`PUT /api/data`, and this module is the only thing
// that talks to it. What it keeps is one JSON document:
//
//     { version, library: {...}, flags: {...} }
//
// BOTH IN ONE FILE, because they are the same kind of thing -- a human's work on top
// of the published data -- and two files would mean two things to back up and one of
// them forgotten.
//
// LOCALSTORAGE IS STILL WRITTEN, and that is deliberate rather than leftover. It is
// the fast path: every keystroke in the library updates it synchronously and nothing
// has to wait for a round trip. The file is the durable copy. On load the FILE WINS,
// because it is the one that survives a cache clear and therefore the one more likely
// to be current -- and because the failure this module exists to prevent is the file
// being ignored in favour of a stale cache.
//
// WHEN THE SERVER IS NOT THERE (a `file://` open, a static host, `python -m http.server`)
// every function degrades to localStorage alone. The page must keep working without
// the endpoint; losing durability is a smaller failure than losing the editor.

const API = '/api/data';
const LS_LIBRARY = 'lunaris-buff-library';
const LS_FLAGS = 'lunaris-buff-flags';

/** Whether the endpoint answered. `null` until the first attempt completes. */
let available = null;

/** The document as last read or written, so a save never drops a section. */
let doc = { version: 1, library: null, flags: null };

/**
 * Load the durable copy and mirror it into localStorage.
 *
 * Called once at startup, before the pages read their data. A missing file, a
 * server that does not implement the endpoint, or a malformed body all leave
 * `localStorage` untouched -- the app then behaves exactly as it did before this
 * module existed, which is the correct fallback.
 */
export async function loadDataFile() {
  try {
    const r = await fetch(API, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const parsed = await r.json();
    available = true;

    // A file that holds nothing yet must not wipe what the cache already has: the
    // very first run after this feature ships has a file and a populated cache, and
    // the cache is the one with the work in it.
    const hasLibrary = parsed?.library && typeof parsed.library === 'object';
    const hasFlags = parsed?.flags && typeof parsed.flags === 'object';

    if (hasLibrary) {
      doc.library = parsed.library;
      try { localStorage.setItem(LS_LIBRARY, JSON.stringify(parsed.library)); } catch { /* quota */ }
    }
    if (hasFlags) {
      doc.flags = parsed.flags;
      try { localStorage.setItem(LS_FLAGS, JSON.stringify(parsed.flags)); } catch { /* quota */ }
    }
    return { loaded: true, library: hasLibrary, flags: hasFlags };
  } catch {
    // No endpoint: not an error worth surfacing, just a less durable session.
    available = false;
    return { loaded: false, library: false, flags: false };
  }
}

/**
 * Remember one section and write the whole document.
 *
 * The write is DEBOUNCED. Marking a source, or typing a number, fires many times a
 * second, and a `PUT` per keystroke would be a lot of disk churn for a file that only
 * has to be correct when the user stops. The delay is short enough that a page
 * closed immediately after an edit still saves.
 */
let timer = null;
let pending = null;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 400);
}

/** Write now, if anything is pending. */
export async function flush() {
  if (available === false) return false;
  if (!pending) return true;
  const body = pending;
  pending = null;
  try {
    const r = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    available = r.ok;
    return r.ok;
  } catch {
    available = false;
    return false;
  }
}

function queue() {
  pending = JSON.stringify(doc);
  schedule();
}


/**
 * Let a page that edits the cache directly hand the change over.
 *
 * The library and flags modules already write `localStorage` themselves and are used
 * on both pages, so rather than rewrite them, a page that changes either calls this
 * with the new value. It keeps the document in step without those modules needing to
 * know a server exists.
 */
export function noteChange(part, value) {
  if (part === 'library') doc.library = value;
  if (part === 'flags') doc.flags = value;
  queue();
}

// A page closed mid-debounce should still save. `sendBeacon` is the only request a
// browser will finish during unload, and it is a POST -- so the endpoint accepts one
// as a synonym for PUT rather than losing the last edit.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!pending || available === false) return;
    try {
      navigator.sendBeacon(API, new Blob([pending], { type: 'application/json' }));
    } catch { /* nothing more can be done during unload */ }
  });
}
