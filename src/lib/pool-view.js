// Where the buff pool was left: which mode, which instance's bindings were open,
// whether the template picker was showing, and what was typed in the finder.
//
// WHY THIS IS PERSISTED AT ALL
//   A refresh used to drop the pool back to 模板 with everything closed, so a
//   session spent binding one instance to fifty rows had to be re-opened by hand
//   every reload. The rest of the app already behaves the other way: an entry's
//   `expanded` flag is part of the saved axis, so the rows you had open come back
//   open. View state that survives is the norm here rather than the exception,
//   and the pool was the one place that disagreed.
//
// WHAT IS NOT HERE
//   Bindings and instance values are NOT view state and are not in this file.
//   An instance lives in `buff-instances.js`; a binding is a drop on an entry and
//   travels with the axis. This module holds only what the POOL is looking at --
//   losing it costs a click, losing the other two would cost work.
//
// IT IS STILL ONLY A HINT. Everything read back is validated: an unknown mode
// falls to 模板, a `bindOpen` naming an instance that no longer exists simply
// matches nothing, and a corrupt entry yields the defaults rather than an error.
// A stored preference must never be able to break the panel it describes.

import { useEffect, useState } from 'react';

/** The key this view state lives under, beside the axes and the library. */
export const POOL_VIEW_STORAGE_KEY = 'lunaris-buff-pool-view';

/** The pool with nothing remembered: template mode, everything closed. */
export const DEFAULT_POOL_VIEW = {
  mode: 'template',
  bindOpen: null,
  picking: false,
  needle: '',
};

/** Read the view back, repairing anything unusable. Never throws. */
export function loadPoolView() {
  try {
    const raw = JSON.parse(localStorage.getItem(POOL_VIEW_STORAGE_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_POOL_VIEW };
    return {
      // `instance` is the only other mode, and an unknown string is not a mode.
      mode: raw.mode === 'instance' ? 'instance' : 'template',
      bindOpen: typeof raw.bindOpen === 'string' && raw.bindOpen ? raw.bindOpen : null,
      picking: raw.picking === true,
      needle: typeof raw.needle === 'string' ? raw.needle : '',
    };
  } catch {
    return { ...DEFAULT_POOL_VIEW };
  }
}

/** Persist. A blocked or full store costs the convenience, not the session. */
export function savePoolView(view) {
  try {
    localStorage.setItem(POOL_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* Private mode or quota: the pool still works, it just forgets. */
  }
}

/**
 * The pool's view, remembered across reloads.
 *
 * Returns `[view, patch]` rather than a setter per field: the fields are one
 * thing -- where the user was -- and four `useState`s that must be written back
 * together is how one of them ends up not persisted.
 */
export function usePoolView() {
  const [view, setView] = useState(() => loadPoolView());

  useEffect(() => {
    savePoolView(view);
  }, [view]);

  const patch = (next) => setView((v) => ({ ...v, ...next }));

  return [view, patch];
}
