// Formula-valued buffs, scoped to the OWNER CHARACTER's own derived stats.
//
// WHAT THIS IS
//   A buff's value may be a literal number (`120`) or a formula (`=$总攻击力*0.15`).
//   A formula's symbols are read from the panel DERIVED from the unit's own
//   character + weapon + artifacts -- nothing else. That closed scope is the
//   whole point: a buff that grants "15% of total ATK" must read a total that
//   does not already include itself, so `$总攻击力` is the panel total BEFORE any
//   buff is folded in. A self-referential formula is therefore IMPOSSIBLE rather
//   than merely discouraged.
//
// WHY A PARSER AND NOT eval
//   A buff value arrives from localStorage, an imported file, or a paste.
//   `new Function('return ' + text)` over that is arbitrary code execution from a
//   document the user was sent. A recursive-descent parser over numbers, symbols
//   and `+ - * / ( )` cannot execute anything, and it can say WHERE it failed
//   rather than throwing a SyntaxError at a stranger.
//
// THE TWO NAMESPACES, in the same spirit as the demo that proved the idea:
//   `$攻击力`    the panel field as derived (base: character + weapon white ATK)
//   `$总攻击力`  that field AFTER its percentage and flat additions
// Both are needed. A flat-ATK buff (Bennett-style) adds to the BASE; "15% of
// ATK" reads the TOTAL. Offering only one silently mis-states the other.
//
// `valueOf` NEVER REDUCES A FORMULA TO THE DIGITS INSIDE IT. `=$NOPE*0.15` must
// not read as `0.15`, and `12abc3` must not read as `123`: a value RESOLVES or it
// is REFUSED. Both branches obey that, hence `resolve()` returning a result
// object rather than a bare number.

import { DERIVED_KEYS, derivePanel } from './stat-derive';
import { STAT_META } from './stat-meta';

/**
 * The three totals, each `base * (1 + pct/100) + flat`.
 *
 * Kept here rather than imported from `lib/damage.js` because this module is a
 * pure description of "what a symbol means", and damage.js pulls in the whole
 * formula. The arithmetic is asserted equal to the formula's in
 * `scratch/check-buff-formula.mjs`.
 */
export const TOTALS = {
  hp: (p) => (p.hp || 0) * (1 + (p.hpPct || 0) / 100) + (p.flatHp || 0),
  atk: (p) => (p.atk || 0) * (1 + (p.atkPct || 0) / 100) + (p.flatAtk || 0),
  def: (p) => (p.def || 0) * (1 + (p.defPct || 0) / 100) + (p.flatDef || 0),
};

/** The per-unit identity fields a formula may read, with their Chinese names. */
const IDENTITY = [
  { key: 'level', name: '等级', en: 'Level' },
  { key: 'constellation', name: '命座', en: 'Constellation' },
  { key: 'talentNormal', name: '普通攻击等级', en: 'Normal ATK Lv' },
  { key: 'talentSkill', name: '元素战技等级', en: 'Skill Lv' },
  { key: 'talentBurst', name: '元素爆发等级', en: 'Burst Lv' },
  { key: 'refine', name: '精炼', en: 'Refinement' },
  { key: 'rarity', name: '稀有度', en: 'Rarity' },
];

/**
 * The symbol table: every quantity derivable from a character's OWN stats and
 * its artifacts.
 *
 *   kind: 'panel'    a field straight off the derived panel
 *   kind: 'total'    the three `base*(1+pct)+flat` totals
 *   kind: 'identity' level / constellation / talent levels / refine / rarity
 *
 * THE `name` IS THE SYMBOL; `en` IS DISPLAY ONLY.
 *   Parsing matches `name` (the Chinese identifier, which contains no spaces).
 *   `en` is carried so a symbol panel can label a button in an English UI -- it
 *   is NOT a token. An English name like "Total ATK" contains a space, and the
 *   tokenizer deliberately ends a name at the next space (so `$ATK * 0.15`
 *   works), which would split it into two symbols. Deriving a space-free English
 *   token is not safe either: "ATK" and "ATK%" both collapse to `ATK`. The
 *   Chinese name is therefore the one true identifier, as in the demo.
 *
 * NOT included, deliberately: the ENEMY panel (`defShred`, `enemyRes*`,
 * `resShred*`, `enemyLevel`). Those belong to the enemy, not to this character,
 * and a symbol that reads them would make one buff mean different things on
 * different entries. Also excluded: anything a buff itself produces -- the scope
 * is closed.
 */
