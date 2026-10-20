// Turn the planner's rich axis objects into the narrow request the C# axis
// endpoint consumes. Display labels, icons and the full team catalogue stay in
// the browser; only numbers and identities cross the wire.

const compactScaling = (scaling) => {
  if (!scaling) return null;
  const out = {};
  if (scaling.mult != null) out.mult = scaling.mult;
  if (scaling.hits != null) out.hits = scaling.hits;
  return out;
};

const compactDrop = (drop) => ({
  source: { owner: { id: drop?.source?.owner?.id ?? null } },
  buffs: (drop?.buffs || []).map((buff) => ({
    key: buff?.key ?? null,
    value: buff?.value,
  })),
});

const compactEntry = (entry) => ({
  id: entry.id,
  kind: entry.kind ?? null,
  charId: entry.charId ?? null,
  summary: entry.summary ? {
    sourceKey: entry.summary.sourceKey ?? null,
    stageIndex: entry.summary.stageIndex ?? null,
    partIndex: entry.summary.partIndex ?? null,
    element: entry.summary.element ?? null,
    reactionKey: entry.summary.reactionKey ?? null,
    stage: entry.summary.stage?.basis
      ? { basis: entry.summary.stage.basis }
      : null,
  } : null,
  picked: entry.picked ? {
    sourceKey: entry.picked.sourceKey ?? null,
    stageIndex: entry.picked.stageIndex ?? null,
  } : null,
  statOverrides: entry.statOverrides || {},
  element: entry.element ?? null,
  reactionKey: entry.reactionKey ?? null,
  critMode: entry.critMode ?? null,
  scalingBasis: entry.scalingBasis ?? null,
  scaling: compactScaling(entry.scaling),
  partIndex: entry.partIndex ?? null,
  drops: (entry.drops || []).map(compactDrop),
  children: entry.children?.length ? entry.children.map(compactEntry) : null,
});

const compactArtifacts = (artifacts) => Object.fromEntries(
  Object.entries(artifacts || {})
    .filter(([, piece]) => piece && typeof piece === 'object')
    .map(([slot, piece]) => [slot, {
      mainStat: piece.mainStat ?? null,
      level: piece.level ?? null,
      subStats: (piece.subStats || [])
        .filter((sub) => sub && typeof sub === 'object')
        .map((sub) => ({
          key: sub.key,
          value: sub.value,
        })),
    }])
);

const compactUnit = (unit) => ({
  id: unit.id,
  unitId: unit.unitId ?? null,
  level: unit.level ?? 90,
  element: unit.element ?? null,
  weaponId: unit.weaponId ?? null,
  qualityType: unit.qualityType ?? null,
  constellation: unit.constellation ?? 0,
  refine: unit.refine ?? 1,
  talents: unit.talents ? {
    normal: unit.talents.normal ?? 1,
    skill: unit.talents.skill ?? 1,
    burst: unit.talents.burst ?? 1,
  } : null,
  artifacts: compactArtifacts(unit.artifacts),
});

/** The body of `POST /api/core/axis`. */
export function axisRequest(entries, team, lang = 'chs') {
  return {
    lang,
    entries: (entries || []).map(compactEntry),
    team: (team || []).map(compactUnit),
  };
}

/** The body of `POST /api/core/merged-expression`. */
export function mergedExpressionRequest(entries, team, charId, lang = 'chs') {
  return {
    ...axisRequest(entries, team, lang),
    charId,
  };
}
