// Reading artifacts out of a screenshot: the PURE half of the scan.
//
// THE SPLIT
//   The request, and where it is sent, live in `vision-client.js` and
//   `vision-config.js`. This file is everything that can be decided WITHOUT a
//   network: the instruction handed to the model, the tolerant reading of its
//   answer, and -- the part that matters -- the translation from the WORDS ON
//   SCREEN to the keys this app stores.
//
// WHY THE MODEL IS NOT ASKED FOR THIS APP'S KEYS
//   A model asked for `"key": "hpPct"` is guessing at an internal vocabulary it
//   has never seen, and a wrong guess is invisible: a plausible-looking number
//   lands in a row and every total built on it is quietly wrong. So the model is
//   asked for what the PICTURE says (`攻击力 7.0%`, `生命值+239`), and the
//   translation happens here, in tables a test can read. Those same words are
//   what the review table shows, so the user checks the model's reading rather
//   than this file's guesswork.
//
// TWO NAMES, ONE SET (why a screenshot's title is not a set name)
//   A 5-star set names all five of its pieces -- 授予你的年华, 风花的箴铭 -- and
//   the in-game detail panel titles the PIECE, not the set: the set name sits on
//   the green 2-piece/4-piece line below it (`血红之证: (4)`). Both are
//   recognised, and the catalogue carries the per-piece names, so a screenshot
//   showing only one of the two still resolves. See `resolveSet` -- and note the
//   enhance screen shows NO set name at all, only `时之沙 / 授予你的年华`.
//
// THE GAME'S DISPLAY IS LOSSY, AND THE CHECK HAS TO BE TOO
//   A substat total is shown rounded: one decimal for a percentage (`3.1%` is
//   the exact 3.112) and a whole number for a flat (`19` is the exact 19.45,
//   `21` is 20.979). Comparing a transcribed figure against the EXACT tiers in
//   `substat-rolls.js` would reject most real values -- `19` is 0.45 away from
//   its own legal total -- so legality here is compared on the DISPLAYED form
//   (`displayOf`), and the review table offers the exact total as the thing to
//   STORE, because a total is a sum and the rounding is not free.
//
// NOTHING FALLS BACK TO A DEFAULT
//   A slot, set or stat that cannot be placed resolves to `null` plus an entry
//   in `issues`, never to a plausible-looking guess. The review step exists
//   because this CAN be wrong; a silent default would make it wrong invisibly.

import {
  ARTIFACT_LEVEL_MAX, ARTIFACT_LEVEL_MIN, MAIN_STATS, SLOT_KEYS, SUB_COUNT,
  mainStatValue,
} from './artifact-model';
import { DEFAULT_RARITY, asNumber, legalTotals } from './substat-rolls';
import { statMeta } from './artifact-meta';
import { qualityOf } from '../game';

/* ------------------------------------------------------------------ prompt */

/**
 * The instruction sent with the image.
 *
 * IT ASKS FOR THE SCREEN'S WORDS, NOT FOR KEYS (see the header), and it names
 * the three things that actually go wrong on a real screenshot:
 *
 *   - a busy frame: a Genshin screenshot carries a performance overlay, a bag
 *     grid, character art and buttons. The model is told to ignore all of it;
 *   - `待激活`: a +0 piece can show a substat that has not activated yet. It IS
 *     part of the piece and will activate at +4, so it counts as a substat;
 *   - two names for the set: the piece title and the green set line above.
 *
 * The example is a real screenshot's values, which is deliberate -- a
 * format-example a model can copy beats a paragraph describing one.
 */