export const SYMBOLS = [
  ...DERIVED_KEYS.map((key) => ({
    name: STAT_META[key]?.chs || key,
    en: STAT_META[key]?.en || key,
    key,
    kind: 'panel',
  })),
  { name: '总生命值', en: 'Total HP', key: 'hp', kind: 'total' },
  { name: '总攻击力', en: 'Total ATK', key: 'atk', kind: 'total' },
  { name: '总防御力', en: 'Total DEF', key: 'def', kind: 'total' },
  ...IDENTITY.map((i) => ({ ...i, kind: 'identity' })),
];

/** Lookup of a symbol by its identifier (the Chinese `name`). */
const byName = new Map(SYMBOLS.map((s) => [s.name, s]));

/** The symbol record for `name`, or `undefined`. */
export const symbolByName = (name) => byName.get(name);

/**
 * The closed scope: `name -> number`, from a derived panel and a unit's identity.
 *
 * @param {object} panel     Output of `derivePanel().values` (or the same shape).
 *                           Reads the fields it knows; anything absent is 0.
 * @param {object} [identity] `{ level, constellation, talents, refine, rarity }`.
 * @returns {Record<string, number>}
 */
export function scopeFor(panel, identity = {}) {
  const p = panel || {};
  const tal = identity.talents || {};
  const scope = {};
  for (const s of SYMBOLS) {
    if (s.kind === 'panel') scope[s.name] = Number(p[s.key]) || 0;
    else if (s.kind === 'total') scope[s.name] = TOTALS[s.key](p);
    else scope[s.name] = 0;
  }
  // The identity fields are filled from the SAME table the symbols were built
  // from, so a field added to IDENTITY cannot go missing here.
  const idValues = {
    level: identity.level,
    constellation: identity.constellation,
    talentNormal: tal.normal,
    talentSkill: tal.skill,
    talentBurst: tal.burst,
    refine: identity.refine,
    rarity: identity.rarity,
  };
  for (const s of IDENTITY) scope[s.name] = Number(idValues[s.key]) || 0;
  return scope;
}

/**
 * The identity fields, pulled off a team UNIT and its loaded catalogue entries.
 *
 * The PANEL half of the scope is NOT here: it comes from `derivePanel()`, which
 * needs the character's detail file and the weapon catalogue, both loaded
 * asynchronously by the caller. This function only gathers the fields that live
 * on the unit itself, so the two halves can be combined by whoever has both.
 *
 * @param {object} unit      A unit from the team document.
 * @param {object} [ctx]     `{ char }` catalogue entry, for rarity.
 */
export function identityOf(unit, ctx = {}) {
  const talents = unit?.char?.talents || {};
  return {
    level: unit?.char?.level,
    constellation: unit?.char?.constellation,
    talents,
    refine: unit?.weapon?.refine,
    // The catalogue spells quality as `QUALITY_ORANGE` / `QUALITY_PURPLE`, not a
    // number. Only an explicit 5-star is 5; anything else is left to the caller's
    // own record rather than guessed, since the panel does not need it.
    rarity: ctx.char?.qualityType === 'QUALITY_ORANGE' ? 5
      : ctx.char?.qualityType === 'QUALITY_PURPLE' ? 4
      : 0,
  };
}

/**
 * The scope for a TEAM entry, derived end to end.
 *
 * The team the planner holds is the flattened shape (`useTeamChoices`): a
 * character id, a level, an element, a weapon id and the artifacts, PLUS the
 * `detail` file the axis attaches. That is everything `derivePanel` needs, so a
 * caller holding a team entry can resolve a formula without doing the derivation
 * itself.
 *
 * A unit whose detail file has not arrived yields the empty panel's scope (all
 * zeros), exactly as `derivePanel` reports rather than invents -- a formula over
 * it resolves to 0, and the card that shows it says the character is not loaded.
 *
 * @param {object} entry      A team entry (`useTeamChoices` shape).
 * @param {object} catalogue  The loaded catalogue, for the weapon's own stats.
 */
