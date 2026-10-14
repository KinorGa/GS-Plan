// Shared vocabulary for the buff pool, the dropped cards and the damage card.
//
// This module is the SINGLE source of truth for three things that used to be
// duplicated (and had drifted apart) across DamageCard and DamageEntry:
//
//   1. which stat panel field a buff key feeds      → KEY_TO_STAT
//   2. how that field is labelled and formatted     → STAT_META
//   3. how folded totals land on a stat panel       → mergeStats
//
// Anything that needs to reason about a buff's effect on damage reads these,
// so "does this buff count?" and "what does it add?" can never disagree.
//
// `BuffCard` remains the source of the card-side tables (SOURCE_KINDS,
// BUFF_KEYS); a pass-through re-export of them used to live here and was
// imported by nobody, so it was removed rather than left as a second import
// path to the same values.

import { DAMAGE_TYPES, KEY_SUFFIX } from '../lib/elements';
import { resolve } from '../lib/buff-formula';
import { formatNumber } from '../lib/display-prefs';

// The stat labels live in a LEAF module, and are re-exported here so every
// existing `import { STAT_META } from './buff-model'` keeps working.
//
// WHY THEY MOVED. Once a buff value can be a formula, this module has to import
// `lib/buff-formula.js` -- and `buff-formula.js` needs `STAT_META` to name its `$`
// symbols. Keeping the table here would make `buff-model -> buff-formula ->
// buff-model` a cycle, and because the table is READ at module-eval time that
// cycle would throw a temporal-dead-zone error rather than merely resolve
// partially. Below both, in `lib/stat-meta.js`, it cannot take part in any cycle.
export { STAT_META } from '../lib/stat-meta';

// The drag payload type. A custom MIME keeps the axis from reacting to text or
// file drags that happen to pass over it.
export const DRAG_MIME = 'application/x-buff-item';

/**
 * Which damage-panel field each buff key feeds.
 *
 * Every action-specific DMG% key maps onto `dmgBonus` because that is where it
 * genuinely lands in the formula — the damage card has no separate
 * "normal attack DMG" field, and inventing one would make the number wrong.
 *
 * Keys that feed no damage field at all (speed, shieldStrength, cdReduction,
 * staminaCost…) are carried and displayed but do not move the damage number,
 * which is the honest behaviour.
 *
 * `healBonus` maps to a field `computeDamage` never reads, so it is carried
 * through as a no-op in the same spirit. It is listed rather than omitted so
 * the summary chip still names the field it belongs to.
 */
export const KEY_TO_STAT = {
  /**
   * FLAT HP/ATK/DEF GO TO THE FLAT FIELDS, NOT THE BASES.
   *
   * This mapping used to read `atk: 'atk'`, which put a flat buff onto the BASE
   * that ATK% then multiplies. Measured on a real build -- base 827.55, ATK%
   * 128.7%, a `攻击力 +827.55` buff -- the buff counted as +1892.61 and the total
   * came out 39% high. A flat buff is added AFTER the percentage in the formula
   * (`base * (1 + pct) + flat`, see `lib/damage.js`), so `flatAtk` is the only
   * field that means what the card says.
   *
   * `stat-derive.js` already documents this exact trap for ARTIFACT stats and
   * maps `atk -> flatAtk` for them; the buff path was the one that disagreed, so
   * the same effect was counted two different ways depending on whether it
   * arrived as gear or as a buff.
   *
   * THE PERCENTAGE KEYS ARE UNCHANGED and stay on their own fields: 攻击力% is a
   * different quantity from 攻击力, and only the percentage multiplies the base.
   */
  atk: 'flatAtk', atkPct: 'atkPct',
  hp: 'flatHp', hpPct: 'hpPct',
  def: 'flatDef', defPct: 'defPct',
  // 附加伤害值: a flat sum added to the hit AFTER the talent multiplier, not a
  // stat on the attacker's panel -- but the panel field is where the fold puts
  // it so `computeDamage` can add it in (see `lib/damage.js`).
  flatDmg: 'flatDmg',
  em: 'em', critRate: 'critRate', critDmg: 'critDmg', er: 'er',
  dmgBonus: 'dmgBonus', physBonus: 'physBonus', reactionBonus: 'reactionBonus',
  // Each element maps to ITS OWN panel field, one to one -- no guessing at the
  // character's element, because the buff key already says which element it is.
  pyroDmg: 'pyroDmg', hydroDmg: 'hydroDmg', cryoDmg: 'cryoDmg',
  electroDmg: 'electroDmg', anemoDmg: 'anemoDmg', geoDmg: 'geoDmg',
  dendroDmg: 'dendroDmg',
  resShred: 'resShred', defShred: 'defShred', defIgnore: 'defIgnore',
  // One resistance-reduction field per damage type. The generic `resShred`
  // above is KEPT and still feeds the formula (see `lib/damage.js`): a card
  // written before the split has a key of `resShred`, and re-pointing it is a
  // human decision -- if it stopped counting, the card would go on showing +40%
  // while changing nothing.
  ...Object.fromEntries(DAMAGE_TYPES.map((t) => [`resShred${KEY_SUFFIX[t]}`, `resShred${KEY_SUFFIX[t]}`])),
  // Action-specific bonuses are NOT element-specific, so they land on the generic
  // field, which adds to whichever element the hit uses.
  normalDmg: 'dmgBonus', chargedDmg: 'dmgBonus', plungeDmg: 'dmgBonus',
  skillDmg: 'dmgBonus', burstDmg: 'dmgBonus',
  healBonus: 'healBonus',
};

