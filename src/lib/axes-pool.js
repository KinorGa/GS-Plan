// The pools: one copy of each repeated piece of a configuration, referenced by
// index from every place that uses it.
//
// WHY THIS EXISTS
//   An axis repeats itself. The imported 400-row rotation held 5903 drops but
//   only 20 DISTINCT source descriptors, and 9082 buff objects but only 47
//   distinct `{key,value,tag}` triples. Written out in full the file was 6.27 MB
//   and the repeats were the overwhelming majority of it -- slow to write on
//   every keystroke, easy to blow the `localStorage` quota with, and unreadable
//   to a person trying to see what a rotation actually does.
//
// WHAT IS POOLED
//   sources        `drop.source`          -> `drop.sourceRef`        (index)
//   buffs          `drop.buffs`           -> `drop.buffRefs`         (indices)
//   sourceLabels   `summary.sourceLabel`  -> `summary.sourceLabelRef`
//
//   All three are DESCRIPTORS: they say where a number came from, and nothing
//   about them changes once a row exists. A row's own identity -- its id, its
//   `statOverrides`, its `critMode`, its note -- stays inline and unshared,
//   which is what lets two rows be edited apart.
//
// THE KEY IS THE WHOLE OBJECT
//   A source is pooled by `JSON.stringify(source)`, a buff by
//   `JSON.stringify(buff)`, a label by `JSON.stringify(label)`.
//
//   THE VALUE IS PART OF A BUFF'S IDENTITY, not just its key. `atkPct = 25` and
//   `atkPct = 18` are DIFFERENT buffs. Pooling by `key` alone would have merged
//   them -- 16 entries instead of the true 47 in the imported rotation -- and
//   silently handed a row a number it never had, which is a wrong damage figure
//   rather than a cosmetic difference. The same argument covers `tag`.
//
//   Stringifying the whole object also keeps a number and a string apart: `15`
//   and `"15"` are different values and must not share an entry. The imported
//   files carry numbers and the hand-built ones carry strings, so the two DO
//   meet as soon as both are in one configuration.
//
// THE POOL GROWS AT THE END
//   Entries are kept in first-appearance order, so adding a row only appends and
//   editing one row leaves the rest of the file's lines where they were -- which
//   matters for a file that is meant to be diffed and hand-edited.
//
// WHERE THIS IS USED
//   ONLY at the file boundary: `saveAxes` / `loadAxes` (localStorage), the
//   export and import in `config-file.js`, and the importer's own output.
//
//   In memory a drop keeps its own `source` and its own `buffs` ARRAY -- the
//   shape it has always had -- so every reader and every editor is left alone,
//   and two rows still never share an object one of them could write through.
//   `unpackAxes` CLONES what it hands back for exactly that reason: without the
//   clone, a pool would quietly turn "these two rows have the same value" into
//   "these two rows are the same row", and editing one would move the other.

/** Clone without sharing, so nothing can be written through a pool entry. */
const clone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v)
  : JSON.parse(JSON.stringify(v)));

/** The index `value` already has in a pool, or a fresh one appended for it. */
function intern(list, index, value) {
  const key = JSON.stringify(value);
  const found = index.get(key);
  if (found !== undefined) return found;
  const at = list.length;
  list.push(value);
  index.set(key, at);
  return at;
}

/**
 * Every descriptor replaced by an index into a pool on the root.
 *
 * The replacement keeps the ORIGINAL KEY POSITION (`source` sits where it sat,
 * renamed), so the rewritten row still reads in the same order as the file it
 * came from.
 */