export function scopeForUnit(entry, catalogue) {
  if (!entry) return scopeFor({}, {});
  const detail = entry.detail || null;
  const identity = {
    level: entry.level,
    constellation: entry.constellation,
    talents: entry.talents,
    refine: entry.refine,
    rarity: entry.qualityType === 'QUALITY_ORANGE' ? 5
      : entry.qualityType === 'QUALITY_PURPLE' ? 4
      : 0,
  };
  if (!detail) return scopeFor({}, identity);
  const weapon = entry.weaponId ? catalogue?.weapons?.[entry.weaponId] || null : null;
  const { values } = derivePanel({
    charId: entry.id,
    detail,
    level: entry.level,
    element: entry.element,
    weaponId: entry.weaponId,
    weapon,
    artifacts: entry.artifacts,
    stats: catalogue?.stats,
  });
  return scopeFor(values, identity);
}

/* ------------------------------------------------------------- parsing */

/** The error a bad formula carries, with the offset it failed at. */
export function FormulaError(message, at) {
  const e = new Error(message);
  e.name = 'FormulaError';
  e.at = at || 0;
  return e;
}

/**
 * Text -> tokens.
 *
 * AN IDENTIFIER RUNS TO THE NEXT OPERATOR, BRACKET OR SPACE, so `$总攻击力*0.15`
 * and `$ATK * 0.15` both work. The same rule is used by the autocomplete, so what
 * is offered is exactly what would be parsed.
 */
export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i += 1; continue; }
    if ('+-*/()'.indexOf(c) >= 0) { out.push({ t: c, at: i }); i += 1; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1;
      const text = src.slice(i, j);
      const n = Number(text);
      if (!Number.isFinite(n)) throw FormulaError('不是合法的数字：' + text, i);
      out.push({ t: 'num', v: n, at: i });
      i = j;
      continue;
    }
    if (c === '$') {
      let k = i + 1;
      while (k < src.length && '+-*/() \t\n'.indexOf(src[k]) < 0) k += 1;
      const name = src.slice(i + 1, k);
      if (!name) throw FormulaError('$ 后面缺少名字', i);
      out.push({ t: 'sym', name, at: i });
      i = k;
      continue;
    }
    throw FormulaError('不认识的字符：' + c, i);
  }
  return out;
}

/** Tokens -> an AST. Recursive descent, the demo's grammar verbatim. */
export function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (tokens[p] && tokens[p].t === t) { p += 1; return true; } return false; };

  function expr() {
    let left = term();
    for (;;) {
      if (eat('+')) left = { op: '+', l: left, r: term() };
      else if (eat('-')) left = { op: '-', l: left, r: term() };
      else return left;
    }
  }
  function term() {
    let left = unary();
    for (;;) {
      if (eat('*')) left = { op: '*', l: left, r: unary() };
      else if (eat('/')) left = { op: '/', l: left, r: unary() };
      else return left;
    }
  }
  function unary() {
    if (eat('-')) return { op: 'neg', v: unary() };
    if (eat('+')) return unary();
    return atom();
  }
  function atom() {
    const tk = peek();
    if (!tk) throw FormulaError('公式不完整', 0);
    if (tk.t === 'num') { p += 1; return { num: tk.v }; }
    if (tk.t === 'sym') { p += 1; return { sym: tk.name, at: tk.at }; }
    if (tk.t === '(') {
      p += 1;
      const inner = expr();
      if (!eat(')')) throw FormulaError('缺少右括号', tk.at);
      return inner;
    }
    throw FormulaError('这里不该出现 ' + tk.t, tk.at);
  }

  const tree = expr();
  if (p < tokens.length) throw FormulaError('公式末尾有多余内容', tokens[p].at);
  return tree;
}

/** Is `v` a formula (leading `=`, ignoring leading whitespace)? */
export const isFormula = (v) => typeof v === 'string' && v.replace(/^\s+/, '').charAt(0) === '=';

/** What a formula reads, without evaluating it. */
export function analyse(text) {
  const src = String(text == null ? '' : text).replace(/^\s+/, '').replace(/^=/, '');
  if (!src) return { ok: false, tree: null, symbols: [], error: '空公式' };
  try {
    const tree = parse(tokenize(src));
    const symbols = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.sym) symbols.push(n.sym);
      walk(n.l); walk(n.r); walk(n.v);
    })(tree);
    const uniq = [];
    for (const s of symbols) if (!uniq.includes(s)) uniq.push(s);
    return { ok: true, tree, symbols: uniq, error: null };
  } catch (err) {
    return { ok: false, tree: null, symbols: [], error: err.message, at: err.at };
  }
}