/**
 * Keys that are CARRIED AND DISPLAYED but must never move the damage number.
 *
 * These are real, selectable stats -- an attack-speed roll is a genuine thing to
 * record -- but none of them belongs in a per-hit damage formula: attack speed
 * changes how OFTEN you hit, shield strength changes how much you absorb, and
 * cooldown/stamina change what you can cast. Multiplying a single hit by any of
 * them is simply wrong.
 *
 * WHY THIS EXISTS AS A LIST. These keys are absent from `KEY_TO_STAT` (correctly --
 * they map to no panel field), and `foldCustomZones` used to treat EVERY unmapped
 * key as a multiplier zone. The two rules collided: 攻击速度 silently multiplied
 * the hit by 1.1. That is not a rounding error, it is a wrong number shown with no
 * indication of where it came from.
 *
 * The lesson is that "not in KEY_TO_STAT" was doing two jobs at once. It now means
 * only "feeds no panel field"; whether a key MULTIPLIES is stated here, explicitly,
 * so adding a damage-neutral stat can never again change the arithmetic by accident.
 */
export const NEUTRAL_KEYS = new Set([
  'speed', 'shieldStrength', 'cdReduction', 'staminaCost', 'healBonus',
]);

/**
 * A zone whose value IS the multiplier, rather than a percentage to add.
 *
 * 大权 is declared by the user as a direct factor: a value of `2` means "twice the
 * damage", so the multiplier is the number itself and NOT `1 + v/100`. Its card
 * carries no `%` suffix for the same reason -- "20%" and "×20" are different
 * claims, and the suffix must not say one while the arithmetic does the other.
 *
 * Kept as a set so a second such zone is a one-line change rather than a new
 * branch buried in the fold.
 */
export const RAW_MULT_KEYS = new Set(['aPower']);

/**
 * The custom multiplier zones a set of buffs declares, merged by NAME.
 *
 * A key that feeds no PANEL FIELD is either a built-in zone (大权, 擢升) or the
 * user's own label ("潮涌"). Rather than being dropped -- which is what used to
 * happen, silently -- it becomes its own INDEPENDENT MULTIPLIER ZONE: unlike
 * `dmgBonus`, which adds into the same bracket as an elemental goblet, this
 * multiplies the hit on top of everything else.
 *
 * The test is `KEY_TO_STAT`, NOT `BUFF_KEYS`. A key can be listed in `BUFF_KEYS`
 * (so it is selectable) and still be a zone -- that is exactly what 大权 and 擢升
 * are -- so membership of the dropdown must never imply "adds into the panel".
 *
 * SAME NAME MERGES, ADDITIVELY. Two cards that both say 大权 1.2 are one zone of
 * 1.2 + 1.2, not two zones multiplying. The name is the user's claim that these are
 * the same effect, and it is applied once.
 *
 * PER ENTRY, NOT GLOBAL. A dropped buff belongs to one axis entry, so 大权 on one
 * row says nothing about another row -- two entries can use the same word for
 * different things without interfering.
 *
 * Names are TRIMMED and matched EXACTLY. No case folding and no fuzzy matching: a
 * near-match that silently merged two zones would change the damage without the
 * user ever seeing which two things got combined.
 *
 * @param {Array} [buffs]
 * @param {(name: string) => {chs: string, en: string}} [labelFor]
 *        Resolves a BUILT-IN zone key to its display name, so a chip reads 大权
 *        rather than the internal `aPower`. Passed IN rather than imported:
 *        `BUFF_KEYS` lives in `BuffCard.jsx`, which already imports this module,
 *        and importing it back would make the cycle. Defaults to identity, which
 *        is the old behaviour for a name the user typed themselves.
 * @returns {Array<{ name: string, chs: string, en: string, value: number,
 *                   count: number, raw: boolean }>} sorted by name
 */
