// Merge EVERY damage entry of ONE character into a single closed-form expression
// over the stat panel.
//
// WHY THIS EXISTS
//   A character's damage is a sum of hundreds of independent rows, and the
//   artifact optimiser needs that sum as ONE function of the panel it may move.
//   Fitting such a function is hopeless AND unnecessary: every row is already a
//   product of LINEAR factors in the panel --
//
//     D_i = (A*t_i + f_i) * (1 + bonus_i/100) * crit_i * def * res * react
//           * zone * hits                (see `lib/damage.js`)
//
//   -- so the sum is a polynomial whose coefficients are READ OFF row by row and
//   added up. No sampling, no least squares. `selfCheck` proves it against
//   `computeAxis` rather than trusting the algebra.
//
// WHAT THE PANEL VOCABULARY IS
//   `A`, `H`, `D`, `M`, `U`, `P`, `G`, `C`, `R` are the panel quantities damage
//   reads: total ATK / HP / DEF / EM, Anemo DMG, Pyro DMG, the generic DMG bonus,
//   CRIT DMG and CRIT Rate. The expression is therefore exact for ANY build, and the optimiser
//   never re-derives it -- as long as the BUFF CARDS stay put. Buffs land on the
//   ROWS (`drops`), not on the panel, so changing an artifact SET changes the
//   coefficients; see `setSensitive`.
//
// THE THREE CRIT MODES ARE ONE FAMILY, NOT THREE FUNCTIONS
//   `computeDamage`'s crit factor is
//     never: 1     crit: 1 + cd     avg: 1 + min(rate,100)/100 * cd
//   i.e. `avg = never + mu * (crit - never)` PER ROW, with `mu` the ROW's own
//   effective rate. So this module returns `never` plus, per distinct CRIT-RATE
//   buff, the `delta = crit - never` group. The split exists because the +20%
//   rate cards sitting on most rows are CONSTANTS: they move where the clamp
//   bites (rate 80 and 100), not whether a row is variable.

import { computeDamage, entryScalingBasis, SCALING_SYMBOL } from './damage';
import {
  computeAxis, createContext, panelForEntry, sourcesForEntry,
} from './axis-compute';
import { derivePanel } from './stat-derive';
import { reactionByKey } from '../DamageCard';
import {
  foldDrops, foldZoneDrops, splitZoneFactors, mergeStats,
} from '../components/buff-model';
import { flatten } from './rotation-segment';

/** Panel keys the expression is a function of -- an override on one of these is a trap. */
export const PANEL_KEYS = [
  'atk', 'atkPct', 'flatAtk', 'hp', 'hpPct', 'flatHp', 'def', 'defPct', 'flatDef',
  'critRate', 'critDmg',
  'anemoDmg', 'pyroDmg', 'dmgBonus', 'em',
];

const CRIT_RATE_CAP = 100;

/**
 * Everything one computation needs, resolved once.
 *
 * Mirrors `axis-compute.js`'s private `contextFor`: the same team index and the
 * same per-character `$` scopes, because a dropped card's formula reads ITS OWN
 * owner's panel.
 */
/**
 * One part's coefficients, read out of the engine's OWN numbers.
 *
 * Re-derives what `computePart` does rather than calling it: that function is
 * private to `axis-compute.js` and returns only a total, while the merge needs
 * each factor separately. The stages, the buff fold and the panel merge are the
 * SAME calls, so the two cannot drift in what they mean -- and `selfCheck`
 * catches it if they ever do.
 */
