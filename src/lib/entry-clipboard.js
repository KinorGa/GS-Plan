// Copying and pasting whole AXIS ENTRIES, through the real system clipboard.
//
// A DIFFERENT PROBLEM FROM `buff-clipboard.js`, which transfers dropped buff
// CARDS between two rows inside one page and therefore keeps them in module state.
// This one has to survive leaving the app -- paste into a chat message, or into
// another browser tab -- so it goes through the OS clipboard.
//
// WHY THE `copy`/`paste` EVENTS AND NOT `navigator.clipboard`.
//   `writeText` works, but `readText` is gated behind the `clipboard-read`
//   permission, which is refused by default and has no prompt a page can show. A
//   previous feature in this app was broken for exactly that reason while every
//   automated test passed, because the harness granted the permission up front.
//   The `copy` and `paste` events carry their own `clipboardData` and need no
//   permission at all -- the user's own keystroke is the grant.
//
// WHY A CUSTOM MIME TYPE.
//   `text/plain` is written too, so pasting into a spreadsheet or a chat message
//   gives something readable. But a paste back into this app must be LOSSLESS --
//   the entry's drops, its stat overrides, its pinned part, its crit mode -- and
//   text cannot carry that faithfully. So the same payload also goes out as
//   `application/x-lunaris-entries` JSON, and the paste handler prefers it. This is
//   the same trick the buff-card drag already uses with `application/x-buff-item`.

/** The custom MIME type carrying a lossless entry payload. */
export const ENTRY_MIME = 'application/x-lunaris-entries';

/** Marks the JSON so a future format change can be detected rather than guessed. */
const PAYLOAD_KIND = 'lunaris-entries';
const PAYLOAD_VERSION = 1;

/**
 * What a copied entry carries.
 *
 * THE FIELDS ARE LISTED EXPLICITLY, not spread from the entry. An entry object
 * also holds `expanded` -- a property of the moment, and restoring it would paste
 * rows open that the user never opened -- and any future internal field should be
 * a deliberate addition here rather than something that leaks into the clipboard.
 */