export function foldCustomZones(buffs, labelFor, scope) {
  // A LOCAL name, NOT the imported `resolve`: shadowing it here would make the
  // value lookup below call a label function.
  const labelOf = labelFor || ((n) => ({ chs: n, en: n }));
  const byName = new Map();
  for (const b of buffs || []) {
    const name = String(b?.key ?? '').trim();
    // A key that feeds a PANEL FIELD is not a zone; it is added into the panel.
    if (!name || KEY_TO_STAT[name]) continue;
    // ...and a key that feeds nothing at all is not a factor either.
    if (NEUTRAL_KEYS.has(name)) continue;
    const n = numericValue(b.value, scope);
    if (!n) continue;
    const raw = RAW_MULT_KEYS.has(name);
    const label = labelOf(name) || { chs: name, en: name };
    const cur = byName.get(name)
      || { name, chs: label.chs, en: label.en, value: 0, count: 0, raw };
    cur.value += n;
    cur.count += 1;
    byName.set(name, cur);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/**
 * The combined multiplier for a set of custom zones.
 *
 * TWO KINDS OF ZONE, and they combine differently:
 *
 *   - a PERCENTAGE zone (擢升, and any name the user types) is `1 + v/100`, so
 *     20 means +20%. Zones of this kind SUM together -- `1 + x% + y%` -- so 擢升 30
 *     beside a typed 潮涌 20 gives 1.50, which is the additive behaviour the user
 *     asked for and what same-name merging already assumed.
 *   - a RAW zone (大权) IS the multiplier: a value of 2 doubles the hit. It is
 *     deliberately NOT `1 + v/100`, because "×2" and "+2%" are different claims.
 *
 * ALL of them still fold into ONE factor, multiplied together: a raw zone scales
 * the summed percentage zone rather than sitting beside it as a second factor. Two
 * separate factors would be a different (and unrequested) arithmetic -- 1.5 × 2 =
 * 3.0 is reachable either way, but keeping one factor is what makes the summary
 * chip's single `×N` honest about what was applied.
 *
 * Returns exactly 1 when there are no zones, so an entry with none is arithmetically
 * identical to one computed before zones existed.
 */
export function customZoneMultiplier(zones) {
  let raw = 1;
  let pct = 0;
  for (const z of zones || []) {
    if (z.raw) raw *= z.value;
    else pct += z.value;
  }
  return (1 + pct / 100) * raw;
}

/**
 * How one zone is written, shared by every display site.
 *
 * The chip and its tooltip must agree, and both must state the factor that was
 * actually applied: a raw zone is `×N` (value 2 -> "×2"), a percentage zone is
 * `×1.NNN` (value 20 -> "×1.200"). Two hand-written `toFixed` calls drifted apart
 * here before -- the chip showed 3 decimals and its own tooltip 4 -- so both now
 * come from this one function.
 */
export function zoneFactor(z) {
  return z.raw ? z.value : 1 + z.value / 100;
}

/**
 * The factor above, formatted for display.
 *
 * The decimals come from the shared display preference (统一设置 -> 展示精度),
 * NOT a fixed 3. Everything that writes a zone factor -- this chip, the entry
 * chip's tooltip, the copied text -- goes through `formatNumber`, so they cannot
 * drift apart the way two hand-written `toFixed` calls once did. A raw zone
 * (大权) stays bare: `×2` is the number itself, not a percentage to round.
 */
export function zoneFactorLabel(z) {
  return z.raw ? `${z.value}` : formatNumber(zoneFactor(z));
}

/* ------------------------------------------------- copying a row's buffs */

/**
 * A buff list as TEXT, for pasting into another entry -- or into a spreadsheet.
 *
 * THE KEY IS WRITTEN, NOT THE DISPLAY LABEL, and that is the whole point: paste
 * has to rebuild a row whose `key` the app understands. Writing 通用伤害加成
 * instead of `dmgBonus` produced rows flagged `?` (unknown), which the zone logic
 * then treated as user-named multipliers -- so a pasted row that LOOKED right
 * silently changed the arithmetic. The label is still available to a human through
 * the tooltip and the chip row above; this format is for the machine.
 *
 * A zone is written with its FACTOR, since that is what the chip shows -- copying
 * 大权 2 as "2" would read as "+2%" next to the percentage rows and lose the one
 * thing that makes it different.
 */
export function buffsToText(buffs, { zones, L } = {}) {
  const lines = [];
  for (const b of buffs || []) {
    lines.push([b.key, b.value ?? '', b.tag || ''].join('\t').trimEnd());
  }
  // The zone factor SUMMARISES rows already listed above, so it goes on its own
  // line after them rather than replacing them: the individual rows are what the
  // user edits, and dropping them would lose the ability to change one.
  // `parseBuffText` skips these, so a round trip cannot double a zone.
  for (const z of zones || []) {
    const label = L ? L(z) : (z.chs || z.name);
    lines.push([`${label}=×${zoneFactorLabel(z)}`, '', L ? L({ chs: '乘区', en: 'zone' }) : 'zone'].join('\t').trimEnd());
  }
  return lines.join('\n');
}

/**
 * The inverse: text back into buff rows.
 *
 * A LABEL IS RESOLVED BACK TO ITS KEY when it names a built-in stat, so text
 * copied from a spreadsheet or typed by hand in Chinese still imports as real
 * rows. An unresolvable name is kept verbatim, because that is exactly how a
 * user-named zone (潮涌) is written and it must keep working.
 *
 * TOLERANT ON PURPOSE, because the text may come back out of a spreadsheet or a
 * chat message where tabs became spaces. Each line is split on tabs first and
 * whitespace second, and:
 *   - `key<TAB>value[<TAB>tag]`   the shape `buffsToText` writes
 *   - `key=value` / `key: value`  what someone would type by hand
 *   - a bare `key`                a row with value 0, ready to fill in
 *
 * A "<name>=×N" SUMMARY line is SKIPPED rather than imported: it restates rows
 * that are already present, so importing it would double every zone. It is
 * recognised by the `=` AND the `×`.
 *
 * Returns `[]` for text with nothing usable, so a stray paste is a no-op rather
 * than a row of blanks.
 *
 * @param {string} text
 * @param {(label: string) => string|null} [keyFor] Reverse lookup of a built-in
 *        label to its key. Passed in for the same reason `labelFor` is: `BUFF_KEYS`
 *        lives in `BuffCard.jsx`, which already imports this module.
 */
export function parseBuffText(text, keyFor) {
  const out = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip the summary line `buffsToText` appends for a zone.
    if (/[=:]\s*×/.test(line)) continue;
    let parts = line.split('\t').map((x) => x.trim());
    if (parts.length === 1) {
      // `key=value` or `key: value`, then fall back to whitespace splitting.
      const m = line.match(/^(.+?)\s*[=:]\s*(.*)$/);
      if (m) parts = [m[1].trim(), m[2].trim()];
      else parts = line.split(/\s+/).filter(Boolean);
    }
    let [key, value, tag] = parts;
    if (!key) continue;
    // Only for a BUILT-IN label; a name that resolves to nothing is left alone so
    // a user's own zone name survives the round trip.
    const mapped = keyFor ? keyFor(key) : null;
    if (mapped) key = mapped;
    out.push({ key, value: value ?? '', tag: tag ?? '' });
  }
  return out;
}

/**
 * Pull a number out of a buff value.
 *
 * A value is EITHER a formula (`=...`) or a plain number. The formula branch
 * needs the owner's scope; the plain branch does not.
 *
 * THE PLAIN BRANCH NO LONGER STRIPS CHARACTERS. It used
 * `parseFloat(text.replace(/[^0-9.+-]/g, ''))`, which reads `12abc3` as `123` and
 * `攻击力*2` as `2` -- a plausible wrong number that looks like a real value.
 * That is the exact failure the formula engine refuses, so the plain branch
 * refuses it too (see `plainNumber`).
 *
 * @param {*} value
 * @param {object} [scope]  The owner character's symbol scope. When absent, a
 *        formula CANNOT resolve and yields 0 -- callers that have a scope must
 *        pass it, or a formula-valued buff would silently count as zero.
 */
export function numericValue(value, scope) {
  const r = resolve(value, scope);
  return r.ok ? r.value : 0;
}

/**
 * Fold a list of buffs into per-field totals.
 *
 * One pass, used by both the damage card (to add the totals onto the panel) and
 * the axis entry (to show a summary chip per field). Sharing it is what keeps
 * the chip and the arithmetic in agreement.
 *
 * Order does not matter: same-field buffs accumulate, they do not multiply,
 * which matches how the game stacks same-named stat buffs.
 *
 * @returns {{ totals: Record<string, number>, effective: number }}
 *          `totals` is keyed by damage-panel field; `effective` counts the buffs
 *          that actually reached a field.
 */
export function foldBuffs(buffs, scope) {
  const totals = {};
  let effective = 0;
  for (const b of buffs || []) {
    const stat = KEY_TO_STAT[b.key];
    if (!stat) continue;
    const n = numericValue(b.value, scope);
    if (!n) continue;
    totals[stat] = (totals[stat] || 0) + n;
    effective += 1;
  }
  return { totals, effective };
}

/**
 * Fold a list of DROPS, each resolved against ITS OWN owner's scope.
 *
 * WHY PER DROP AND NOT ONE SCOPE FOR THE LOT. A formula reads the panel of the
 * character the CARD belongs to: a 15%-of-ATK buff from 尼可 reads 尼可's ATK.
 * One entry can carry cards from several characters, so a single scope would
 * resolve every formula against whichever character happened to be first -- a
 * silently wrong number on the others.
 *
 * `scopeForOwner` maps a drop to its scope (or undefined, in which case a
 * formula in that drop cannot resolve and yields 0 -- the same refusal as an
 * unknown symbol). A plain-number drop ignores the scope entirely.
 *
 * @param {Array} drops                 `{ source, buffs }` shapes.
 * @param {(drop) => object|undefined} [scopeForOwner]
 * @returns {{ totals: Record<string, number>, effective: number }}
 */
export function foldDrops(drops, scopeForOwner) {
  const totals = {};
  let effective = 0;
  for (const d of drops || []) {
    const scope = scopeForOwner ? scopeForOwner(d) : undefined;
    for (const b of d?.buffs || []) {
      const stat = KEY_TO_STAT[b.key];
      if (!stat) continue;
      const n = numericValue(b.value, scope);
      if (!n) continue;
      totals[stat] = (totals[stat] || 0) + n;
      effective += 1;
    }
  }
  return { totals, effective };
}

/**
 * Fold the CUSTOM ZONES of a list of drops, each against its own owner's scope.
 *
 * The zone twin of `foldDrops`, and for the same reason: a formula inside a zone
 * card reads that card's own owner. The results merge BY NAME, so two cards
 * naming 大权 add rather than one replacing the other -- which is what
 * `foldCustomZones` already does for a single list, applied here across drops
 * without a caller having to hand-write the merge.
 *
 * @param {Array} drops                 `{ source, buffs }` shapes.
 * @param {(drop) => object|undefined} [scopeForOwner]
 * @param {(name) => object} [labelFor] Resolves a BUILT-IN zone key to a label.
 * @returns {Array} Zones, sorted by name (the `foldCustomZones` shape).
 */
export function foldZoneDrops(drops, scopeForOwner, labelFor) {
  const byName = new Map();
  for (const d of drops || []) {
    const scope = scopeForOwner ? scopeForOwner(d) : undefined;
    for (const z of foldCustomZones(d?.buffs || [], labelFor, scope)) {
      const cur = byName.get(z.name);
      if (!cur) byName.set(z.name, { ...z });
      else { cur.value += z.value; cur.count += z.count; }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

/**
 * Add folded buff totals on top of a stat panel.
 *
 * This exists so the card and the planner's collapsed row share ONE merge.
 * They previously each did `stats[k] = (stats[k] || 0) + v` inline, and while
 * that arithmetic is trivial, having it in two places is precisely how the two
 * drifted apart and showed different numbers for the same entry. Anything that
 * folds buffs into a panel must call this.
 *
 * @param {object} base    The manual panel (base stats plus user edits).
 * @param {object} totals  Output of `foldBuffs().totals`.
 * @returns {object} A new panel; `base` is not mutated.
 */
export function mergeStats(base, totals) {
  const out = { ...base };
  for (const [k, v] of Object.entries(totals || {})) out[k] = (out[k] || 0) + v;
  return out;
}