function partsOf(entry, ctx) {
  const { char, panel } = panelForEntry(entry, ctx);
  const sources = sourcesForEntry(entry, ctx);
  if (!sources.length) return [];

  const mk = (partIndex, element, drops, overrides, multOv, hitsOv, basis) => {
    const sel = entry.summary;
    const src = sources.find((s) => s.key === (sel?.sourceKey || entry.picked?.sourceKey)) || sources[0];
    const stageIndex = sel?.stageIndex ?? entry.picked?.stageIndex ?? 0;
    const stage = src.stages[Math.min(Math.max(0, stageIndex), src.stages.length - 1)];
    if (!stage) return null;

    const parts = stage.parts || null;
    const idx = Math.min(Math.max(0, partIndex || 0), (parts?.length || 1) - 1);
    const activePart = (parts ? parts[idx] : null) || { mult: stage.mult, hits: stage.hits };
    const partMult = multOv != null ? multOv : activePart.mult;
    const partHits = hitsOv != null ? hitsOv : activePart.hits;

    const scopeOf = (d) => ctx.scopeByCharId.get(d?.source?.owner?.id);
    const { totals } = foldDrops(drops, scopeOf);
    const { mult: multZone, zone: zoneMult } = splitZoneFactors(foldZoneDrops(drops, scopeOf));
    const bp = { ...panel, ...(overrides || {}) };
    const withBuffs = Object.keys(totals).length ? mergeStats(bp, totals) : bp;
    const usedElement = element || sel?.element || src.element || null;

    // Always evaluated as `crit`: that mode's crit factor is exactly `1 + cd`,
    // so `cdBuff` comes out as the row's CRIT-DMG buff regardless of what the
    // entry is set to.
    const reaction = reactionByKey(entry.reactionKey ?? sel?.reactionKey);
    const r = computeDamage(withBuffs, {
      stage: { mult: partMult, hits: partHits, bonus: stage.bonus },
      reaction,
      element: usedElement,
      critMode: 'crit',
      zoneMult,
      multZone,
      atkLevel: Number(char?.level) || 90,
      basis,
    });
    if (!r) return null;

    // base = scaling*talent + flatDmg; dividing the bonus back out unwraps it
    // without the engine having to hand `flatDmg` over separately.
    const baseVal = r.withBonus / (1 + r.bonusPct / 100);
    const ownKey = usedElement === 'Anemo' ? 'anemoDmg' : usedElement === 'Pyro' ? 'pyroDmg' : null;
    const fixedKey = usedElement === 'Physical'
      ? 'physBonus'
      : usedElement
        ? `${String(usedElement)[0].toLowerCase()}${String(usedElement).slice(1)}Dmg`
        : null;
    const ownIsVariable = ownKey === 'anemoDmg' || ownKey === 'pyroDmg';
    const fixedPanel = fixedKey && !ownIsVariable ? Number(panel[fixedKey]) || 0 : 0;
    const fixedBuff = fixedKey && !ownIsVariable
      ? (Number(withBuffs[fixedKey]) || 0) - fixedPanel
      : 0;
    const amp = !!reaction?.amp;
    const ampBase = amp
      ? r.defMult * r.resMult * r.zoneMult * (partHits || 1) * reaction.base
      : 0;
    const ampBonus = amp ? (Number(withBuffs.reactionBonus) || 0) / 100 : 0;
    const emBuff = (Number(withBuffs.em) || 0) - (Number(panel.em) || 0);
    // Transformative reaction damage is a separate additional hit: it has no
    // scaling polynomial, no CRIT, no DMG bonus and no DEF zone. It is constant
    // plus a rational EM term, so it gets its own group rather than being folded
    // into the polynomial.
    // REF: docs/REACTIONS.md#transformative
    const reactionBonusPct = Number(withBuffs.reactionBonus) || 0;
    const reactionBaseTotal = r.reactionBaseDamage * (partHits || 1);
    const rxConst = reactionBaseTotal * (1 + reactionBonusPct / 100);
    // The group's `em` weight is the base reaction damage; the evaluator
    // multiplies it by 16(E+B)/(E+B+2000).
    const rxEm = reactionBaseTotal;
    return {
      element: usedElement,
      t: r.talent,
      f: baseVal - r.scalingValue * r.talent,
      aRow: r.scalingValue,
      scalingBasis: r.scalingBasis,
      symbol: SCALING_SYMBOL[r.scalingBasis] || 'A',
      // Everything panel-independent: defence, resistance, the user's own
      // multiplier zone, the reaction factor, the hit count. An amplifying
      // reaction's EM factor is deliberately NOT here: it is rational in EM, so
      // it gets its own coefficient family and is evaluated per candidate.
      rest: amp
        ? 0
        : r.defMult * r.resMult * r.reactMult * r.zoneMult * (partHits || 1),
      amp,
      ampBase,
      ampBonus,
      emBuff,
      // The row's OWN buff only -- `withBuffs` is panel + buff, and the panel
      // part is the VARIABLE, so folding it in here would count it twice.
      animus: ownKey === 'anemoDmg' ? withBuffs.anemoDmg - panel.anemoDmg : 0,
      pyro: ownKey === 'pyroDmg' ? withBuffs.pyroDmg - panel.pyroDmg : 0,
      // A non-Anemo/Pyro element's own DMG bonus and Physical's physBonus are
      // not in the substat pool, so they can be folded into the constant part of
      // the bonus bracket. This also captures the CURRENT goblet, which the
      // optimiser never moves.
      fixed: fixedPanel + fixedBuff,
      generic: withBuffs.dmgBonus - panel.dmgBonus,
      cdBuff: withBuffs.critDmg - panel.critDmg,
      crBuff: withBuffs.critRate - panel.critRate,
      rxConst,
      rxEm,
    };
  };

  const children = Array.isArray(entry.children) ? entry.children : null;
  if (children?.length) {
    return children
      .map((c) => mk(
        c.partIndex, c.element || null, c.drops, c.statOverrides,
        c.scaling?.mult, c.scaling?.hits,
        entryScalingBasis(c, entryScalingBasis(entry)),
      ))
      .filter(Boolean);
  }
  return [
    mk(
      entry.summary?.partIndex || 0, entry.element || null, entry.drops, null,
      entry.scaling?.mult, entry.scaling?.hits, entryScalingBasis(entry),
    ),
  ].filter(Boolean);
}

