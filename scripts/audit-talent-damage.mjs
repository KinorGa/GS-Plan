// Generate the DRAFT of `public/data/talent-damage.json` -- the curated list of
// talents and constellations that deal damage in their own right.
//
// WHY THIS IS OFFLINE AND NOT RUNTIME
//
// The damage card needs to know which constellations/passives are hits so it can
// offer them as sources. Nothing in the dataset states that reliably:
//
//   - `params[0] * 100` is right about 60% of the time even on the clean subset,
//     and wrong by 5x and more when it is wrong (可莉 C4 states 555%, params[0]=1).
//     The index is not stable either -- 香菱's real number is at params[2], the
//     旅行者's 异邦 passives put theirs at params[7].
//   - `attacks` carries per-constellation entries for 32 characters, but ZERO of
//     them have a numeric value: every `damageParam` is an unresolvable symbol
//     like "Klee_Constellation_4_Damage". 法尔伽 has no entry at all.
//
// So the judgement is made ONCE, here, and written to a file a human can read and
// correct. Runtime only reads that file. This script's regex is a DRAFTING AID --
// it proposes, it does not decide, and its output is meant to be reviewed.
//
// Usage:  node scripts/audit-talent-damage.mjs [--out path] [--all]
//   default  only entries whose multiplier is stated explicitly are `damage: true`
//   --all    enable every candidate the prose filter accepts (not recommended)

import fs from 'node:fs';
import path from 'node:path';
import { parseSlot } from '../src/char-sources.js';

const ROOT = process.cwd();
const CHAR_DIR = path.join(ROOT, 'public', 'data', 'char', 'chs');
const DEFAULT_OUT = path.join(ROOT, 'public', 'data', 'talent-damage.json');

const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : DEFAULT_OUT;
const enableAll = args.includes('--all');

/** Strip the markup the dataset wraps descriptions in. */
const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\{LINK#[^}]+\}/g, '')
    .replace(/\{\/LINK\}/g, '')
    .replace(/\\n/g, ' ')
    .trim();

const CN_ELEMENT = {
  物理: 'Physical',
  火: 'Pyro', 水: 'Hydro', 雷: 'Electro', 冰: 'Cryo', 风: 'Anemo', 岩: 'Geo', 草: 'Dendro',
};

/**
 * The multiplier the sentence states, as a fraction, or null.
 *
 * THE NUMBER MUST BELONG TO THE SAME CLAUSE AS THE HIT.
 *
 * A description is several sentences and clauses long, and a percentage in one of
 * them is usually about something else -- a buff, a stack count, a duration. A
 * regex over the whole string happily pairs "获得10%风元素伤害加成" with the
 * unrelated "造成原本140%的伤害" three clauses later and reports 10% as a hit.
 * Measured: that is exactly what happened to 法尔伽 p1 and 16 others.
 *
 * So the search runs CLAUSE BY CLAUSE -- split on the punctuation the dataset
 * uses -- and only accepts a number from a clause that itself describes dealing
 * damage.
 *
 * The `%` must also be attached to a stat name: a bare `X%` is far too often a
 * duration ("持续10秒"), a proc chance ("有50%的几率") or a shred ("抗性降低24%").
 * Only `X%攻击力` and friends are multipliers.
 */
const CLAUSE_SPLIT = /[，。；,;]/;

function statedScaling(desc) {
  // A clause is a candidate only if it is ABOUT dealing damage.
  const clauses = String(desc || '')
    .split(CLAUSE_SPLIT)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    // Must introduce a hit in THIS clause.
    if (!/造成|额外攻击/.test(clause)) continue;
    // AND THE HIT MUST BE THE CLAUSE'S POINT, not a noun inside a buff.
    //
    // "钟离的以下攻击造成的伤害提高：·普通攻击…提高值：生命值上限的1.39%" contains
    // 造成, but what it describes is a BONUS. The tell is the verb that governs the
    // damage: 提高/提升/加成 mean a buff, 造成 means a hit. Checking for the mere
    // presence of 造成 let six of these through as damage sources.
    //
    // `造成...的伤害提高` is the exact shape to reject; a genuine hit reads
    // `造成X%攻击力的...伤害` and never has 提高 after the damage noun.
    if (/伤害(提高|提升|加成|增加)/.test(clause)) continue;
    if (/提高值|提升值|加成值/.test(clause)) continue;
    // The same buff in the OTHER word order: "提升…造成的伤害：每1000点防御力都将
    // 提升4%伤害". Here 提升 comes FIRST and there is no "伤害提高" substring, so the
    // check above misses it. A clause that opens by improving something is a buff
    // however the rest is worded.
    if (/^(?:将|会|使|可)?\s*(提升|提高|增加|强化)/.test(clause)) continue;
    // 造成原本X%的伤害 scales an existing hit -- a buff, not a new source.
    if (/造成原本\s*\d/.test(clause)) continue;

    const patterns = [
      // 造成800%攻击力的风元素范围伤害
      /造成[^，。；]{0,50}?(\d+(?:\.\d+)?)\s*%\s*(攻击力|生命值上限|生命值|防御力|元素精通)/,
      // 造成相当于她的攻击力900%的火元素范围伤害
      /相当于[^，。；]{0,30}?(\d+(?:\.\d+)?)\s*%\s*(攻击力|生命值上限|生命值|防御力|元素精通)/,
      // 相当于茜特菈莉元素精通1800%
      /(攻击力|生命值上限|生命值|防御力|元素精通)[^，。；]{0,10}?(\d+(?:\.\d+)?)\s*%/,
    ];
    for (const re of patterns) {
      const m = re.exec(clause);
      if (!m) continue;
      const num = /^\d/.test(m[1]) ? m[1] : m[2];
      const stat = /^\d/.test(m[1]) ? m[2] : m[1];
      const n = Number(num);
      if (!Number.isFinite(n) || n <= 0 || n > 100000) continue;
      return { mult: n / 100, basis: stat, clause };
    }
  }
  return null;
}