export const SCAN_PROMPT = [
  '你是《原神》圣遗物识别助手。输入是一张游戏截图，可能是一个圣遗物详情弹窗、强化界面，或角色/背包圣遗物列表里的某一件。',
  '只识别「这件圣遗物本身」，忽略屏幕上其它内容：性能条（FPS/CPU/GPU）、道具栏、角色立绘、按钮、任务文本、套装效果的长描述、以及列表里没被选中的其它圣遗物。',
  '',
  '只输出 JSON，不要解释，不要输出 JSON 以外的任何文字：',
  '{"pieces":[{"pieceName":"献与月的酹祭","set":"晨星与月的晓歌","slot":"空之杯","level":0,"main":{"name":"水元素伤害加成","value":7.0},"subs":[{"name":"暴击率","value":3.5},{"name":"防御力","value":5.8},{"name":"暴击伤害","value":7.8},{"name":"生命值","value":239}]}]}',
  '',
  '字段说明：',
  '- pieceName：这一件自己的名字（详情弹窗顶部大标题，或强化页左上「时之沙 / 授予你的年华」里的名字）。看不清就省略。',
  '- set：套装名（详情里绿字「血红之证: (4)」冒号前的名字）。看不清就省略。',
  '- slot：部位原文：生之花 / 死之羽 / 时之沙 / 空之杯 / 理之冠。',
  '- level：强化等级 +N 里的 N（0-20）。没有 +N 就省略。',
  '- main：主词条。name 写图上原文（百分比要保留 %），value 只写数字。',
  '- subs：副词条，最多 4 条，按图上从上到下的顺序；标着「待激活」的也要算一条，名字里不用写这几个字。',
  '',
  '数值只写数字：不要单位、不要千分位。看不清的字段直接省略，不要编造。',
  '一张图里有好几件时（例如背包列表），每件输出一个对象。',
].join('\n');

/* ------------------------------------------------------------------ parsing */

/** `undefined`/`null` -> `''`, everything else trimmed. */
const text = (v) => String(v ?? '').trim();

/** Whitespace, and the punctuation a model sprinkles around a name. */
function normalize(value) {
  return text(value)
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』《》<>～~!！?？、，,。.·:：;；'"`]/g, '')
    .toLowerCase();
}

/**
 * The JSON in a model's reply.
 *
 * Tolerant on purpose: a chat model wraps its answer in a ```json fence about
 * half the time, and prefixes it with "好的，这是识别结果：" the other half. The
 * first `{` or `[` to the matching last one covers both, and neither a fence nor
 * a preamble changes what the JSON is.
 */
function extractJson(reply) {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : reply;
  const start = src.search(/[[{]/);
  if (start < 0) return null;
  const close = src[start] === '{' ? '}' : ']';
  const end = src.lastIndexOf(close);
  return end > start ? src.slice(start, end + 1) : null;
}

/**
 * A model reply as `{ pieces: [...] }`.
 *
 * Throws with what went wrong rather than returning an empty list: "the model
 * answered prose" and "the picture had no artifacts in it" are different
 * problems, and only one of them is worth re-running.
 */
export function parseScanResponse(reply) {
  const json = extractJson(String(reply ?? ''));
  if (!json) throw new Error('模型返回里找不到 JSON');

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`模型返回的 JSON 解析失败：${e.message}`);
  }

  const pieces = Array.isArray(parsed)
    ? parsed
    : parsed?.pieces ?? parsed?.artifacts ?? parsed?.items;
  if (!Array.isArray(pieces)) throw new Error('模型返回里没有 pieces 数组');
  return { pieces };
}

/* -------------------------------------------------------------- slot lookup */

/** Every way a slot is written, Chinese first and the English name as backup. */
const SLOT_ALIASES = {
  flower: ['生之花', 'flower', '花'],
  plume: ['死之羽', 'plume', '羽'],
  sands: ['时之沙', 'sands', '沙'],
  goblet: ['空之杯', 'goblet', '杯'],
  circlet: ['理之冠', 'circlet', '冠'],
};

/** The slot key a piece of on-screen text names, or null. */
export function matchSlot(raw) {
  const n = normalize(raw);
  if (!n) return null;
  for (const key of SLOT_KEYS) {
    const aliases = [...SLOT_ALIASES[key]].sort((a, b) => b.length - a.length);
    if (aliases.some((a) => n.includes(a))) return key;
  }
  return null;
}

/* -------------------------------------------------------------- stat lookup */

/**
 * Marks the game puts beside a substat, which are not part of its name.
 *
 * `待激活` is a +0 piece's fourth line: present on the piece, not yet counting.
 * It is accepted as a real substat (it activates at +4 and the build will need
 * it), so only the MARKER is dropped.
 */
const MARKERS = /[（(【[]\s*(待激活|未激活|新|已锁定|锁定)\s*[）)】\]]/g;

const stripMarkers = (value) => text(value).replace(MARKERS, '').trim();