/**
 * The panel the character computes from, without an axis entry in hand.
 *
 * This is the vocabulary an optimiser moves. Row-level `statOverrides` are
 * deliberately NOT applied -- they are part of the row constants, and a merge
 * that silently pinned a row is what `warnings` reports.
 *
 * `artifacts` overrides the unit's own build. The optimiser needs the SAME
 * character with a DIFFERENT set of artifacts -- its own substats stripped, so a
 * baseline panel exists to add hits onto -- and re-deriving it here rather than
 * in the caller keeps the one derivation (`derivePanel`) in one place. The
 * COEFFICIENTS do not depend on this panel, so moving it does not invalidate the
 * merge; only the `ref` row and the search's starting point read it.
 */
export function panelOf(team, catalogue, charId, artifacts) {
  const unit = (team || []).find((u) => u.id === charId);
  if (!unit?.detail) return null;
  const values = derivePanel({
    charId: unit.id,
    detail: unit.detail,
    level: unit.level,
    element: unit.element,
    weaponId: unit.weaponId,
    weapon: catalogue?.weapons?.[unit.weaponId] || null,
    artifacts: artifacts ?? unit.artifacts,
    stats: catalogue?.stats,
  }).values;
  return panelFromValues(values);
}

/**
 * The narrow panel shape the polynomial reads, from a full derived panel.
 * Exported so the C# derive-panel result can be adapted with the same projection.
 */
export function panelFromValues(values) {
  if (!values) return null;
  return {
    atk: values.atk,
    atkPct: values.atkPct,
    flatAtk: values.flatAtk,
    hp: values.hp,
    hpPct: values.hpPct,
    flatHp: values.flatHp || 0,
    def: values.def,
    defPct: values.defPct,
    flatDef: values.flatDef || 0,
    critRate: values.critRate,
    critDmg: values.critDmg,
    anemoDmg: values.anemoDmg || 0,
    pyroDmg: values.pyroDmg || 0,
    dmgBonus: values.dmgBonus || 0,
    em: values.em || 0,
  };
}

/** `A` from a panel: `attack * (1 + atk%/100) + flat attack`. */
export const totalAtkOf = (panel) =>
  panel.atk * (1 + panel.atkPct / 100) + panel.flatAtk;

/** `H` from a panel: `health * (1 + HP%/100) + flat HP`. */
export const totalHpOf = (panel) =>
  (panel.hp || 0) * (1 + (panel.hpPct || 0) / 100) + (panel.flatHp || 0);

