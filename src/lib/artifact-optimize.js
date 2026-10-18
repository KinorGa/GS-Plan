// Turn a merged damage expression into a PROBLEM for the C++ optimiser, and the
// optimiser's CSV back into rows.
//
// WHY THE SPLIT IS HERE
//   'merged-expression.js' answers "what is this character's damage as a function
//   of the panel". The C++ program in 'native/optimize/' answers "which ROLL
//   allocation of five pieces maximises it". Neither knows about the other: the
//   program reads a plain text problem and writes a CSV, and this module is the
//   only thing that speaks both languages. Keeping the translation pure means a
//   test can run it without a server, a browser or the binary.
//
// WHAT A PROBLEM IS
//   The panel the character starts from (the build's MAIN stats and set bonuses,
//   with every SUBSTAT removed), what one roll of each substat is worth, and the
//   SHAPE of each of the five pieces -- how many lines it carries, how many rolls
//   it spends, and which substats may or must sit on it.
//
// WHY THE SHAPE IS NOT OPTIONAL
//   A 5-star piece at +20 has EXACTLY four substat lines and EXACTLY nine rolls to
//   spend on them (four affixes it is born with, plus five upgrades), and every
//   line holds at least one roll. A search that ignores this can put every roll into
//   CRIT DMG and leave three lines empty, then hand back an "optimum" that no
//   artifact can realise -- which is exactly what the budget-and-caps version of
//   this problem did. The shape is what makes the answer a BUILD.
//
// WHY THE BASELINE HAS NO SUBSTATS
//   The expression is a function of the panel, so the optimiser must add rolls to
//   a panel that does not already contain them. Starting from the current build
//   and adding a budget on top would answer "what if I had four MORE pieces",
//   which is not the question. The current build is not lost, though: it is handed
//   to the optimiser as the 'ref' row and comes back beside the results as the
//   comparison.

import { DEFAULT_RARITY, SUBSTAT_UNIT } from './substat-rolls';
import { SLOTS, SUB_STATS } from './artifact-model';

/**
 * The fraction of a top-tier roll one roll is worth.
 *
 * A substat rolls one of four tiers (0.7/0.8/0.9/1.0 of its top value). Charging
 * a full top-tier roll for every roll measures a build nobody can have; the four
 * tiers average to 0.85, and 0.8 is the middle of the two the user named. It is a
 * knob rather than a constant because the honest answer depends on what the tiers
 * are ASSUMED to be.
 */
export const DEFAULT_HIT_SCALE = 0.8;

/** Substats a 5-star piece at +20 carries, and the rolls it spends on them. */
export const PIECE_LINES = 4;
export const UPGRADES_DEFAULT = 5;
export const MAX_ROLLS_PER_LINE = 6;

/**
 * The substats whose rolls move the damage panel AT ALL.
 *
 * Kept as the historical ATK-only set. A live run uses `feedingSubstatsFor`,
 * which adds HP%, flat HP, DEF%, flat DEF and EM according to the merged
 * expression. Energy Recharge still spends a line and changes no damage number.
 */
export const FEEDING_SUBSTATS = ['atkPct', 'atk', 'critRate', 'critDmg'];

