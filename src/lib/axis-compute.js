// Compute the damage of EVERY entry on an axis, from data alone.
//
// THE ONE PLACE THAT TURNS AN AXIS INTO NUMBERS.
//
// Why this exists as a pure function rather than inside the components. Two
// separate bugs came from computing in one place and reading a stale copy in
// another:
//
//   * a multi-part row's collapsed header read a `figure` cached on a child, which
//     was only ever written when that child's card MOUNTED. After a reload nothing
//     had mounted, so the axis total moved depending on which rows the user had
//     happened to expand. Measured: the same imported file showed 443,081, then
//     597,979, then 608,978, while the rows themselves never changed.
//   * the parent's own `summary.perHit` was a number computed from an EMPTY panel
//     -- it has no drops and cannot hold a buff -- and the summary read it as real
//     damage. A row worth 238,305 contributed 562.
//
// Both are the same mistake: a number that is DERIVED being stored and then
// trusted. So the derivation lives here, once, and every reader calls it.
//
// PURE: given the same team and axis, it returns the same numbers. No React, no
// storage, no cache. Callers memoise it; nothing writes its result back as though
// it were input.

import { computeDamage } from './damage';
import { derivePanel } from './stat-derive';
import { buildSources } from '../char-sources';
import { defaultStats, reactionByKey } from '../DamageCard';
import {
  foldDrops, foldZoneDrops, customZoneMultiplier, mergeStats,
} from '../components/buff-model';
import { scopeForUnit } from './buff-formula';

/**
 * Everything about one entry that a computation needs, resolved once per axis.
 *
 * The team is indexed by character id up front rather than searched per entry: a
 * nine-row axis would otherwise scan the catalogue nine times per render.
 */
function contextFor(team, catalogue, talentDamage) {
  const byCharId = new Map();
  for (const u of team || []) {
    if (u?.id) byCharId.set(u.id, u);
  }
  /**
   * The `$` scope of each character, derived ONCE per axis.
   *
   * A dropped card's formula reads ITS OWN owner's panel (`owner.id` is that
   * character's id), so the scope is keyed by character id. Deriving it here
   * rather than inside `computePart` is what keeps a nine-row axis from running
   * `derivePanel` once per drop.
   */
  const scopeByCharId = new Map();
  for (const u of team || []) {
    if (u?.id) scopeByCharId.set(u.id, scopeForUnit(u, catalogue));
  }
  return { byCharId, catalogue, talentDamage, scopeByCharId };
}

/** The stat panel one entry computes from. */
export function panelForEntry(entry, ctx) {
  const char = ctx.byCharId.get(entry.charId) || null;
  // No character chosen, or its data has not arrived: the card's own defaults are
  // what the UI shows, so they are what the number is computed from.
  const charData = char?.detail || null;
  let derived = null;
  if (charData) {
    const weapon = char.weaponId ? ctx.catalogue?.weapons?.[char.weaponId] || null : null;
    derived = derivePanel({
      charId: char.id,
      detail: charData,
      level: char.level,
      element: char.element,
      weaponId: char.weaponId,
      weapon,
      artifacts: char.artifacts,
      stats: ctx.catalogue?.stats,
    });
  }
  return {
    char,
    charData,
    // The EDITS sit on top of the derived values, exactly as the card does it.
    panel: { ...defaultStats(), ...(derived?.values || {}), ...(entry.statOverrides || {}) },
  };
}

/**
 * One part of one entry.
 *
 * @param partIndex  Which part of the row, for a compound one; 0 otherwise.
 * @param drops      The cards to fold in -- the entry's own, or a child's.
 * @param element    The damage type this part carries.
 * @param overrides  The stat edits that apply to this part.
 */
