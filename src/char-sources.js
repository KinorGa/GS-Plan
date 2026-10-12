// Builds DamageCard `sources` from a character's real talent data.
//
// The dataset already ships per-character multipliers
// (public/data/char/{lang}/{id}.json → skills.{normalattack,elementalskill,
// elementalburst}.multipliers), each with 15 talent-level values. This module
// turns those into the shape DamageCard expects, so picking a character on the
// axis produces a fully populated card rather than a placeholder.

const SKILL_ORDER = [
  { key: 'normalattack', kind: 'normal', label: { chs: '普通攻击', en: 'Normal Attack' } },
  { key: 'elementalskill', kind: 'skill', label: { chs: '元素战技', en: 'Elemental Skill' } },
  { key: 'elementalburst', kind: 'burst', label: { chs: '元素爆发', en: 'Elemental Burst' } },
];

// Parse "102.51%" → 1.0251. The card works in fractions.
const toFraction = (s) => {
  const n = parseFloat(String(s).replace('%', ''));
  return Number.isNaN(n) ? 0 : n / 100;
};

/**
 * A multiplier string as its SEPARATE hits.
 *
 * ONE ROW IS NOT ALWAYS ONE HIT. The dataset packs compound multipliers into a
 * single string, and both shapes appear on a single character:
 *
 *   "59.27%+110.08%"       two hits of DIFFERENT damage types
 *   "168.48%*2+90.72%*2"   two hits, each landing twice
 *
 * `toFraction` reads only the first number, so everything after a `+` used to
 * vanish -- silently, and in the direction of UNDERSTATING the skill. The row
 * still rendered and still produced a number, which is exactly why nobody
 * noticed. 法尔伽's 四风将起 is the clearest case: its description says it deals
 * "对应元素伤害与风元素伤害" (a matching-element hit AND an Anemo hit), and the
 * panel could only ever show the first.
 *
 * Returns `[]` for a string with no usable number, so the caller drops the row
 * rather than keeping a zero.
 *
 * @returns {Array<{mult: number, hits: number}>} in the order written.
 */
export function parseMultiplierParts(raw) {
  const text = String(raw ?? '');
  const parts = [];
  // Split on `+` -- each term is `A%` or `A%*2`. The multiplication sign is
  // always `*` in this dataset; `x` is used by the UI, never by the data.
  for (const term of text.split('+')) {
    const m = /(-?\d+(?:\.\d+)?)\s*%\s*(?:\*\s*(\d+))?/.exec(term);
    if (!m) continue;
    const mult = toFraction(`${m[1]}%`);
    if (!mult) continue;
    const hits = m[2] ? Math.max(1, Number(m[2])) : 1;
    parts.push({ mult, hits });
  }
  return parts;
}

/**
 * The multiplier text for a stage, as the talent row actually reads.
 *
 * NOT `mult`. `mult` is deliberately the FIRST part's number, so every existing
 * consumer (the damage formula, a child pinned to `partIndex`) keeps working
 * unchanged -- but printing it as the row's label LIES about a compound row:
 * `59.27%+110.08%` rendered as `59.27%`, so the stage menu listed "狂飙突进·二段伤害
 * 59.27%" beside "狂飙突进·一段伤害 161.75%" as though they were the same kind of
 * row. The user could not tell which rows would split into two parts -- which is
 * the one thing that menu is being read for.
 *
 * `*2` is a REPEAT of the same hit, and the UI writes repeats with `x`, so it is
 * spelled `x2` here. The dataset itself only ever uses `*`.
 */
export function stageMultiplierText(stage) {
  const parts = stage?.parts;
  if (Array.isArray(parts) && parts.length) {
    return parts
      .map((p) => `${(p.mult * 100).toFixed(2)}%${p.hits > 1 ? `x${p.hits}` : ''}`)
      .join('+');
  }
  const mult = stage?.mult ?? 0;
  return `${(mult * 100).toFixed(2)}%${stage?.hits > 1 ? `x${stage.hits}` : ''}`;
}