/** `D` from a panel: `defence * (1 + DEF%/100) + flat DEF`. */
export const totalDefOf = (panel) =>
  (panel.def || 0) * (1 + (panel.defPct || 0) / 100) + (panel.flatDef || 0);

/**
 * The panel's `A`, `H`, `D`, `M`, `U`, `P`, `G`, `C`, `R`, `E` -- what the rows
 * are merged over. Only the scaling symbols actually used by an entry appear in
 * its polynomial, but returning all four keeps the evaluator and the optimiser
 * indifferent to which kind of row is present.
 */
export function variablesOf(panel) {
  return {
    A: totalAtkOf(panel),
    H: totalHpOf(panel),
    D: totalDefOf(panel),
    M: panel.em || 0,
    U: panel.anemoDmg || 0,
    P: panel.pyroDmg || 0,
    G: panel.dmgBonus || 0,
    C: panel.critDmg,
    R: panel.critRate,
    E: panel.em || 0,
  };
}

/**
 * Accumulate one coefficient set.
 *
 * Per row the algebra is the product of two linear forms --
 *   bonus:  sigma + (own + G)/100,  sigma = 1 + (rowOwn + rowGeneric)/100
 *   crit:   q1 + qC*C
 * -- times `(A*t + f') * rest`, where `f' = (aRow - A0)*t + f` folds the row's
 * own ATK buff into the constant. Expanding gives one term per monomial, and
 * that is the whole merge: a sum of sums. `mono` is '' for the constant term,
 * which is why the key building below looks the way it does.
 */
function accumulate(rows, a0BySymbol, qOf, filter, weightOf = (row) => row.rest) {
  const coeffs = {};
  const add = (k, v) => { if (v) coeffs[k] = (coeffs[k] || 0) + v; };

  for (const row of rows) {
    if (filter && !filter(row)) continue;
    const symbol = row.symbol || 'A';
    const a0 = Number(a0BySymbol?.[symbol]) || 0;
    const fp = (row.aRow - a0) * row.t + row.f;
    const weight = weightOf(row);
    if (!weight) continue;
    const sigma = 1 + (row.fixed + row.animus + row.pyro + row.generic) / 100;
    const forms = [
      { c: sigma, mono: '' },
      { c: row.animus ? 1 / 100 : 0, mono: 'U' },
      { c: row.pyro ? 1 / 100 : 0, mono: 'P' },
      { c: 1 / 100, mono: 'G' },
    ];
    const { q1, qC } = qOf(row);
    for (const { c, mono } of forms) {
      if (!c) continue;
      const k = weight * c;
      add(mono || '1', k * fp * q1);
      add(mono ? `${symbol}*${mono}` : symbol, k * row.t * q1);
      if (qC) {
        add(mono ? `${mono}*C` : 'C', k * fp * qC);
        add(mono ? `${symbol}*${mono}*C` : `${symbol}*C`, k * row.t * qC);
      }
    }
  }
  return coeffs;
}

/**
 * The amplifying-reaction factor: `1 + 2.78 * EM / (EM + 1400)`.
 *
 * Kept as a function rather than expanded into the monomials because it is
 * RATIONAL in EM. The optimiser therefore carries the polynomial part of an amp
 * row separately and multiplies it by this factor at evaluation time.
 */
export const emFactor = (em) => 1 + (2.78 * (Number(em) || 0)) / ((Number(em) || 0) + 1400);

/**
 * The transformative-reaction EM factor: `16 * EM / (EM + 2000)`.
 *
 * REF: docs/REACTIONS.md#transformative
 * REF: https://github.com/genshinsim/gcsim/blob/main/pkg/core/combat/reaction.go
 */
export const transformativeEmFactor = (em) => {
  const value = Math.max(0, Number(em) || 0);
  return (16 * value) / (value + 2000);
};

/** `Σ emFactor(E + row EM buff) * polynomial` for one family of amp terms. */
export function evaluateAmp(groups, v) {
  if (!groups?.length) return 0;
  const E = Number(v?.E) || 0;
  let sum = 0;
  for (const g of groups) {
    const factor = emFactor(E + (Number(g.emBuff) || 0)) + (Number(g.bonus) || 0);
    sum += factor * evaluate(g.coeffs, v);
  }
  return sum;
}