function computePart({
  entry, ctx, char, charData, panel, sources, partIndex, element, drops, overrides, critMode,
  mult: multOverride, hits: hitsOverride,
}) {
  const sel = entry.summary;
  const src = sources.find((s) => s.key === (sel?.sourceKey || entry.picked?.sourceKey)) || sources[0];
  if (!src) return null;

  const stageIndex = sel?.stageIndex ?? entry.picked?.stageIndex ?? 0;
  const stage = src.stages[Math.min(Math.max(0, stageIndex), src.stages.length - 1)];
  if (!stage) return null;

  // WHICH PART, and its coefficient. `parts` is null for an ordinary row, in which
  // case the stage's own multiplier is the part.
  const parts = stage.parts || null;
  const idx = Math.min(Math.max(0, partIndex || 0), (parts?.length || 1) - 1);
  const activePart = (parts ? parts[idx] : null) || { mult: stage.mult, hits: stage.hits };
  if (!activePart) return null;

  // AN IMPORTED ROW KNOWS ITS OWN NUMBERS. gcsim logs the exact multiplier it
  // used and how many hits it rolled, which the local talent table cannot
  // express -- 法尔伽's 狂飙突进 runs at 220% of the table value, its C1 doubles
  // 四风将起, and a multi-part skill fires several coefficients that the row must
  // keep apart. So an entry may carry `scaling`; when it does, it WINS, and the
  // table is only the fallback for a row written by hand.
  const partMult = multOverride != null ? multOverride : activePart.mult;
  const partHits = hitsOverride != null ? hitsOverride : activePart.hits;

  // The buffs on the cards THIS part holds.
  const allBuffs = (drops || []).flatMap((d) => d.buffs);
  // A FORMULA READS ITS OWN CARD'S OWNER, so the fold is per drop rather than
  // one scope for the lot: a card from 尼可 must read 尼可's panel even when it
  // sits beside a card from 法尔伽. `foldDrops` is that fold, shared with the
  // editor and the collapsed row so a row, a card and the axis cannot disagree.
  const scopeOf = (d) => ctx.scopeByCharId.get(d?.source?.owner?.id);
  const { totals } = foldDrops(drops, scopeOf);
  const zoneMult = customZoneMultiplier(foldZoneDrops(drops, scopeOf));

  // The panel, with this part's own buffs folded in. The SAME merge the card uses,
  // so the row and the card cannot disagree.
  const base = { ...panel, ...(overrides || {}) };
  const withBuffs = Object.keys(totals).length ? mergeStats(base, totals) : base;

  const usedElement = element || sel?.element || src.element || null;

  const r = computeDamage(withBuffs, {
    stage: { mult: partMult, hits: partHits, bonus: stage.bonus },
    reaction: reactionByKey(entry.reactionKey ?? sel?.reactionKey),
    element: usedElement,
    critMode: critMode || 'avg',
    zoneMult,
    atkLevel: Number(char?.level) || 90,
  });

  return {
    // THE CHILD'S OWN INDEX, not the clamped `idx`. `idx` exists only to pick a
    // fallback coefficient out of the table; reporting it broke every caller that
    // matches a child to its figure BY INDEX -- `EntryGroup`'s `partRows`. An
    // imported compound row can have MORE children than the table has parts (a cast
    // whose hits drifted in buffs or crit, so they are not one hit), and then
    // `idx` collapsed them onto the last part: child 2 matched nothing (the row
    // printed a dash) and child 3 matched child 1's figure, so 苍噬 showed the same
    // number twice with a dash between them.
    partIndex: partIndex || 0,
    element: usedElement,
    perHit: r.perHit,
    total: r.total,
    hits: partHits || 1,
    mult: partMult,
  };
}

/**
 * One entry's numbers, for every part it has.
 *
 * A COMPOUND ROW IS COMPUTED PER PART, because its halves meet different
 * resistances and can carry different buffs -- that is the entire reason the split
 * exists. `parts` therefore has one entry per child, and `perHit`/`total` are the
 * sums, so a caller that only wants "the row's number" does not have to add up.
 */