/**
 * The curated table of constellations/passives that deal damage in their own
 * right: `public/data/talent-damage.json`.
 *
 * WHY IT IS A CURATED FILE AND NOT DERIVED HERE
 *
 * `buildSources` runs during render, so anything it needs must already be in
 * state (see `lib/use-talent-damage.js`). But the reason the DATA is curated is
 * different and more important: whether a constellation is a hit is a judgement
 * the dataset does not state, and every mechanical rule for it is wrong often
 * enough to be dangerous.
 *
 * `params` was the obvious source and is not usable. Across the roster its FIRST
 * entry is routinely something else entirely:
 *
 *   神里绫华 C1  params[0]=0.5   "有50%的几率使...冷却时间缩减"   a PROC CHANCE
 *   神里绫华 C6  params[0]=10    "每过10秒...伤害提高298%"          a DURATION
 *   旅行者 C1    params[0]=5     "恢复5点元素能量"                  ENERGY
 *   温迪 C2      params[0]=0.25  "抗性降低24%"                      a RES SHRED (and 0.25 != 0.24)
 *   可莉 C4      params[0]=1     "造成555%攻击力的火元素范围伤害"   real 555%, params says 100%
 *   香菱 C2      params[0]=2     "造成75%攻击力的火元素范围伤害"    real 75%, at params[2]
 *
 * Measured: of the constellations whose text states an `X%攻击力` multiplier,
 * `params[0] * 100` agrees only about 60% of the time, and the disagreements are
 * wrong by 5x and more. The index is not stable either -- 香菱's real number sits
 * at `params[2]`, and the 旅行者's 异邦 passives keep theirs at `params[7]`.
 * `attacks` cannot help: its per-constellation `damageParam` values are symbolic
 * strings ("Klee_Constellation_4_Damage") with no numeric table anywhere in
 * `public/data`, and 法尔伽 has no entry at all.
 *
 * Reading the description works far better -- that is what the offline generator
 * does -- but it still mislabels buffs as hits, which is why the result is
 * REVIEWED (see `docs/TALENT-DAMAGE.md`) rather than computed at runtime.
 *
 * A MISSING FILE IS A SUPPORTED STATE, not an error: it means no constellation
 * rows are offered. The three active talents never depend on it, so a failure
 * here degrades to a smaller menu rather than a broken card.
 */
export const TALENT_DAMAGE_FILE = '/data/talent-damage.json';

/**
 * The entries for one character, or `null`.
 *
 * KEYED BY THE CHARACTER ID THE HOST ALREADY HAS, not by anything inside
 * `charData`. The files carry no id field at all -- `info` holds name, element,
 * rarity and so on, but the numeric id is only ever the FILENAME -- so reading it
 * off the parsed JSON silently yields `undefined` and every lookup misses. The
 * entry's `charId` is the same string the file was fetched with, so it is passed
 * in explicitly.
 */
export function talentDamageFor(table, charId) {
  if (!charId || !table?.characters) return null;
  return table.characters[String(charId)] || null;
}

/**
 * The multiplier text for one talent row at a given talent LEVEL.
 *
 * THE LEVEL MATTERS AND WAS IGNORED. Each `multipliers` entry is an array of
 * FIFTEEN strings, one per talent level (1..15), and this module used to take
 * `values[9]` unconditionally -- level 10, every time, whatever the team panel
 * said. 法尔伽's 元素战技 at Lv5 reads 368.88%; the card showed 501.12% (Lv10),
 * overstating every skill hit by 36% while the panel displayed the level that
 * produced the smaller number.
 *
 * The index is `level - 1` because the array starts at level 1. It is CLAMPED
 * rather than trusted: a stored level outside 1..15 (an old save, a hand-edited
 * config) would otherwise read `undefined` and silently become a zero-damage row.
 */
function multiplierAt(values, level) {
  if (!Array.isArray(values)) return values;
  if (!values.length) return null;
  const lv = Number.isFinite(level) ? Math.round(level) : 10;
  const idx = Math.min(Math.max(lv, 1), values.length) - 1;
  return values[idx] ?? values[values.length - 1] ?? values[0];
}

/**
 * The damage sources a character offers: the three active talents, then any
 * constellation or passive the curated table marks as dealing damage of its own.
 *
 * `talentLevels` is the team unit's `char.talents` (`{ normal, skill, burst }`,
 * each 1..15) and decides WHICH column of the multiplier table is read. It
 * defaults to 10 only so a caller with no team -- the standalone card page -- keeps
 * the level its own hardcoded data assumes.
 */