/** The scaling sources one merged expression actually contains. */
export function scalingBasesOf(expr) {
  if (Array.isArray(expr?.scalingBases) && expr.scalingBases.length) {
    return expr.scalingBases;
  }
  // Older callers and test fixtures predate `scalingBases`. Infer the sources
  // from the non-zero monomials so an H/D/M expression still opens correctly.
  const found = new Set();
  const maps = [
    expr?.coeffs?.never, expr?.coeffs?.crit,
    ...(expr?.coeffs?.avgGroups || []).flatMap((g) => [
      g.delta, ...(g.amp || []).map((a) => a.coeffs),
    ]),
    ...(expr?.coeffs?.ampNever || []).map((a) => a.coeffs),
    ...(expr?.coeffs?.ampCrit || []).map((a) => a.coeffs),
  ];
  for (const coeffs of maps) {
    for (const key of Object.keys(coeffs || {})) {
      if (!coeffs[key]) continue;
      if (key === 'A' || key.startsWith('A*')) found.add('atk');
      if (key === 'H' || key.startsWith('H*')) found.add('hp');
      if (key === 'D' || key.startsWith('D*')) found.add('def');
      if (key === 'M' || key.startsWith('M*')) found.add('em');
    }
  }
  return ['atk', 'hp', 'def', 'em'].filter((key) => found.has(key)).length
    ? ['atk', 'hp', 'def', 'em'].filter((key) => found.has(key))
    : ['atk'];
}

/** Whether Elemental Mastery itself enters the damage (scaling or reaction). */
export const emMattersIn = (expr) =>
  !!expr?.hasAmp || !!expr?.hasTransformative || scalingBasesOf(expr).includes('em');

/**
 * The substats that can move THIS expression's damage.
 *
 * CRIT Rate and CRIT DMG always can. A scaling source contributes both of its
 * percentage and flat stats: HP scaling reads HP% + flat HP, DEF scaling reads
 * DEF% + flat DEF, and so on. EM is included when it scales a hit or feeds an
 * amplifying reaction. The rest still occupy a line if the user allows them, but
 * the search does not branch on them.
 */
export function feedingSubstatsFor(expr) {
  const bases = new Set(scalingBasesOf(expr));
  const out = [];
  if (bases.has('atk')) out.push('atkPct', 'atk');
  if (bases.has('hp')) out.push('hpPct', 'hp');
  if (bases.has('def')) out.push('defPct', 'def');
  out.push('critRate', 'critDmg');
  if (emMattersIn(expr)) out.push('em');
  return out;
}

/** Every substat a 5-star piece can roll, in the order the panels list them. */
export const ALL_SUBSTATS = SUB_STATS.slice();

/**
 * The monomial order the C++ program reads its coefficient vectors in.
 *
 * It is ALSO the order 'merged-expression.js' builds its coefficient maps in,
 * which is not a coincidence: the two were written from the same expansion. The
 * vector is positional and wide-fixed, so a key missing from the map must become
 * an explicit 0 rather than shift every later term.
 */
export const MONO_ORDER = [
  '1', 'U', 'P', 'G', 'C', 'U*C', 'P*C', 'G*C',
  ...['A', 'H', 'D', 'M'].flatMap((s) => [
    s, `${s}*U`, `${s}*P`, `${s}*G`, `${s}*C`, `${s}*U*C`, `${s}*P*C`, `${s}*G*C`,
  ]),
];

/** The panel quantity each symbol stands for, as the UI names it. */
export const SYMBOL_LABEL = {
  A: { chs: '总攻击力', en: 'Total ATK' },
  H: { chs: '总生命值', en: 'Total HP' },
  D: { chs: '总防御力', en: 'Total DEF' },
  M: { chs: '元素精通', en: 'Elemental Mastery' },
  U: { chs: '风伤', en: 'Anemo DMG' },
  P: { chs: '火伤', en: 'Pyro DMG' },
  G: { chs: '增伤', en: 'DMG Bonus' },
  C: { chs: '暴伤', en: 'CRIT DMG' },
  R: { chs: '暴击率', en: 'CRIT Rate' },
  E: { chs: '元素精通', en: 'Elemental Mastery' },
};

/** 'A*U*C' -> its factors, so a caller can render names instead of symbols. */
export const monoFactors = (mono) => (mono === '1' ? [] : mono.split('*'));

/** A coefficient map as the fixed-width vector the program expects. */
export function coeffVector(coeffs) {
  return MONO_ORDER.map((k) => Number(coeffs?.[k]) || 0);
}