/** `Σ [constant + emWeight * transformativeEmFactor(E + row EM buff)]`. */
export function evaluateTransformative(groups, v) {
  if (!groups?.length) return 0;
  const E = Number(v?.E) || 0;
  let sum = 0;
  for (const g of groups) {
    sum += (Number(g.constant) || 0)
      + (Number(g.em) || 0) * transformativeEmFactor(E + (Number(g.emBuff) || 0));
  }
  return sum;
}

/** Rows that share an EM buff can share one `emFactor`; group them by it. */
function ampGroupsOf(rows, a0BySymbol, qOf, filter) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.amp || (filter && !filter(row))) continue;
    const emBuff = Math.round((Number(row.emBuff) || 0) * 1e6) / 1e6;
    const bonus = Math.round((Number(row.ampBonus) || 0) * 1e6) / 1e6;
    const key = `${emBuff}|${bonus}`;
    if (!groups.has(key)) groups.set(key, { emBuff, bonus, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => a.emBuff - b.emBuff || a.bonus - b.bonus)
    .map((group) => ({
      emBuff: group.emBuff,
      bonus: group.bonus,
      coeffs: accumulate(group.rows, a0BySymbol, qOf, null, (r) => r.ampBase),
    }));
}

/**
 * Transformative reaction groups, one per distinct row-level EM buff.
 *
 * The group stores the EM-independent part and the weight of the rational EM
 * factor. It is deliberately separate from `ampGroupsOf`: amplifying reactions
 * use `2.78 EM / (EM + 1400)`, transformative reactions use
 * `16 EM / (EM + 2000)`.
 */
function transformativeGroupsOf(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.rxConst && !row.rxEm) continue;
    const emBuff = Math.round((Number(row.emBuff) || 0) * 1e6) / 1e6;
    const group = groups.get(emBuff) || { emBuff, constant: 0, em: 0 };
    group.constant += Number(row.rxConst) || 0;
    group.em += Number(row.rxEm) || 0;
    groups.set(emBuff, group);
  }
  return [...groups.values()].sort((a, b) => a.emBuff - b.emBuff);
}

/** Evaluate a coefficient set at one point of the panel. `R` is not used here. */
export function evaluate(coeffs, v) {
  const {
    A = 0, H = 0, D = 0, M = 0, U = 0, P = 0, G = 0, C = 0,
  } = v || {};
  const m = {
    '1': 1, U, P, G, C,
    'U*C': U * C, 'P*C': P * C, 'G*C': G * C,
  };
  // Every scaling source expands the same eight-term block: a constant, the
  // three DMG-bonus quantities, CRIT DMG, and their products. A / H / D / M are
  // mutually exclusive per row but a character may mix them across entries.
  for (const [sym, value] of [['A', A], ['H', H], ['D', D], ['M', M]]) {
    m[sym] = value;
    m[`${sym}*U`] = value * U;
    m[`${sym}*P`] = value * P;
    m[`${sym}*G`] = value * G;
    m[`${sym}*C`] = value * C;
    m[`${sym}*U*C`] = value * U * C;
    m[`${sym}*P*C`] = value * P * C;
    m[`${sym}*G*C`] = value * G * C;
  }
  let sum = 0;
  for (const [k, c] of Object.entries(coeffs)) sum += c * (m[k] || 0);
  return sum;
}

/**
 * The expected-value total, assembled from the two halves.
 *
 * `avg = never + sum_g min(R + crBuff_g, 100)/100 * delta_g`. The breakpoints sit
 * at `R = 100 - crBuff_g`, which is why the groups cannot be added up into one.
 */
export function expected(expr, v) {
  const R = v?.R || 0;
  let sum = neverAt(expr, v);
  for (const g of expr.coeffs.avgGroups) {
    const mu = Math.min(R + g.crBuff, CRIT_RATE_CAP) / 100;
    sum += mu * (evaluate(g.delta, v) + evaluateAmp(g.amp, v));
  }
  return sum;
}