export function buildSources(
  charData,
  element,
  talentDamage = null,
  charId = null,
  talentLevels = null
) {
  const skills = charData?.skills;
  if (!skills) return [];

  const active = SKILL_ORDER.flatMap(({ key, kind, label }) => {
    const skill = skills[key];
    if (!skill?.multipliers) return [];
    const level = talentLevels?.[kind] ?? 10;
    const stages = Object.entries(skill.multipliers)
      .map(([name, values]) => {
        const raw = multiplierAt(values, level);
        const parts = parseMultiplierParts(raw);
        if (!parts.length) return null;

        // Rows like "三段伤害" hit more than once; the label carries the count.
        //
        // This heuristic is only trusted for a SINGLE-part row. A compound row
        // spells its own repeat counts out (`*2`), and applying the name-based
        // guess on top of those would multiply a count the data already stated --
        // "三段伤害 80.15%+148.85%" is two different hits, not the third hit of
        // three, and reading 三 as `x2` here would double it.
        const namedHits = parts.length === 1 && /三段|3/.test(name) ? 2 : 1;
        const hits = namedHits * parts[0].hits;

        return {
          chs: name,
          en: name,
          // `mult`/`hits` stay the FIRST part's numbers, so every existing
          // consumer keeps working unchanged and a single-part row -- which is
          // almost all of them -- is described exactly as before.
          mult: parts[0].mult,
          hits,
          // `null` for a SINGLE-part row, an array for a compound one.
          //
          // Every consumer therefore branches (`stageMultiplierText` below,
          // `DamageEntry`'s row recompute, the card's part pinning), and that is
          // deliberate: "one hit" and "the first of several" are different facts,
          // and flattening them into a one-element array would make every reader
          // carry a length check anyway while hiding which case it had.
          parts: parts.length > 1
            ? parts.map((p, i) => ({ ...p, partIndex: i }))
            : null,
        };
      })
      .filter(Boolean);

    if (!stages.length) return [];
    return [{
      // The element a hit CARRIES, not the character's.
      //
      // Stamping `element` (the character's) on every source made a normal
      // attack Cryo on a Cryo character, which is wrong in both directions and
      // became visible the moment resistance split per type: a Physical hit read
      // the Cryo resistance fields. The dataset says which it is --
      // `attacks[].element` is `"-"` for an uninfused normal/charged/plunge and
      // the real element for a skill, a burst, or an infusion (a catalyst's
      // normal attack, 胡桃's 彼岸蝶舞, 诺艾尔's burst). See `normalAttackElement`.
      key,
      kind,
      icon: skill.icon,
      chs: `${label.chs}·${skill.name || ''}`,
      en: `${label.en}: ${skill.name || ''}`,
      element: kind === 'normal' ? normalAttackElement(charData, element) : element,
      stages,
    }];
  });

  // The constellation/passive rows go last, after the three active talents, so the
  // menu keeps its familiar order and a character with no such entry -- most of
  // them -- sees exactly the list it saw before.
  return [
    ...active,
    ...buildTalentDamageSources(charData, element, talentDamageFor(talentDamage, charId)),
  ];
}

/**
 * The slot keys a curated entry can use, and what they mean.
 *
 * ONE definition, used by both the runtime (here) and the offline generator
 * (`scripts/audit-talent-damage.mjs`). They previously disagreed: this file
 * tested `/^const\d$/` and looked the slot up in `constellations`, while the
 * generator matched an unanchored `/const(\d)/`. For `const10` those two rules
 * classify the SAME slot differently -- this one would call it a passive and read
 * `passives['const10']`. No character has ten constellations today, so nothing
 * broke, which is exactly why it is worth pinning down before one does.
 *
 * A constellation slot is `constN` with a single digit; everything else is a
 * passive slot (`p1`..`p4`), which is the dataset's own naming.
 */
const CONST_SLOT = /^const([1-9])$/;

/** Whether a slot names a constellation, and which one. */
export function parseSlot(slot) {
  const m = CONST_SLOT.exec(String(slot || ''));
  if (m) return { kind: 'constellation', index: Number(m[1]), constKey: `const${m[1]}` };
  return { kind: 'passive', index: null, constKey: null };
}

/**
 * The damage a constellation or passive deals, as sources.
 *
 * THE LIST IS READ FROM `public/data/talent-damage.json`, NOT DERIVED HERE.
 *
 * Whether a constellation is a hit is a JUDGEMENT the dataset does not state, and
 * every mechanical rule for it is wrong often enough to be dangerous:
 *
 *   - `params[0] * 100` is right about 60% of the time even on the clean subset,
 *     and wrong by 5x+ when it is wrong (可莉 C4 states 555%, params[0] = 1; 香菱 C2
 *     states 75%, params[0] = 2). The index is not stable either.
 *   - `attacks` carries per-constellation entries for 32 characters, but not one
 *     has a numeric value -- every `damageParam` is a symbol like
 *     "Klee_Constellation_4_Damage", and 法尔伽 has no entry at all.
 *   - Reading the description works much better (the generator gets ~93% of the
 *     ones it accepts) but still mislabels buffs as hits, which is why the file is
 *     REVIEWABLE rather than generated at runtime.
 *
 * So the judgement is made once, offline, and written to a file a human can
 * correct -- see `scripts/audit-talent-damage.mjs` and the review page. This
 * function only READS it, and it never guesses: an entry marked `damage: false`,
 * or absent, or missing a multiplier, produces no row. A missing row is visible;
 * an invented one is a wrong number wearing a confident label.
 *
 * An UNLOCKED constellation is not required. The card answers "what would this hit
 * do", and a rotation plan legitimately includes a constellation the account does
 * not have yet. The buff side of the same constellation IS gated on the unlock --
 * see `lib/buff-sources.js` -- because a misapplied buff silently inflates every
 * number, while an extra row is simply a row you need not pick.
 */