export function packAxes(state) {
  const sources = []; const sourceIndex = new Map();
  const buffs = []; const buffIndex = new Map();
  const labels = []; const labelIndex = new Map();

  const packDrop = (d) => {
    if (!d || typeof d !== 'object') return d;
    const out = {};
    for (const k of Object.keys(d)) {
      if (k === 'source') out.sourceRef = intern(sources, sourceIndex, d.source);
      else if (k === 'buffs') out.buffRefs = (d.buffs || []).map((b) => intern(buffs, buffIndex, b));
      else out[k] = d[k];
    }
    return out;
  };

  const packSummary = (s) => {
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const k of Object.keys(s)) {
      if (k === 'sourceLabel') out.sourceLabelRef = intern(labels, labelIndex, s.sourceLabel);
      else out[k] = s[k];
    }
    return out;
  };

  // One walker for both kinds of `children`: a segment's members are ordinary
  // entries, and a talent row's parts carry drops too. Neither nests deeper.
  const packEntry = (e) => {
    if (!e || typeof e !== 'object') return e;
    const out = { ...e };
    if (Array.isArray(e.drops)) out.drops = e.drops.map(packDrop);
    if (e.summary) out.summary = packSummary(e.summary);
    if (Array.isArray(e.children)) out.children = e.children.map(packEntry);
    return out;
  };

  const axes = (state?.axes || []).map((a) => ({ ...a, entries: (a?.entries || []).map(packEntry) }));

  const pools = {};
  if (sources.length) pools.sources = sources;
  if (buffs.length) pools.buffs = buffs;
  if (labels.length) pools.sourceLabels = labels;

  const out = { ...state, axes };
  delete out.pools;
  // No pools at all is the honest shape for a configuration with nothing in it,
  // so an empty file does not carry three empty arrays saying nothing.
  if (Object.keys(pools).length) out.pools = pools;
  return out;
}

/**
 * Pools expanded back into the inline descriptors the app works with.
 *
 * TOLERANT ON PURPOSE: a file written before the pools existed has no `pools`
 * and is returned untouched, and a row that still carries an inline `source`
 * beside a pooled one keeps it -- so a half-migrated document loads rather than
 * losing the rows it describes.
 */
export function unpackAxes(state) {
  const pools = state?.pools;
  if (!pools || typeof pools !== 'object') return state;

  const sources = Array.isArray(pools.sources) ? pools.sources : [];
  const buffs = Array.isArray(pools.buffs) ? pools.buffs : [];
  const labels = Array.isArray(pools.sourceLabels) ? pools.sourceLabels : [];

  /** A ref that names nothing is DROPPED, not guessed at. */
  const deref = (list, i) => (list[i] === undefined ? null : clone(list[i]));

  const unpackDrop = (d) => {
    if (!d || typeof d !== 'object') return d;
    const out = {};
    for (const k of Object.keys(d)) {
      if (k === 'sourceRef') {
        const s = deref(sources, d.sourceRef);
        // No source means the row cannot be drawn; `normaliseAxes` drops a drop
        // without one, which is the same thing it does to a corrupt inline drop.
        if (s) out.source = s;
      } else if (k === 'buffRefs') {
        out.buffs = (Array.isArray(d.buffRefs) ? d.buffRefs : [])
          .map((i) => deref(buffs, i))
          .filter(Boolean);
      } else out[k] = d[k];
    }
    return out;
  };

  const unpackSummary = (s) => {
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const k of Object.keys(s)) {
      if (k === 'sourceLabelRef') {
        const l = deref(labels, s.sourceLabelRef);
        if (l) out.sourceLabel = l;
      } else out[k] = s[k];
    }
    return out;
  };

  const unpackEntry = (e) => {
    if (!e || typeof e !== 'object') return e;
    const out = { ...e };
    if (Array.isArray(e.drops)) out.drops = e.drops.map(unpackDrop);
    if (e.summary) out.summary = unpackSummary(e.summary);
    if (Array.isArray(e.children)) out.children = e.children.map(unpackEntry);
    return out;
  };

  const out = {
    ...state,
    axes: (state.axes || []).map((a) => ({ ...a, entries: (a?.entries || []).map(unpackEntry) })),
  };
  delete out.pools;
  return out;
}