/** Whether a name says "percent" -- by the sign, or by the word the game uses. */
const hasPercent = (raw) => /[%％]|加成|百分比/.test(text(raw));

/** Element key -> the character its damage bonus is written with. */
const ELEMENT_CHAR = {
  pyro: '火', hydro: '水', cryo: '冰', electro: '雷',
  anemo: '风', geo: '岩', dendro: '草',
};

/**
 * Name -> key, LONGEST ALIAS FIRST.
 *
 * The order is what makes `攻击力加成` an ATK% and `元素充能效率` an ER rather
 * than an EM: both pairs share a prefix, so the shorter alias would win a naive
 * scan. Sorting by length at module load means adding an alias cannot silently
 * break a longer one that already existed.
 */
const STAT_ALIASES = [
  ['元素充能效率', 'er'], ['元素充能', 'er'], ['充能效率', 'er'], ['充能', 'er'],
  ['元素精通', 'em'], ['精通', 'em'],
  ['暴击伤害', 'critDmg'], ['暴击率', 'critRate'],
  ['治疗加成', 'healBonus'], ['治疗', 'healBonus'],
  ['物理伤害加成', 'physBonus'], ['物理伤害', 'physBonus'], ['物伤', 'physBonus'], ['物理', 'physBonus'],
  ...Object.entries(ELEMENT_CHAR).flatMap(([key, zh]) => [
    [`${zh}元素伤害加成`, `${key}Dmg`],
    [`${zh}元素伤害`, `${key}Dmg`],
    [`${zh}元素`, `${key}Dmg`],
    [`${zh}伤`, `${key}Dmg`],
  ]),
  ['伤害加成', 'dmgBonus'],
  ['生命值', 'hp'], ['攻击力', 'atk'], ['防御力', 'def'],
  ['生命', 'hp'], ['攻击', 'atk'], ['防御', 'def'],
  // The English panel, for a model answering in English.
  ['energyrecharge', 'er'], ['elementalmastery', 'em'],
  ['critrate', 'critRate'], ['critdmg', 'critDmg'],
  ['healingbonus', 'healBonus'], ['physicaldmgbonus', 'physBonus'], ['physical', 'physBonus'],
  ['alldmgbonus', 'dmgBonus'],
  ...Object.keys(ELEMENT_CHAR).map((key) => [`${key}dmg`, `${key}Dmg`]),
  ['hp', 'hp'], ['atk', 'atk'], ['def', 'def'],
].sort((a, b) => b[0].length - a[0].length);

/**
 * The keys a name could mean, BEST FIRST.
 *
 * Only HP/ATK/DEF are ever ambiguous, because a flat and a percentage stat are
 * written almost the same way -- `生命值` and `生命值%`. Which one it is has to
 * be settled by evidence ("%" in the name, or the value, or the slot), so the
 * caller gets both candidates and the evidence decides; see `resolveSubstat`
 * and `resolveMainStat`.
 */
export function statCandidates(rawName) {
  const name = normalize(stripMarkers(rawName));
  if (!name) return [];
  const hit = STAT_ALIASES.find(([alias]) => name.includes(alias));
  if (!hit) return [];
  const key = hit[1];
  if (key === 'hp' || key === 'atk' || key === 'def') {
    const pct = `${key}Pct`;
    return hasPercent(rawName) ? [pct, key] : [key, pct];
  }
  return [key];
}

/* ------------------------------------------------------- displayed legality */

/** Whether a stat is shown with a decimal (a percentage) or as a whole number. */
export const isPercentStat = (key) => statMeta(key)?.suffix === '%';

/**
 * The number the GAME would print for a value of `value`.
 *
 * Verified against the four screenshots this was built from, which cover both
 * sides of the rounding: `元素精通+21` is the exact 20.979 (so: rounded, not
 * truncated), and `攻击力+19` is the exact 19.45.
 */
export function displayOf(key, value) {
  const n = asNumber(value);
  if (n == null) return null;
  return isPercentStat(key) ? Math.round(n * 10) / 10 : Math.round(n);
}

/**
 * The legal total that the game would SHOW as `value`, or null.
 *
 * A displayed figure can be reached by more than one exact total at this
 * precision, so the closest one wins -- and what the caller stores is
 * `entry.value`, the exact figure, not the rounded one it was read from.
 */