export function computeEntry(entry, ctx) {
  if (!entry || entry.charId === 'none') return null;

  /**
   * A LOOP SUMS ITS ENTRIES -- it is not one.
   *
   * This branch has to come first, because everything below reads `children` as the
   * PARTS of a single talent row (each with a coefficient and its own element).
   * Running a loop through that would treat seventeen independent rows as seventeen
   * parts of one, pinning them all to `partIndex` 0 so every one computed the first
   * coefficient -- and the axis total would be nonsense.
   *
   * A loop is a pure container: it has no character, no drops and no summary of its
   * own, so there is nothing to compute for the group itself. Its figures are the
   * sum of its members', and the `children` array is returned so a caller that wants
   * to break the total down (the summary panel) can still see each member's parts.
   */
  if (entry.kind === 'segment') {
    const kids = (entry.children || []).map((c) => computeEntry(c, ctx)).filter(Boolean);
    if (!kids.length) return null;
    return {
      loop: true,
      children: kids,
      perHit: kids.reduce((n, k) => n + k.perHit, 0),
      total: kids.reduce((n, k) => n + k.total, 0),
      hits: 1,
    };
  }

  const { char, charData, panel } = panelForEntry(entry, ctx);
  if (!charData) return null;

  const sources = buildSources(
    charData, char?.element, ctx.talentDamage, entry.charId, char?.talents
  );
  if (!sources.length) return null;

  const children = Array.isArray(entry.children) ? entry.children : null;

  if (children?.length) {
    // Each child is its own computation: its own drops, its own element, its own
    // crit mode. The parent's overrides are NOT inherited -- `repairChildren` and
    // the UI both keep them separate.
    const parts = children.map((c) => computePart({
      entry, ctx, char, charData, panel, sources,
      partIndex: c.partIndex,
      element: c.element || null,
      drops: c.drops,
      overrides: c.statOverrides,
      mult: c.scaling?.mult,
      hits: c.scaling?.hits,
      // A child without a mode of its own reads the PARENT's, so setting the row
      // to 必定暴击 applies to both halves rather than only to the ones that
      // happen to have been touched.
      critMode: c.critMode || entry.critMode || null,
    })).filter(Boolean);

    if (!parts.length) return null;
    return {
      parts,
      perHit: parts.reduce((n, p) => n + p.perHit, 0),
      total: parts.reduce((n, p) => n + p.total, 0),
      hits: 1,
    };
  }

  const one = computePart({
    entry, ctx, char, charData, panel, sources,
    partIndex: entry.summary?.partIndex || 0,
    element: entry.element || null,
    drops: entry.drops,
    overrides: null,
    critMode: entry.critMode || null,
    mult: entry.scaling?.mult,
    hits: entry.scaling?.hits,
  });
  if (!one) return null;
  return { parts: [one], perHit: one.perHit, total: one.total, hits: one.hits };
}

/**
 * The whole axis, every entry, computed from data.
 *
 * Returns a Map keyed by entry id so a reader can look one up without searching,
 * and a `total` for the axis. An entry that cannot be computed (no character, no
 * data yet) is ABSENT from the map rather than present with zeros -- a caller must
 * be able to tell "no number yet" from "zero damage".
 */
export function computeAxis(entries, team, catalogue, talentDamage) {
  const ctx = contextFor(team, catalogue, talentDamage);
  const byId = new Map();
  let total = 0;
  let perHit = 0;

  for (const e of entries || []) {
    const r = computeEntry(e, ctx);
    if (!r) continue;
    byId.set(e.id, r);
    total += r.total;
    perHit += r.perHit;

    /**
     * A LOOP'S MEMBERS ARE INDEXED TOO, by their own ids.
     *
     * A member renders through the same row component as a top-level entry and looks
     * its own figures up by id -- so without this every member of every loop showed a
     * dash (`—`) and its parts were unknown, while the loop's own total was correct.
     * The member ids are unique across the axis (the paste scopes them to the loop),
     * so one flat map is enough and a member can be looked up without knowing which
     * loop it is in.
     */
    if (r.loop) {
      (e.children || []).forEach((c, i) => {
        const cr = r.children?.[i];
        if (cr) byId.set(c.id, cr);
      });
    }
  }
  return { byId, total, perHit, computed: byId.size, entries: (entries || []).length };
}