/**
 * The value one roll of 'key' is worth: 'scale' of its TOP tier.
 *
 * NOT the module's own 'SUBSTAT_UNIT', which is 'topTier / 10' -- the step the
 * four tiers are multiples of ('u * 7/8/9/10'), not a roll. Using it directly
 * makes a roll a tenth of a roll, and then a 24-roll build tops out at 2% CRIT
 * Rate while a real build wears 40: every allocation looks worthless and the
 * comparison against the current build is nonsense. 'TIER_MUL' tops out at 10,
 * so the top tier is 'unit * 10'.
 */
export function hitValueOf(key, scale = DEFAULT_HIT_SCALE, rarity = DEFAULT_RARITY) {
  const unit = SUBSTAT_UNIT[rarity]?.[key];
  return unit ? unit * 10 * scale : 0;
}

/**
 * The build with every SUBSTAT removed, leaving sets, main stats and levels.
 *
 * This is the baseline the optimiser adds rolls to. It keeps the piece's 'setId'
 * so the 2-piece/4-piece buff cards stay where they are -- those land on the
 * damage ROWS, and moving them would invalidate the coefficients.
 */
export function stripSubstats(build) {
  const out = {};
  for (const [slotKey, piece] of Object.entries(build || {})) {
    out[slotKey] = piece
      ? { ...piece, subStats: (piece.subStats || []).map(() => null) }
      : piece;
  }
  return out;
}

/** A number as text the C++ reader can take back verbatim. */
const num = (x) => String(Number(x) || 0);

/** Which panel field a substat feeds. Anything absent spends a roll and does nothing. */
const FEED_FIELD = {
  atkPct: 'atkPct', atk: 'flatAtk', hpPct: 'hpPct', hp: 'flatHp',
  defPct: 'defPct', def: 'flatDef',
  critRate: 'critRate', critDmg: 'critDmg', em: 'em',
};

/**
 * Roughly how many TOP-TIER rolls the CURRENT build's substats are worth.
 *
 * The difference between the worn panel and the same build with its substats
 * stripped, over one top-tier roll. Approximate by construction -- it says how many
 * top-tier rolls the totals are worth, not how they were rolled, and the four tiers
 * make those two different questions. A build that spends 45 rolls is normally
 * worth about 0.85 x 45, because a roll is a tier and not a top tier.
 */
export function impliedHits(base, cur, keys = FEEDING_SUBSTATS, scale = 1) {
  if (!base || !cur) return 0;
  let sum = 0;
  for (const key of keys) {
    const field = FEED_FIELD[key];
    const per = hitValueOf(key, scale);
    if (!field || !per) continue;
    sum += Math.max(0, (cur[field] || 0) - (base[field] || 0)) / per;
  }
  return sum;
}

/** The substats a piece may carry: every substat except its own main stat. */
export function allowedSubstatsFor(mainStat) {
  return ALL_SUBSTATS.filter((k) => k !== mainStat);
}

/**
 * One piece's SPECIFICATION, as the problem and the UI both need it.
 *
 * 'lines' and 'rolls' come from the artifact's level: a +20 five-star carries four
 * lines and spends nine rolls. An artifact below +20 simply has fewer upgrades, so
 * 'upgrades' is the knob and 5 is a finished piece.
 *
 * 'allows' is the per-piece substat state every caller edits: 'key' plus a state
 * where 1 means "may sit here" and 2 means "must". Order matters -- it is the order
 * the C++ program tries lines in, so it decides which of two damage-identical
 * layouts is the one reported.
 */