/**
 * Evaluate a formula against a scope. Returns a RESULT, never a bare number.
 *
 * An unknown symbol is refused BY NAME rather than treated as 0: a 0 would keep
 * the buff alive at the wrong value, which is the silent-wrong-number failure
 * this module exists to rule out.
 */
export function evaluate(text, scope) {
  const a = analyse(text);
  if (!a.ok) return { ok: false, value: null, error: a.error, unknown: [] };

  // A MISSING scope is not an error to throw on -- it is a scope that resolves
  // nothing. This is the state a page with no team behind it (the library editor)
  // is in, and a formula there must read as unresolved rather than crash a render.
  const s = scope || {};
  const unknown = a.symbols.filter((name) => !(name in s));
  if (unknown.length) {
    return { ok: false, value: null, error: '不认识的符号：' + unknown.join('、'), unknown };
  }

  function run(n) {
    if (n.num !== undefined) return n.num;
    if (n.sym !== undefined) return s[n.sym];
    switch (n.op) {
      case '+': return run(n.l) + run(n.r);
      case '-': return run(n.l) - run(n.r);
      case '*': return run(n.l) * run(n.r);
      case '/': {
        const d = run(n.r);
        if (d === 0) throw FormulaError('除以零');
        return run(n.l) / d;
      }
      case 'neg': return -run(n.v);
      default: throw FormulaError('无法计算的表达式');
    }
  }

  try {
    const value = run(a.tree);
    if (!Number.isFinite(value)) return { ok: false, value: null, error: '结果不是有限数', unknown: [] };
    return { ok: true, value, error: null, unknown: [] };
  } catch (err) {
    return { ok: false, value: null, error: err.message, unknown: [] };
  }
}

/** A plain number, as a RESULT: clean digits, or an error. Never reconstructed. */
const PLAIN_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
export function plainNumber(text) {
  const s = String(text == null ? '' : text).trim();
  if (s === '') return { ok: true, value: 0, error: null, unknown: [] };
  if (!PLAIN_RE.test(s)) {
    return { ok: false, value: null, error: '不是合法的数字：' + text, unknown: [] };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, value: null, error: '结果不是有限数', unknown: [] };
  return { ok: true, value: n, error: null, unknown: [] };
}

/** Resolve ANY value -- number or formula -- to a RESULT, never a bare number. */
export function resolve(text, scope) {
  return isFormula(text) ? evaluate(text, scope) : plainNumber(text);
}

/** The number a value stands for, or `NaN` when it does not resolve. */
export function valueOf(text, scope) {
  const r = resolve(text, scope);
  return r.ok ? r.value : NaN;
}

/* --------------------------------------------------------- autocomplete */

/**
 * The `$partial` the caret sits in, or `null` when it is not in one.
 *
 * A name runs to the next operator, bracket or space -- THE SAME RULE the
 * tokenizer uses, so what the list offers is exactly what would be parsed. The
 * `-` is included because it ends a name too; a `$` inside the fragment means the
 * caret is in a NEWER name, so the last `$` wins.
 */
export function partialAt(value, caret) {
  const upto = String(value ?? '').slice(0, caret);
  const dollar = upto.lastIndexOf('$');
  if (dollar < 0) return null;
  const frag = upto.slice(dollar + 1);
  if (/[+*\/() \t\n-]/.test(frag)) return null;
  return { from: dollar, to: caret, text: frag };
}

/**
 * The symbols whose name starts with `frag`, each with its CURRENT value.
 *
 * SHOWING THE VALUE is what makes `$攻击力` and `$总攻击力` choosable by eye -- the
 * names differ by one character, and picking the wrong one is a silently wrong
 * buff.
 */
export function matchesFor(frag, scope) {
  const f = String(frag ?? '');
  const s = scope || {};
  return SYMBOLS
    .filter((sym) => sym.name.indexOf(f) === 0)
    .map((sym) => ({ name: sym.name, en: sym.en, kind: sym.kind, value: Number(s[sym.name]) || 0 }));
}