/** Does the sentence introduce a NEW hit, rather than buffing an existing one? */
function isNewDamageInstance(desc) {
  const clauses = String(desc || '').split(CLAUSE_SPLIT).map((c) => c.trim());
  return clauses.some((clause) => {
    if (!/造成|额外攻击|额外造成/.test(clause)) return false;
    // "造成原本X%的伤害" scales an EXISTING hit. It is a multiplier on the skill,
    // not a source of its own -- the card already has the skill's row, and the
    // right way to express 200% of it is a buff, not a second source. 法尔伽's C1
    // and C6 read exactly this way.
    if (/造成原本\s*\d/.test(clause)) return false;
    // A pure bonus to something else is not a hit of its own.
    if (/伤害(提高|提升|加成)/.test(clause) && !/造成[^，。；]{0,40}?伤害/.test(clause)) return false;
    return true;
  });
}

/** Why an entry was rejected -- carried into the draft so review is quick. */
function rejectReason(desc) {
  if (/几率|概率|概率|有\d+%的几率/.test(desc)) return 'chance/proc, not a hit';
  if (/元素能量/.test(desc)) return 'energy, not a hit';
  if (/抗性降低|防御力降低/.test(desc)) return 'RES/DEF shred, not a hit';
  if (/冷却|持续\d|每过\d/.test(desc)) return 'duration/cooldown, not a hit';
  if (/伤害提高|伤害提升/.test(desc)) return 'damage bonus, not a hit';
  if (/元素精通提升|攻击力提升|生命值提升/.test(desc)) return 'stat buff, not a hit';
  return null;
}

/**
 * Why an entry never even looked like a hit.
 *
 * Every one of these gets `damage: false` in the file. The reason is recorded so a
 * reviewer can see the decision was MADE rather than skipped -- which is the whole
 * difference between a curated list and a filtered one.
 */