function entryPayload(e) {
  /**
   * A LOOP GOES OUT AS A LOOP.
   *
   * Without this branch a loop was written as an ordinary entry: it has no `charId`
   * and no `summary`, so the payload said `charId: 'none'` with nothing in it, and
   * the reader -- which needs a character to build a row -- discarded it. Copying a
   * loop therefore pasted NOTHING, silently, which is the worst way for it to fail.
   *
   * Its members go through this same function, so a member that is itself a compound
   * row still carries its parts, and a loop cannot be nested (the store refuses it)
   * so this branch never recurses into another loop.
   */
  if (e.kind === 'segment') {
    return {
      kind: 'segment',
      name: String(e.name || ''),
      children: (e.children || []).map(entryPayload),
    };
  }

  return {
    charId: e.charId || 'none',
    sourceKey: e.summary?.sourceKey ?? e.picked?.sourceKey ?? null,
    stageIndex: e.summary?.stageIndex ?? e.picked?.stageIndex ?? null,
    // The stored summary, so the pasted row shows its number immediately instead
    // of waiting for a card to mount and report. Without it a paste into a fresh
    // page renders every figure as `—` until something recomputes.
    summary: e.summary || null,
    critMode: e.critMode || null,
    reactionKey: e.reactionKey || null,
    element: e.element || null,
    statOverrides: e.statOverrides || {},
    // The user's own text. Carried so COPYING a row does not quietly drop the
    // one thing on it that no formula can rebuild.
    note: e.note || '',
    drops: (e.drops || []).map((d) => ({
      source: { ...(d.source || {}) },
      buffs: (d.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
    })),
    // The parts of a compound row, with their own drops and overrides -- a child
    // is an ordinary entry that happens to sit under a parent, so it round-trips
    // the same way.
    //
    // NO COMPUTED VALUE IS CARRIED, and there is none to carry: a part's damage is
    // derived by `lib/axis-compute.js` from the data below, on every render, and
    // never stored. An earlier version copied a cached `figure` and it made a pasted
    // compound row show the same number for both halves -- the cache held the
    // `partIndex` it had been computed for, while the child's own index was derived
    // from its new position. Deriving instead of copying removes the whole class of
    // problem, which is why the cache was deleted rather than carefully transported.
    children: Array.isArray(e.children)
      ? e.children.map((c) => ({
        partIndex: c.partIndex,
        element: c.element || null,
        critMode: c.critMode || null,
        reactionKey: c.reactionKey || null,
        statOverrides: c.statOverrides || {},
        note: c.note || '',
        drops: (c.drops || []).map((d) => ({
          source: { ...(d.source || {}) },
          buffs: (d.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
        })),
      }))
      : undefined,
  };
}

/** The payload as JSON for the custom MIME type. */
export function entriesToJson(entries) {
  return JSON.stringify({
    kind: PAYLOAD_KIND,
    version: PAYLOAD_VERSION,
    entries: (entries || []).map(entryPayload),
  });
}

/**
 * The payload as READABLE text, for anything outside this app.
 *
 * One line per entry: the source, its stage, and the damage it deals. Not a
 * faithful representation -- that is what the JSON is for -- but a person pasting
 * into a document wants to see what they copied, and a wall of JSON is not that.
 */
export function entriesToText(entries, L) {
  const lines = [];
  for (const e of entries || []) {
    const name = e.summary?.sourceLabel
      ? (L ? L(e.summary.sourceLabel) : (e.summary.sourceLabel.chs || e.summary.sourceKey))
      : (e.summary?.sourceKey || '?');
    const stage = e.summary?.stage ? (L ? L(e.summary.stage) : e.summary.stage.chs) : '';
    const n = Number(e.summary?.total ?? e.summary?.perHit);
    const dmg = Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '';
    lines.push([name, stage, dmg].filter(Boolean).join('\t'));
  }
  return lines.join('\n');
}

/**
 * Read a pasted payload back into entries.
 *
 * Returns `null` when the text is not ours, so the caller can leave the paste
 * alone rather than swallowing it -- pasting ordinary text into the page must keep
 * working.
 *
 * Ids are NOT taken from the payload: an id identifies an entry within this axis,
 * and reusing the copied one would collide with an entry already here. The caller
 * assigns fresh ones.
 */
export function parseEntriesJson(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.kind !== PAYLOAD_KIND || !Array.isArray(data.entries)) return null;

  return data.entries.map((e) => {
    // A LOOP REBUILDS RECURSIVELY. Its members are ordinary entries, so they go
    // through this same mapping -- and the ids are left to the paste, which scopes
    // every level to the loop's own new id.
    if (e.kind === 'segment') {
      return {
        kind: 'segment',
        name: String(e.name || ''),
        children: (e.children || []).map(readEntry),
      };
    }
    return readEntry(e);
  });
}

/**
 * One ordinary entry from a payload.
 *
 * Split out of the mapper above so a loop's members can be read by the SAME code
 * rather than by a second copy -- the whole class of bug this file keeps meeting is
 * two lists of fields drifting apart.
 */
function readEntry(e) {
  return {
    charId: e.charId || 'none',
    summary: e.summary || null,
    // The picker is seeded from `picked` before a card has reported, so a pasted
    // row shows the right skill on its first paint rather than the default.
    picked: e.sourceKey != null ? { sourceKey: e.sourceKey, stageIndex: e.stageIndex } : null,
    critMode: e.critMode || null,
    reactionKey: e.reactionKey || null,
    element: e.element || null,
    statOverrides: e.statOverrides || {},
    // The user's own text. Carried so COPYING a row does not quietly drop the
    // one thing on it that no formula can rebuild.
    note: e.note || '',
    drops: (e.drops || []).map((d) => ({
      source: { ...(d.source || {}) },
      buffs: (d.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
    })),
    children: Array.isArray(e.children)
      ? e.children.map((c) => ({
        // AN ID IS REQUIRED, and its absence was a real bug. Anything that
        // addresses a child -- a card reporting, the dedupe in `repairChildren` --
        // needs one, and `repairChildren` only supplies it on LOAD, long after the
        // paste. Two pasted children with no id were indistinguishable, so whichever
        // one was written last won and both halves showed the same number.
        //
        // `partIndex` is unique within a row by construction -- `repairChildren`
        // rejects a duplicate -- so this is stable inside the entry.
        id: `part${c.partIndex}`,
        partIndex: c.partIndex,
        element: c.element || null,
        critMode: c.critMode || null,
        reactionKey: c.reactionKey || null,
        statOverrides: c.statOverrides || {},
        note: c.note || '',
        drops: (c.drops || []).map((d) => ({
          source: { ...(d.source || {}) },
          buffs: (d.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
        })),
      }))
      : undefined,
    expanded: false,
  };
}
