// Group computed damage parts into the series the axis summary draws.
//
// A SEGMENT is one talent stage of one source: `sourceKey + stageIndex`. An
// OCCURRENCE is one axis entry: the same entry may contribute several parts (the
// two halves of 四风将起, for example), and those parts stack inside one bar.
//
// WHY THIS IS PURE. The summary already receives every part from `computeAxis`;
// grouping must not become a second damage calculation. This module only sorts
// and nests those numbers, so the histogram cannot disagree with the rows above.

/**
 * @param {Array} parts    Parts shaped by AxisSummary: amount, entryId, order,
 *                         partIndex, sourceKey, stageIndex, stageName, element.
 * @param {Array} catalog  Every stage of every source the character uses, even
 *                         when the current axis has no row for it. This keeps the
 *                         selector independent of the configuration: a stage with
 *                         no cast is still a valid choice, not a missing option.
 * @returns {Array} Groups in catalogue order (or first-seen order for a source
 *                  absent from the catalogue), each with ordered occurrences.
 */
export function groupDamageSegments(parts, catalog = []) {
  const groups = new Map();

  const keyOf = (sourceKey, stageIndex, stageName) => {
    const stageKey = stageIndex == null
      ? `name:${stageName || 'unknown'}`
      : `index:${stageIndex}`;
    return `${sourceKey || 'unknown'}|${stageKey}`;
  };

  // Seed the full vocabulary first. A later part fills the group; a stage the
  // rotation never used remains with total 0 and no occurrences.
  for (const stage of catalog || []) {
    const key = keyOf(stage.sourceKey, stage.stageIndex, stage.stageName);
    if (groups.has(key)) continue;
    groups.set(key, {
      key,
      sourceKey: stage.sourceKey || 'unknown',
      source: stage.source || null,
      stageIndex: stage.stageIndex ?? null,
      name: stage.stageName || stage.source?.name || stage.sourceKey || 'unknown',
      parts: new Map(),
      occurrences: new Map(),
      total: 0,
    });
  }

  for (const part of parts || []) {
    const sourceKey = part.sourceKey || 'unknown';
    const key = keyOf(sourceKey, part.stageIndex, part.stageName);

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        sourceKey,
        source: part.source || null,
        stageIndex: part.stageIndex ?? null,
        name: part.stageName || part.source?.name || sourceKey,
        parts: new Map(),
        occurrences: new Map(),
        total: 0,
      };
      groups.set(key, group);
    }

    const amount = Number(part.amount) || 0;
    group.total += amount;

    const partIndex = Number.isInteger(part.partIndex) ? part.partIndex : 0;
    if (!group.parts.has(partIndex)) {
      group.parts.set(partIndex, {
        partIndex,
        element: part.element || null,
        amount: 0,
      });
    }
    const partInfo = group.parts.get(partIndex);
    partInfo.amount += amount;
    if (!partInfo.element && part.element) partInfo.element = part.element;

    // One entry is one cast. Compound rows share the entry id, so their parts
    // become a stack rather than separate occurrences on the x-axis.
    const entryId = part.entryId ?? `row:${part.order ?? 0}`;
    let occurrence = group.occurrences.get(entryId);
    if (!occurrence) {
      occurrence = {
        entryId,
        order: part.order ?? 0,
        total: 0,
        parts: [],
      };
      group.occurrences.set(entryId, occurrence);
    }
    occurrence.total += amount;
    occurrence.parts.push({
      partIndex,
      element: part.element || null,
      amount,
      hits: part.hits || 1,
    });
    if ((part.order ?? 0) < occurrence.order) occurrence.order = part.order;
  }

  // CATALOGUE ORDER, NOT DAMAGE ORDER. Sorting by total made every option move
  // whenever the rotation changed, so the menu was still a picture of the current
  // configuration even though its contents were complete. The source table is the
  // stable authority; entries the catalogue does not know follow in first-seen
  // order. A missing stage therefore never disappears or jumps around.
  return [...groups.values()]
    .map((group) => ({
      ...group,
      parts: [...group.parts.values()]
        .sort((a, b) => a.partIndex - b.partIndex),
      occurrences: [...group.occurrences.values()]
        .map((occurrence) => ({
          ...occurrence,
          parts: occurrence.parts
            .slice()
            .sort((a, b) => a.partIndex - b.partIndex),
        }))
        .sort((a, b) => a.order - b.order),
    }));
}