export function matchDisplayed(key, rarity, value) {
  const shown = displayOf(key, value);
  if (shown == null) return null;
  const n = asNumber(value);
  let best = null;
  for (const entry of legalTotals(key, rarity) || []) {
    if (displayOf(key, entry.value) !== shown) continue;
    if (!best || Math.abs(entry.value - n) < Math.abs(best.value - n)) best = entry;
  }
  return best;
}

/** Whether the game could show this exact figure for this stat. */
export const isLegalDisplay = (key, rarity, value) => matchDisplayed(key, rarity, value) != null;

/* ------------------------------------------------------------- stat resolve */

/**
 * The main stat a name + slot mean, or null.
 *
 * THE SLOT SETTLES IT. Only a Flower and a Plume can roll a flat main stat, so
 * `攻击力` written on a Sands can only be ATK% -- the game's panel omits the `%`
 * on its own header line (see the 强化 screen), which is exactly the case that
 * would otherwise land a 22.8% as a flat +22.8 ATK.
 */
export function resolveMainStat(rawName, slotKey) {
  const keys = statCandidates(rawName);
  if (!keys.length) return { key: null, ambiguous: false };
  if (keys.length === 1) return { key: keys[0], ambiguous: false };

  const pool = MAIN_STATS[slotKey] || [];
  const allowed = keys.filter((k) => pool.includes(k));
  if (allowed.length >= 1) return { key: allowed[0], ambiguous: false };
  // No slot to lean on (or neither candidate fits it): the first one is offered
  // and the caller flags it, because a wrong guess here moves every total.
  return { key: keys[0], ambiguous: true };
}

/**
 * The substat a name + value mean, by VALUE when the name is ambiguous.
 *
 * `生命值+239` and `生命值+4.7%` are the same words, and the number is the only
 * evidence that separates them: 239 is a legal flat HP roll and no legal HP%,
 * while 4.7 is the reverse. `ambiguous` reports the cases where the value could
 * not decide either, so the review table can say so rather than looking certain.
 */
export function resolveSubstat(rawName, value, rarity = DEFAULT_RARITY) {
  const keys = statCandidates(rawName);
  if (!keys.length) return { key: null, ambiguous: false };
  if (keys.length === 1) return { key: keys[0], ambiguous: false };

  const legal = keys.find((k) => isLegalDisplay(k, rarity, value));
  if (legal) return { key: legal, ambiguous: false };
  return { key: keys[0], ambiguous: true };
}

/* -------------------------------------------------------------- set resolve */

/**
 * Drop everything a set name is never stored with.
 *
 * The green header on a detail panel reads `风起之日: (5)`, and a model copying
 * it verbatim would otherwise fail an equality test against `风起之日` by four
 * characters. Bracketed asides go first (so `（5件套）` leaves nothing behind),
 * then the filler words, then any stray digit -- safe because NONE of the 66
 * names in the catalogue contains a bracket or a digit.
 */
const stripSetWords = (value) =>
  normalize(value)
    .replace(/[（(【[][^）)】\]]*[）)】\]]/g, '')
    .replace(/(套装|件套|效果|setbonus|set)/g, '')
    .replace(/[0-9]/g, '');

/** Character-bigram overlap, 0..1. Cheap, symmetric, no dependency. */
function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return b.includes(a) || a.includes(b) ? 0.5 : 0;

  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let shared = 0;
  let total = 0;
  for (const [g, n] of A) { total += n; shared += Math.min(n, B.get(g) || 0); }
  for (const n of B.values()) total += n;
  return total ? (2 * shared) / total : 0;
}

/**
 * The set named by on-screen text, or null.
 *
 * Three passes, most-certain first: the name as written, then a containment
 * either way (a model may append 套装, or clip a character), then a similarity
 * threshold. A single containment hit is taken as certain -- `风起之日` is
 * contained in exactly one of the 66 names -- while a similarity hit is only
 * ever `fuzzy`, so the review table can say the match was a guess.
 */