export function pieceSpec({
  slotKey, mainStat = null, upgrades = UPGRADES_DEFAULT,
  lines = PIECE_LINES, maxPerLine = MAX_ROLLS_PER_LINE, allows = null,
}) {
  const legal = allowedSubstatsFor(mainStat);
  // A caller's cells are re-indexed onto the LEGAL pool rather than trusted as
  // given: a substat the piece can no longer carry (it just became the main stat)
  // drops out, and the order stays the panel's, so a cell never moves under the
  // pointer because a neighbour was switched off.
  const given = allows
    ? legal
      .map((key) => allows.find((a) => a.key === key))
      .filter(Boolean)
    : null;
  return {
    slot: slotKey,
    mainStat,
    lines,
    rolls: lines + upgrades,
    maxPerLine,
    allows: given || legal.map((key) => ({ key, state: 1 })),
  };
}

/** The five pieces of a build, in slot order, with nothing pinned down yet. */
export function defaultPieces(build, opts = {}) {
  return SLOTS.map(({ key }) => pieceSpec({
    slotKey: key,
    mainStat: build?.[key]?.mainStat ?? null,
    ...opts,
  }));
}

/**
 * The five pieces of a build with the substats it WEARS pinned onto them.
 *
 * Each line the piece actually carries becomes a "must", so the allocation the user
 * is wearing is INSIDE the search space: the optimum then cannot come out worse
 * than the build on screen, which is the whole reason to import. The roll COUNTS
 * are left free on purpose -- a pinned line keeps its place, and the search still
 * gets to decide which of the nine rolls land on it.
 */
export function importPieces(build, { upgrades = UPGRADES_DEFAULT } = {}) {
  return SLOTS.map(({ key }) => {
    const piece = build?.[key] || {};
    const lines = (piece.subStats || []).filter((s) => s?.key && Number(s.value) > 0);
    const allows = allowedSubstatsFor(piece.mainStat).map((k) => ({ key: k, state: 1 }));
    for (const line of lines) {
      const at = allows.findIndex((a) => a.key === line.key);
      if (at >= 0) allows[at] = { key: line.key, state: 2 };
    }
    return pieceSpec({ slotKey: key, mainStat: piece.mainStat ?? null, upgrades, allows });
  });
}


/**
 * The problem file.
 *
 * @param {object}   o
 * @param {object}   o.expr        From 'mergedExpression'.
 * @param {object}   o.panel       The BASELINE panel (no substats).
 * @param {object}   [o.ref]       Variables of the CURRENT build, emitted last.
 * @param {object[]} o.pieces      'pieceSpec' results, one per slot.
 * @param {number}   [o.hitScale]
 */
export function buildProblem({ expr, panel, ref, pieces, hitScale = DEFAULT_HIT_SCALE }) {
  const rows = [];
  const put = (kind, ...rest) => rows.push([kind, ...rest].join(' '));

  rows.push('# artifact-optimize problem: generated, not hand-written');
  put('panel', num(panel.atk), num(panel.atkPct), num(panel.flatAtk),
    num(panel.critRate), num(panel.critDmg),
    num(panel.anemoDmg), num(panel.pyroDmg), num(panel.dmgBonus), num(panel.em),
    // The first nine fields are the historical format. These six are the raw
    // HP/DEF inputs behind H and D; a reader that predates them can ignore the
    // tail, exactly as it ignored any later addition.
    num(panel.hp), num(panel.hpPct), num(panel.flatHp),
    num(panel.def), num(panel.defPct), num(panel.flatDef));

  // Every substat is declared, whether or not any piece may use it, so the CSV's
  // columns are the same shape for every run and read back by NAME.
  for (const key of ALL_SUBSTATS) put('hit', key, num(hitValueOf(key, hitScale)));

  for (const piece of pieces) {
    put('piece', piece.slot, num(piece.lines), num(piece.rolls), num(piece.maxPerLine));
  }
  for (const piece of pieces) {
    // State 0 is "this substat may NOT sit on this piece", which is expressed by
    // leaving it out rather than by writing a zero the program would have to know
    // how to read.
    for (const a of piece.allows) {
      if (a.state < 1) continue;
      put('allow', piece.slot, a.key, num(a.state >= 2 ? 2 : 1));
    }
  }

  put('coeff', 'never', ...coeffVector(expr.coeffs.never).map(num));
  put('coeff', 'crit', ...coeffVector(expr.coeffs.crit).map(num));
  for (const g of expr.coeffs.avgGroups) {
    put('group', num(g.crBuff), ...coeffVector(g.delta).map(num));
    for (const a of g.amp || []) {
      put('amp', 'group', num(g.crBuff), num(a.emBuff), num(a.bonus),
        ...coeffVector(a.coeffs).map(num));
    }
  }
  for (const a of expr.coeffs.ampNever || []) {
    put('amp', 'never', num(a.emBuff), num(a.bonus), ...coeffVector(a.coeffs).map(num));
  }
  for (const a of expr.coeffs.ampCrit || []) {
    put('amp', 'crit', num(a.emBuff), num(a.bonus), ...coeffVector(a.coeffs).map(num));
  }
  // Transformative reaction damage: constant + emWeight * 16(E+B)/(E+B+2000).
  // It has no polynomial and does not crit, so one record serves all three crit
  // conventions.
  // REF: docs/REACTIONS.md#transformative
  for (const g of expr.coeffs.transformative || []) {
    put('rx', num(g.emBuff), num(g.constant), num(g.em));
  }
  if (ref) {
    put('ref', num(ref.A), num(ref.H), num(ref.D), num(ref.M),
      num(ref.C), num(ref.R), num(ref.E));
  }

  return rows.join('\n') + '\n';
}