function buildTalentDamageSources(charData, element, entries) {
  if (!entries) return [];

  const out = [];
  const cons = charData?.constellations || {};
  const passives = charData?.passives || {};

  // Iterate the CURATED entries, not the character's full constellation list: the
  // file is what decides, and walking it means an entry for a slot the character
  // does not have is simply never reached.
  for (const slot of Object.keys(entries).sort()) {
    const entry = entries[slot];
    // NOT ENABLED -> NO ROW. This is the whole contract of the file.
    if (!entry || entry.damage !== true) continue;

    const mult = Number(entry.mult);
    // `damage: true` with no multiplier is a half-finished review, not a hit to
    // guess at. Skipped, and visible as a missing row rather than a wrong number.
    if (!Number.isFinite(mult) || mult <= 0) continue;

    const { kind, index: n, constKey } = parseSlot(slot);
    const src = kind === 'constellation' ? cons[constKey] : passives[slot];
    // The dataset's own name wins, so a renamed constellation follows the game.
    const name = src?.name || entry.name || slot;

    out.push({
      key: slot,
      kind,
      icon: src?.icon || entry.icon || null,
      chs: kind === 'constellation' ? `命之座 ${n}·${name}` : `固有天赋·${name}`,
      en: kind === 'constellation' ? `Constellation ${n}: ${name}` : `Passive: ${name}`,
      // The element the file names, else the character's own. Changeable in the
      // card, exactly like the damage-type picker beside it.
      element: entry.element || element,
      stages: [{
        chs: entry.basis ? `${entry.basis}倍率伤害` : '伤害',
        en: entry.basis ? `${entry.basis} Scaling DMG` : 'DMG',
        mult,
        hits: Number.isInteger(entry.hits) && entry.hits > 0 ? entry.hits : 1,
        parts: null,
        // What the multiplier is a percentage OF. The formula applies it to ATK
        // regardless; carrying the basis keeps the mismatch visible rather than
        // hiding it, and the review page is where it gets corrected.
        basis: entry.basis || null,
      }],
    });
  }

  return out;
}

/**
 * What a normal attack carries: Physical, unless the character infuses it.
 *
 * The game infuses a normal attack rather than making it elemental at source,
 * and the dataset does not expose the infusion, so it is decided from the images
 * that carry one:
 *
 *   Catalyst  every catalyst normal attack is elemental, always.
 *   Sword / Claymore / Polearm / Bow   Physical, unless a talent infuses.
 *
 * THE INFUSION LIST IS INCOMPLETE and is meant to be. It is a list of names a
 * human has checked; guessing would be worse than being physical, because a
 * missed infusion produces a number that is merely understated, while a wrongly
 * claimed one reads a resistance the hit never met. Anything not listed here is
 * reported as Physical and can be corrected on the card.
 *
 * The card's own `SOURCES` data does the same thing for its demo character: the
 * normal attack is `Physical` while the skill and burst are `Cryo`.
 */
const INfUSING_TALENTS = /彼岸蝶舞|诺艾尔|护心铠|千岩牢固|破魔|Ley Line|神里流·霰步|冰华|焰硝|赤团开时|Elemental Infusion/;

function normalAttackElement(charData, element) {
  const weapon = charData?.info?.weaponType || charData?.weaponType;
  // A catalyst's attack is ALWAYS elemental -- that is what the weapon does, not
  // a talent. Verified against the dataset: 凝光 / 莫娜 / 流浪者 carry a real
  // element on `NormalAttackDamage`, while a sword user's is `"-"`.
  if (weapon === 'WEAPON_CATALYST') return element;

  // An infusion is a talent, and the only evidence available is its text.
  const text = [charData?.skills?.normalattack?.description, charData?.skills?.elementalskill?.description]
    .filter(Boolean)
    .join(' ');
  if (INfUSING_TALENTS.test(text)) return element;

  return 'Physical';
}

// Character ids whose data files are present locally.
export const CHAR_FILE = (id, lang = 'chs') => `/data/char/${lang}/${id}.json`;
