// An in-page clipboard for buff cards.
//
// WHY NOT THE REAL CLIPBOARD
//   Copying to the OS clipboard works, but READING it back does not:
//   `navigator.clipboard.readText()` is gated behind the `clipboard-read`
//   permission, which is refused by default and whose prompt most browsers never
//   show for a page like this. Every workaround tried -- reading it from the
//   button, listening for a `paste` event on it, listening on the document --
//   either needed that permission or depended on where focus happened to be. The
//   feature has to work when the user clicks a button, full stop.
//
//   So the ROUND TRIP does not go through the OS at all. 复制 stashes the cards
//   here, 粘贴 reads them back, and the copy is 1:1 by construction because it is
//   the same data. The plain-text form is still PRODUCED and can still be pasted
//   elsewhere by hand; it is simply not the transport.
//
// CARDS, NOT A FLAT BUFF LIST
//   The stash holds one entry per SOURCE CARD, not one merged list. The first
//   version flattened every buff into a single group, so pasting produced one card
//   reading "粘贴的增益" holding eleven rows -- the data was exact, but it did not
//   look like what was copied, and the source's own grouping (which weapon, which
//   artifact set) was lost. A paste should reproduce the row, not just its numbers.
//
// IN MEMORY, PER PAGE LOAD
//   Deliberately not persisted: this is a transfer between two rows of the same
//   rotation, not a document. Surviving a refresh would raise questions the user
//   does not need -- is it stale, whose is it, why is it still here -- and the
//   config export already covers keeping things across sessions.

const listeners = new Set();

let stash = null; // { cards: Array<{ source, buffs }> }

function emit() {
  for (const fn of listeners) fn(stash);
}

/** Subscribe to stash changes; returns an unsubscribe. */
export function subscribeClipboard(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The current stash, or null. */
export function readClipboard() {
  return stash;
}

/** Total buff rows across every stashed card. */
export function clipboardRowCount(s = stash) {
  return (s?.cards || []).reduce((n, c) => n + (c.buffs?.length || 0), 0);
}

/**
 * Put a set of cards in the stash.
 *
 * COPIED FIELD BY FIELD rather than by reference: these belong to the entry they
 * came from, and a later edit there must not silently change what a paste
 * produces.
 */
export function writeClipboard(cards) {
  stash = {
    cards: (cards || []).map((c) => ({
      source: { ...(c.source || {}) },
      buffs: (c.buffs || []).map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
    })),
  };
  emit();
  return stash;
}