export function matchSetByName(raw, list = []) {
  const needle = stripSetWords(raw);
  if (!needle) return { set: null, match: 'none' };

  const named = list.map((set) => ({
    set,
    names: [stripSetWords(set.chsName), stripSetWords(set.enName)].filter(Boolean),
  }));

  const exact = named.find((c) => c.names.includes(needle));
  if (exact) return { set: exact.set, match: 'exact' };

  const partial = named.filter((c) => c.names.some((n) => n.includes(needle) || needle.includes(n)));
  if (partial.length === 1) return { set: partial[0].set, match: 'fuzzy' };

  let best = null;
  let score = 0;
  for (const c of named) {
    for (const n of c.names) {
      const d = similarity(needle, n);
      if (d > score) { score = d; best = c.set; }
    }
  }
  return score >= 0.6 ? { set: best, match: 'fuzzy' } : { set: null, match: 'none' };
}

/**
 * The set a PIECE NAME belongs to, or null.
 *
 * This is the route that saves the enhance screen, which shows no set name at
 * all. A 5-star set names each of its five pieces, and the catalogue carries
 * those names, so `授予你的年华` alone identifies 血红之证.
 */
export function matchSetByPiece(pieceName, { list = [], sets = {}, slotKey = null } = {}) {
  const needle = normalize(pieceName);
  if (!needle) return { set: null, match: 'none' };

  const slots = slotKey ? [slotKey] : SLOT_KEYS;
  const names = (set) =>
    slots.map((k) => normalize(sets?.[set.id]?.pieces?.[k]?.name)).filter(Boolean);

  const exact = list.find((set) => names(set).includes(needle));
  if (exact) return { set: exact, match: 'exact' };

  const loose = list.find((set) => names(set).some((n) => n.includes(needle) || needle.includes(n)));
  return loose ? { set: loose, match: 'fuzzy' } : { set: null, match: 'none' };
}

/**
 * Whichever name is available identifies the set: the set name first (it is the
 * one that is certain), then the piece name.
 *
 * `by` says which one answered, so the review table can show the user what it
 * matched on -- a set matched from a piece name is worth a second look in a way
 * a set matched by its own name is not.
 */
export function resolveSet({ setRaw, pieceRaw, slotKey } = {}, { list = [], sets = {} } = {}) {
  const byName = matchSetByName(setRaw, list);
  if (byName.set) return { ...byName, by: 'set' };

  const byPiece = matchSetByPiece(pieceRaw, { list, sets, slotKey });
  if (byPiece.set) return { ...byPiece, by: 'piece' };

  return { set: null, match: 'none', by: null };
}

/* ------------------------------------------------------------------- rows */

/** `+8`, `8`, `+ 8` -> 8, clamped to 0..20. Null when unreadable. */
function normLevel(value) {
  const n = asNumber(value);
  if (n == null) return null;
  return Math.max(ARTIFACT_LEVEL_MIN, Math.min(ARTIFACT_LEVEL_MAX, Math.round(n)));
}

/**
 * One recognised artifact as the review table edits it.
 *
 * Everything the model said is kept BESIDE the mapping it produced (`mainRaw`
 * next to `mainStat`, `setRaw` next to `setId`), because that pair is the thing
 * a human can check. A row carries `issues` so a doubtful mapping is visible
 * without opening anything, and `include` so it can be applied or not.
 */