/**
 * The optimiser's CSV, as rows.
 *
 * The header names the substats AND the panel columns, so the roll counts are read
 * back by NAME rather than by position -- a header the program grows later cannot
 * silently shift them onto the wrong stat.
 */
export function parseResult(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { stats: [], rows: [] };

  const head = lines[0].split(',').map((s) => s.trim());
  const at = (name) => head.indexOf(name);
  const aAt = at('A');
  const totalAt = at('total');
  if (aAt < 1) throw new Error('unexpected optimiser header: ' + lines[0]);
  const panelAt = ['A', 'H', 'D', 'M', 'C', 'R', 'E'].reduce((min, name) => {
    const i = at(name);
    return i >= 0 && (min < 0 || i < min) ? i : min;
  }, -1);
  // 'total' is a roll-count column but NOT a substat, so the stat list stops before
  // whichever of the two comes first. Reading it as a stat would put a phantom
  // column in the table and mis-name every count after it.
  const stats = head.slice(0, totalAt >= 0 && panelAt >= 0
    ? Math.min(totalAt, panelAt)
    : totalAt >= 0 ? totalAt : panelAt >= 0 ? panelAt : aAt);

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    // The reference row the program appends carries the PANEL and nothing else:
    // its roll cells are empty, because the current build is not an allocation the
    // search produced. Recorded rather than left to a caller to infer from a total
    // of zero -- zero rolls is itself a legal search result.
    const hasHits = c.slice(0, stats.length).some((cell) => String(cell ?? '').trim() !== '');
    const hits = {};
    for (let j = 0; j < stats.length; j += 1) hits[stats[j]] = Number(c[j]) || 0;
    rows.push({
      hits,
      hasHits,
      total: totalAt >= 0 ? Number(c[totalAt]) || 0 : stats.reduce((s, k) => s + hits[k], 0),
      A: Number(c[aAt]) || 0,
      H: Number(c[at('H')]) || 0,
      D: Number(c[at('D')]) || 0,
      M: Number(c[at('M')]) || 0,
      C: Number(c[at('C')]) || 0,
      R: Number(c[at('R')]) || 0,
      E: Number(c[at('E')]) || 0,
      never: Number(c[at('dmg_never')]) || 0,
      crit: Number(c[at('dmg_crit')]) || 0,
      avg: Number(c[at('dmg_avg')]) || 0,
      isCurrent: c[at('is_current')] === '1',
    });
  }
  return { stats, rows };
}