function notAHitReason(desc) {
  if (!desc) return 'no description';
  const d = desc.trim();
  if (!d) return 'no description';
  // A constellation that is purely a level-up.
  if (/技能等级提高|等级提高\d+级|至多提升至15级/.test(d)) return 'talent level-up, not a hit';
  // Numbers for a buff, not a hit.
  if (/伤害提高|伤害提升|造成的伤害提升|伤害加成/.test(d)) return 'damage bonus, not a hit';
  if (/暴击|攻速|攻击速度|移动速度|体力/.test(d)) return 'stat/gameplay buff, not a hit';
  if (/元素能量|元素精通提升|充能/.test(d)) return 'energy/stat buff, not a hit';
  if (/抗性降低|防御力降低|护盾|治疗|恢复生命/.test(d)) return 'defensive/utility effect, not a hit';
  if (/冷却|持续时间|每过\d|持续\d/.test(d)) return 'duration/cooldown effect, not a hit';
  if (/几率|概率/.test(d)) return 'chance-based effect, not a hit';
  // Anything left that mentions no damage at all.
  if (!/伤害|攻击/.test(d)) return 'no damage mentioned';
  return 'no explicit damage instance';
}

const statedElement = (desc) => {
  const m = /([火水雷雷冰风岩草])元素(?:范围)?伤害/.exec(desc);
  return m ? CN_ELEMENT[m[1]] || null : null;
};

// ---------------------------------------------------------------- collect

const files = fs.readdirSync(CHAR_DIR).filter((f) => f.endsWith('.json')).sort();
const chars = {};

for (const f of files) {
  const id = f.replace('.json', '');
  let d;
  try {
    d = JSON.parse(fs.readFileSync(path.join(CHAR_DIR, f), 'utf8'));
  } catch {
    continue;
  }

  const entries = {};

  /**
   * One row of the file, with every field present.
   *
   * A factory rather than three near-identical literals. Every entry gets ALL the
   * fields even when they are null, because the file is read by a review page that
   * would otherwise have to guard each access -- and a missing key reads as "not
   * yet reviewed", which is the one thing an absence must never accidentally mean.
   */
  const row = (slot, kind, icon, o = {}) => ({
    kind,
    icon,
    damage: o.damage ?? false,
    mult: o.mult ?? null,
    basis: o.basis ?? null,
    element: o.element ?? null,
    hits: o.hits ?? 1,
    verified: false,
    needsReview: o.needsReview ?? false,
    candidate: o.candidate ?? false,
    ...(o.reason ? { reason: o.reason } : {}),
    name: o.name ?? null,
    text: o.text ?? '',
  });

  const consider = (slot, kind, src) => {
    // The icon travels with the row so the review page can DRAW it -- the whole
    // point of the page is that a person can recognise what they are judging.
    const icon = src && typeof src === 'object' ? src.icon || null : null;
    // A PLACEHOLDER SLOT IS STILL RECORDED.
    //
    // 87 passives in the dataset are the empty string `""` rather than an object
    // -- `p4` for every character that does not have a fourth passive. Skipping
    // them left them absent from the file, which reads identically to "not yet
    // reviewed". Recording them as an explicit non-hit with a reason keeps the
    // file COMPLETE, so an absence always means something.
    if (src == null || src === '' || typeof src !== 'object') {
      entries[slot] = row(slot, kind, icon, {
        reason: 'empty slot in the dataset (no such passive)',
      });
      return;
    }
    const desc = plain(src.description);
    if (!desc) {
      entries[slot] = row(slot, kind, icon, {
        reason: 'no description in the dataset',
        name: src.name || null,
      });
      return;
    }

    const isNew = isNewDamageInstance(desc);
    const scaling = isNew ? statedScaling(desc) : null;
    const reason = isNew ? (scaling ? null : rejectReason(desc) || 'no explicit multiplier in the text') : notAHitReason(desc);

    // EVERY ENTRY IS RECORDED, INCLUDING THE ONES JUDGED TO BE NON-HITS.
    //
    // The first version only wrote candidates that passed the "is this a new
    // damage instance" test, which silently dropped 1039 of the roster's 1365
    // constellations and passives. That makes the file un-reviewable: a human
    // cannot confirm a rejection they cannot see, cannot tell "considered and
    // ruled out" from "never looked at", and cannot turn on a row the script was
    // wrong about. A curated file has to be COMPLETE to be trusted -- the whole
    // point is that a person can audit the decision, and an absence has no
    // explanation attached.
    //
    // So the script now records its verdict for everything, and `damage` is simply
    // that verdict. The file is ~4x larger and worth it.
    const damage = Boolean(scaling) || (enableAll && isNew && !reason);

    entries[slot] = row(slot, kind, icon, {
      damage,
      mult: scaling ? Number(scaling.mult.toFixed(4)) : null,
      basis: scaling ? scaling.basis : null,
      // Element defaults to the one the sentence names; blank means "use the
      // character's own element", which the card already knows.
      element: statedElement(desc) || null,
      // `needsReview` means "the draft could not settle this on its own". A row the
      // script is confident is NOT a hit is settled too, so it is not flagged --
      // otherwise the thousand obvious non-hits would bury the ~30 that matter.
      needsReview: isNew && !scaling,
      candidate: isNew,
      reason,
      name: src.name || null,
      text: desc.slice(0, 400),
    });
  };

  // The slot names are classified by the SAME rule the runtime uses --
  // `char-sources.parseSlot` -- rather than a second regex here. The two had
  // drifted (this one matched `const` anywhere in the string, the runtime anchored
  // to a single digit), so the writer and the reader could disagree about which
  // slots exist.
  for (const key of Object.keys(d.constellations || {}).sort()) {
    if (parseSlot(key).kind === 'constellation') consider(key, 'constellation', d.constellations[key]);
  }
  for (const key of Object.keys(d.passives || {}).sort()) {
    consider(key, 'passive', d.passives[key]);
  }

  if (Object.keys(entries).length) chars[id] = entries;
}