function scanRow(raw, index, { list, sets }) {
  const slotRaw = text(raw?.slot ?? raw?.position ?? raw?.part);
  const slotKey = matchSlot(slotRaw);
  const setRaw = text(raw?.set ?? raw?.setName);
  const pieceRaw = text(raw?.pieceName ?? raw?.piece ?? raw?.name);
  const level = normLevel(raw?.level ?? raw?.lv) ?? 0;

  const mainRaw = text(raw?.main?.name ?? raw?.main?.key ?? raw?.mainStat);
  const mainValue = asNumber(raw?.main?.value ?? raw?.mainValue);

  const { set, match: setMatch, by: setBy } = resolveSet({ setRaw, pieceRaw, slotKey }, { list, sets });
  const rarity = set?.qualityType ? qualityOf(set.qualityType).stars || DEFAULT_RARITY : DEFAULT_RARITY;

  const { key: mainStat, ambiguous: mainAmbiguous } = resolveMainStat(mainRaw, slotKey);
  const mainExpected = mainStat ? mainStatValue(mainStat, level) : null;

  const said = Array.isArray(raw?.subs) ? raw.subs
    : Array.isArray(raw?.subStats) ? raw.subStats
    : Array.isArray(raw?.substats) ? raw.substats
    : [];

  const subStats = said.slice(0, SUB_COUNT).map((sub) => {
    const name = text(sub?.name ?? sub?.key);
    const value = asNumber(sub?.value);
    const { key, ambiguous } = resolveSubstat(name, value, rarity);
    const exact = key ? matchDisplayed(key, rarity, value) : null;
    return {
      key,
      // What to STORE: the exact total behind the printed figure (19.45, not 19).
      value: exact?.value ?? value,
      // What the input shows while it is being edited: the figure as printed.
      // Keeping the two apart is what stops a typed `1` snapping to `209` under
      // the cursor, while still storing the exact total once it is a real roll.
      typed: value == null ? '' : String(value),
      raw: name,
      exact: exact?.value ?? null,
      legal: key ? !!exact : null,
      ambiguous,
    };
  });
  while (subStats.length < SUB_COUNT) {
    subStats.push({ key: null, value: null, typed: '', raw: '', exact: null, legal: null, ambiguous: false });
  }

  const issues = [];
  if (!slotKey) issues.push(slotRaw ? `部位没认出（“${slotRaw}”）` : '没读到部位');
  if (!set) issues.push(setRaw || pieceRaw ? `套装没认出（“${setRaw || pieceRaw}”）` : '没读到套装');
  if (!mainStat) issues.push('主词条没认出');
  else if (slotKey && !(MAIN_STATS[slotKey] || []).includes(mainStat)) {
    issues.push('主词条不属于这个部位');
  }
  if (mainStat && mainValue != null && mainExpected != null
      && Math.abs(displayOf(mainStat, mainValue) - mainExpected) > 1e-9) {
    issues.push(`主词条数值和等级对不上（图上 ${mainValue}，+${level} 应为 ${mainExpected}）`);
  }
  if (mainAmbiguous) issues.push('主词条有歧义（固定值 / 百分比）');
  if (subStats.some((s) => s.raw && !s.key)) issues.push('有副词条没认出词条名');
  if (subStats.some((s) => s.key && s.legal === false)) issues.push('有副词条不是合法强化值');
  if (subStats.some((s) => s.ambiguous && s.raw)) issues.push('有副词条词条名有歧义（按数值推断）');

  return {
    id: `scan-${index}`,
    include: !!(slotKey && mainStat),
    slotKey,
    slotRaw,
    setId: set?.id ?? null,
    setMatch,
    setBy,
    setRaw,
    pieceRaw,
    rarity,
    level,
    mainStat,
    mainRaw,
    mainValue,
    mainExpected,
    subStats,
    issues,
  };
}

/** A parsed reply as editable rows, in the order the model listed them. */
export function buildScanRows(payload, { list = [], sets = {} } = {}) {
  const pieces = Array.isArray(payload?.pieces) ? payload.pieces : [];
  return pieces.map((raw, i) => scanRow(raw, i, { list, sets }));
}

/**
 * The build with the ticked rows written into it.
 *
 * ONE ROW PER SLOT: two ticked rows claiming the same slot would leave whichever
 * came last, silently, so the later one is skipped and reported instead. Slots
 * no row claims are left ALONE rather than blanked -- scanning one piece out of
 * a screenshot is a normal way to use this, and it must not clear the other four
 * the user already had.
 */
export function applyScanRows(build, rows) {
  const next = { ...(build || {}) };
  const applied = [];
  const ignored = [];

  for (const row of rows || []) {
    if (!row?.include) continue;
    if (!row.slotKey || !row.mainStat) { ignored.push(row.id); continue; }
    if (applied.includes(row.slotKey)) { ignored.push(row.id); continue; }
    applied.push(row.slotKey);
    next[row.slotKey] = {
      setId: row.setId ?? null,
      mainStat: row.mainStat,
      level: row.level ?? 0,
      subStats: Array.from({ length: SUB_COUNT }, (_, i) => {
        const sub = row.subStats?.[i];
        return sub?.key ? { key: sub.key, value: sub.value ?? 0 } : null;
      }),
    };
  }

  return { build: next, applied, ignored };
}