/** The never-crit and always-crit halves, including amplifying reactions. */
export const neverAt = (expr, v) =>
  evaluate(expr.coeffs.never, v)
  + evaluateAmp(expr.coeffs.ampNever, v)
  + evaluateTransformative(expr.coeffs.transformative, v);

export const critAt = (expr, v) =>
  evaluate(expr.coeffs.crit, v)
  + evaluateAmp(expr.coeffs.ampCrit, v)
  + evaluateTransformative(expr.coeffs.transformative, v);

/** `{ never, crit, avg }` at one point of the panel, in one call. */
export function damageAt(expr, v) {
  return {
    never: neverAt(expr, v),
    crit: critAt(expr, v),
    avg: expected(expr, v),
  };
}

/**
 * Merge every entry of one character into one expression.
 *
 * Returns both coefficient sets, the per-rate-buff `delta` groups, the panel the
 * character is on, and any warning that would make the expression unsafe for an
 * optimiser.
 */
export function mergedExpression({
  entries, team, catalogue, talentDamage, charId,
}) {
  const ctx = createContext(team, catalogue, talentDamage);
  const rows = [];
  let entryCount = 0;
  const suspicious = new Set();

  // A rotation may hold SEGMENTS, whose members are the actual damage rows. A
  // top-level walk silently found the segment (charId 'none') and none of its
  // members, so a loop-heavy axis merged to zero. `flatten` is the same walk the
  // axis and the row editor use.
  for (const e of flatten(entries || []).map((x) => x.row)) {
    if (e.charId !== charId) continue;
    entryCount += 1;
    for (const p of partsOf(e, ctx)) rows.push(p);
    const touch = (o) => Object.keys(o || {}).forEach((k) => {
      if (PANEL_KEYS.includes(k)) suspicious.add(k);
    });
    touch(e.statOverrides);
    (e.children || []).forEach((c) => touch(c.statOverrides));
  }

  const base = panelOf(team, catalogue, charId);
  if (!base) return null;
  const a0BySymbol = {
    A: totalAtkOf(base),
    H: totalHpOf(base),
    D: totalDefOf(base),
    M: base.em || 0,
  };

  const never = accumulate(rows, a0BySymbol, () => ({ q1: 1, qC: 0 }));
  const crit = accumulate(rows, a0BySymbol, (r) => ({ q1: 1 + r.cdBuff / 100, qC: 1 / 100 }));
  const ampNever = ampGroupsOf(rows, a0BySymbol, () => ({ q1: 1, qC: 0 }));
  const ampCrit = ampGroupsOf(rows, a0BySymbol, (r) => ({ q1: 1 + r.cdBuff / 100, qC: 1 / 100 }));
  const transformative = transformativeGroupsOf(rows);

  // One `delta` group per distinct CRIT-RATE buff, because the clamp makes rows
  // non-fungible: one at `R + 20` stops gaining at `R = 80`, one at `R` at 100.
  const buffs = [...new Set(rows.map((r) => Math.round(r.crBuff * 1e6) / 1e6))]
    .sort((a, b) => a - b);
  const avgGroups = buffs.map((crBuff) => ({
    crBuff,
    delta: accumulate(
      rows, a0BySymbol,
      (r) => ({ q1: r.cdBuff / 100, qC: 1 / 100 }),
      (r) => Math.abs(r.crBuff - crBuff) < 1e-6,
    ),
    amp: ampGroupsOf(
      rows, a0BySymbol,
      (r) => ({ q1: r.cdBuff / 100, qC: 1 / 100 }),
      (r) => Math.abs(r.crBuff - crBuff) < 1e-6,
    ),
  }));

  const warnings = [];
  if (suspicious.size) {
    warnings.push({
      code: 'panel-override',
      keys: [...suspicious],
      detail: 'Some entries override panel keys the expression varies; those rows stay pinned.',
    });
  }
  if (!rows.length) warnings.push({ code: 'no-rows' });

  return {
    charId,
    entries: entryCount,
    parts: rows.length,
    // Which coefficient sources this particular character actually uses. The
    // optimiser reads it to expose only the HP/DEF/EM substats that can move a
    // number, and the UI uses it to label the polynomial without listing terms
    // that are identically zero.
    scalingBases: ['atk', 'hp', 'def', 'em'].filter(
      (key) => rows.some((row) => row.scalingBasis === key)
    ),
    base,
    variables: variablesOf(base),
    coeffs: { never, crit, avgGroups, ampNever, ampCrit, transformative },
    hasAmp: ampNever.length > 0 || ampCrit.length > 0,
    hasTransformative: transformative.length > 0,
    warnings,
    // NOT a guarantee of invariance: buff cards are the coefficients' real
    // input, so an optimiser allowed to move SETS must re-merge per combination.
    setSensitive: true,
  };
}