// ---------------------------------------------------------------- report

let total = 0;
let enabled = 0;
let needReview = 0;
let candidates = 0;
for (const e of Object.values(chars)) {
  for (const v of Object.values(e)) {
    total++;
    if (v.damage) enabled++;
    if (v.needsReview) needReview++;
    if (v.candidate) candidates++;
  }
}

const doc = {
  _note:
    'CURATED list of talents/constellations that deal damage in their own right. ' +
    'Generated as a DRAFT by scripts/audit-talent-damage.mjs, then reviewed by hand. ' +
    'Edit THIS file to change behaviour -- do not change the generator.',
  _schema: 1,
  _fields: {
    damage: 'true = offer as a damage source in the card menu. false = reviewed, NOT a source.',
    mult: 'the multiplier as a fraction (8 = 800%). null = unknown, do not guess.',
    basis: 'what the multiplier is a percentage OF (攻击力/生命值上限/...).',
    element: 'damage element. null = use the character own element, changeable in the UI.',
    hits: 'how many times the hit lands.',
    verified: 'set true once a human has confirmed this row.',
    needsReview: 'true = the multiplier could not be read from the text; needs a human.',
    reason: 'why it is not enabled, when it is not.',
    text: 'the original description, so review needs no other file.',
  },
  characters: chars,
};

fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');

console.log(`characters                 : ${Object.keys(chars).length}`);
console.log(`EVERY slot is recorded     : ${total}`);
console.log(`  look like a damage instance: ${candidates}`);
console.log(`  enabled (damage: true)   : ${enabled}`);
console.log(`  needing human review     : ${needReview}`);
console.log(`written -> ${path.relative(ROOT, outPath)}`);

// A short list of the enabled ones, so the result can be eyeballed immediately.
console.log('\nenabled:');
for (const [id, e] of Object.entries(chars)) {
  for (const [slot, v] of Object.entries(e)) {
    if (v.damage) console.log(`  ${id} ${slot.padEnd(7)} ${String(v.mult).padStart(8)} x${v.hits}  ${v.basis || '?'}  ${v.name || ''}`);
  }
}