/**
 * The expression against the engine, on random panels.
 *
 * The merge is algebra, and algebra is easy to get subtly wrong -- the first two
 * attempts at this both missed a term. This re-evaluates the whole axis with the
 * panel overridden and the crit mode forced, so "the expression is exact" is a
 * measurement rather than a belief.
 */
export function selfCheck(expr, {
  entries, team, catalogue, talentDamage, samples = 40, rng = Math.random,
}) {
  const id = expr.charId;
  const mine = flatten(entries || []).map((x) => x.row).filter((e) => e.charId === id);
  const merge = (s, over) => ({ ...(s || {}), ...(over || {}) });
  const withEdits = (over, mode) => {
    const patchChild = (child, force) => {
      const here = force || child.charId === id;
      const out = here
        ? {
          ...child,
          statOverrides: merge(child.statOverrides, over),
          ...(mode ? { critMode: mode } : {}),
        }
        : child;
      if (Array.isArray(child.children)) {
        out.children = child.children.map((c) => patchChild(c, here));
      }
      return out;
    };
    const patchRow = (e) => {
      const here = e.charId === id;
      const out = here
        ? {
          ...e,
          statOverrides: merge(e.statOverrides, over),
          ...(mode ? { critMode: mode } : {}),
        }
        : e;
      if (Array.isArray(e.children)) out.children = e.children.map((c) => patchChild(c, here));
      return out;
    };
    return (entries || []).map(patchRow);
  };
  const totalFor = (list) => {
    const ax = computeAxis(list, team, catalogue, talentDamage);
    let sum = 0;
    for (const e of mine) {
      const r = ax.byId.get(e.id);
      if (r) sum += r.total;
    }
    return sum;
  };

  const rnd = (a, b) => a + rng() * (b - a);
  const b = expr.base;
  const worst = { never: 0, crit: 0, avg: 0 };
  for (let i = 0; i < samples; i += 1) {
    const over = {
      atkPct: b.atkPct + rnd(-100, 150),
      flatAtk: b.flatAtk + rnd(-370, 600),
      hpPct: (b.hpPct || 0) + rnd(-30, 120),
      flatHp: (b.flatHp || 0) + rnd(-2000, 6000),
      defPct: (b.defPct || 0) + rnd(-30, 120),
      flatDef: (b.flatDef || 0) + rnd(-200, 800),
      critDmg: b.critDmg + rnd(-200, 300),
      critRate: rnd(5, 110),
      anemoDmg: rnd(-20, 150),
      pyroDmg: rnd(-20, 150),
      dmgBonus: rnd(-40, 200),
      em: Math.max(0, (b.em || 0) + rnd(-150, 700)),
    };
    const v = {
      A: b.atk * (1 + over.atkPct / 100) + over.flatAtk,
      H: totalHpOf({ ...b, ...over }),
      D: totalDefOf({ ...b, ...over }),
      M: over.em,
      U: over.anemoDmg,
      P: over.pyroDmg,
      G: over.dmgBonus,
      C: over.critDmg,
      R: over.critRate,
      E: over.em,
    };
    const got = damageAt(expr, v);
    for (const mode of ['never', 'crit', 'avg']) {
      const eng = totalFor(withEdits(over, mode));
      const rel = Math.abs(got[mode] - eng) / Math.max(1, Math.abs(eng));
      if (rel > worst[mode]) worst[mode] = rel;
    }
  }
  return worst;
}

