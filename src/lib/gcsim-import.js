// gcsim -> GS-Plan: turn an exported gcsim run into a `lunaris-config` document.
//
// WHY THIS FILE IS IN `src/` AND NOT BESIDE THE CLI
//   The planner's 导入 button runs this SAME function in the browser, and
//   `scripts/gcsim-import.mjs` is only its command-line wrapper. Two importers
//   would drift -- the mapping table would grow a case one of them knew about --
//   so there is exactly one, and it lives where both callers can reach it.
//
//   IT IS PURE. Everything it reads is a parameter; it touches no filesystem, no
//   clock and no network. That is what lets a check drive it with a synthetic
//   two-hit sample instead of a 5 MB dump (see tests/check-gcsim-import.mjs),
//   and it is why the loader half (`gcsim-sample.js`, the CLI) can supply the
//   same data from a disk or from `fetch` without this file knowing which.
//
// WHAT GOES IN
//   A gcsim `serve_sample.json.gz` (or the plain JSON). Everything comes from it:
//   `logs` carries one `damage` event per hit, in frame order (the ability that
//   produced it, the element, whether it crit, the simulated damage), and
//   `character_details` carries each team member's level, constellation, talent
//   levels, weapon and artifact SETS. So there is no config.txt to parse -- the
//   export is self-contained, which is the one thing to check before blaming the
//   importer for a team that looks wrong.
//
// WHAT COMES OUT
//   `{ kind: "lunaris-config", ... }` -- the exact document the planner's 导入
//   button and the CLI both write (see src/lib/config-file.js). No new storage:
//   the importer only produces the document the app already knows how to load.
//
// WHAT IS AND IS NOT FAITHFUL (read this before judging the numbers)
//   The AXIS is faithful: every mapped hit becomes a row with the right talent
//   source, the right stage, the right hit count, and the right crit mode. Each
//   row's note records what gcsim actually rolled, so a mismatch is visible and
//   auditable rather than hidden.
//
//   The NUMBERS are rebuilt as far as the export allows, in two parts.
//
//   The PANEL comes back from `character_details[i].stats`, which is the
//   `add stats` aggregate the run was given, in gcsim's own 25-slot attribute
//   order. Every non-zero entry is written into the character's artifact slots
//   as ONE substat row carrying the whole total (see `artifactSlots`): the same
//   number gcsim used, with no claim that the pieces were split into real rolls.
//   Inventing rolls nobody made is the one thing this importer must not do, and
//   a single row carries the total without inventing anything.
//
//   The BUFFS come from the LOG ITSELF, row by row. Every `damage` event lists
//   the statuses that were live for THAT hit (`varka-c6-cdmg`, `celestialgift-*`,
//   `vvpyro`...), with the values they applied at that moment. A row therefore
//   gets exactly the cards its own hits had, at the sample's numbers -- a
//   self-buff that only reached 法尔伽 never lands on 杜林's rows, because 杜林's
//   hits do not carry the status. `public/data/gcsim-abilities.json`'s `buffs`
//   table is the human-auditable status -> local-source mapping, and the only
//   place a status is interpreted: a status the table does not name, a stat line
//   it cannot read, or a source the team does not have is REPORTED, never
//   silently dropped.
//
//   Constellation/passive damage IS mapped: those rows do not exist on the
//   character's talent table at all, they come from the curated
//   public/data/talent-damage.json, which is passed to `buildSources` here.
//
// THE STAGE NAMES IN THE MAPPING ARE CHINESE, so a caller must supply the `chs`
// detail files; `findStage` matches `stages[].chs` and nothing else. That is not
// a preference, it is how the table is written.

import { buildSources } from '../char-sources';
import { SLOT_KEYS, SUB_COUNT, blankPiece, mainStatValue } from './artifact-model';
import { buildUnitSources } from './buff-sources';
import { damageTypeSuffix } from './elements';
import { CONFIG_KIND, CONFIG_VERSION } from './config-file';

/**
 * gcsim's own spelling of a name -> the id the local catalogue uses.
 *
 * gcsim names things by their ENGLISH name with the punctuation and spaces
 * squeezed out ("Gest of the Mighty Wolf" -> `gestofthemightywolf`), so the same
 * normalisation matches almost everything for free. The explicit `overrides`
 * map catches the rest -- a gcsim alias ("risingwinds" for
 * "A Day Carved From Rising Winds") has no way to be derived at all.
 */
const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function resolveByName(name, catalogue, overrides = {}) {
  if (overrides && overrides[name]) return String(overrides[name]);
  const target = normalise(name);
  if (!target) return null;
  for (const [id, entry] of Object.entries(catalogue || {})) {
    if (normalise(entry?.enName) === target) return String(id);
  }
  return null;
}

/** The id a catalogue entry is filed under, preferring its own `setId`. */
const catalogueId = (id, entry) => String(entry?.setId ?? id);

/* ------------------------------------------------------------------ mapping */

/** Abilities that are reactions: they belong to no character's talent row. */
const REACTION = /^swirl-|^(overloaded|superconduct|electro-?charged|shattered|burning|bloom|hyperbloom|burgeon|aggravate|spread|quicken|vaporize|melt|freeze|crystallize|burning)$/i;

/** `1.989` -> `1 hit`? no: `[source, stage]` -> the stage row of a source. */
function findStage(source, stageName) {
  const row = (source?.stages || []).find((s) => s.chs === stageName);
  return row || null;
}

/**
 * Build the import document.
 *
 * Pure: everything it reads is passed in, so a check can drive it with a
 * synthetic sample rather than a 5 MB dump, and a human can see that the only
 * inputs are the log and the mapping table.
 *
 * @param {object} input
 * @param {object} input.sample      the gcsim export
 * @param {object} input.mapping     public/data/gcsim-abilities.json
 * @param {object} input.catalogues  { char, weapon, artifact } lists
 * @param {object} input.charData    charId -> the parsed char detail file
 * @param {object} input.talentDamage  public/data/talent-damage.json (may be null)
 * @param {object} [input.team]      a team to use verbatim (escape hatch)
 * @param {object} [input.library]   the parsed buff library (`{ version, entries }`)
 * @param {object} [input.flags]     that library's "is this a buff" marks
 * @param {object} [input.setBonuses] setId -> an artifact set's bonuses, which
 *                                    `buildUnitSources` needs to name the 2/4pc
 *                                    sources it offers
 */
export function importGcsim({
  sample, mapping, catalogues, charData, talentDamage = null, team = null,
  setBonuses = null,
}) {
  const details = sample.character_details || [];
  const abilities = mapping.abilities || {};
  const ignored = mapping.ignored || {};
  const buffTable = mapping.buffs || {};
  const extraSources = mapping.extraSources || {};

  // gcsim char -> local id, once, up front: an unresolvable character makes the
  // whole run meaningless, so it throws rather than dropping every hit.
  const idFor = details.map((cd, i) => {
    const id = mapping.characters?.[cd.name] || resolveByName(cd.name, catalogues.char);
    if (!id) {
      throw new Error(
        `gcsim 角色「${cd.name}」在本地目录里找不到；请在 gcsim-abilities.json 的 characters 里补一条`
      );
    }
    return { index: i, id: String(id), detail: cd };
  });

  // Talent LEVELS, with the constellation raise applied.
  //
  // The stored level is the EFFECTIVE one: C3 adds 3 to the skill and C5 adds 3
  // to the burst, and `buildSources` reads the stored number directly. Storing
  // the base 10 and expecting the app to add the +3 would silently read the wrong
  // column, which is exactly the bug src/char-sources.js documents fixing.
  const levelsFor = (cd) => {
    const cons = Number(cd.cons) || 0;
    const t = cd.talents || {};
    return {
      normal: t.attack || 1,
      skill: (t.skill || 1) + (cons >= 3 ? 3 : 0),
      burst: (t.burst || 1) + (cons >= 5 ? 3 : 0),
    };
  };

  // Sources per character, built once.
  const sources = {};
  for (const { index, id, detail } of idFor) {
    const data = charData[id];
    if (!data) throw new Error(`缺少角色数据文件 public/data/char/chs/${id}.json`);
    const element = detail.element ? detail.element[0].toUpperCase() + detail.element.slice(1) : null;
    sources[index] = buildSources(data, element, talentDamage, id, levelsFor(detail));
  }

  /**
   * THE TEAM IS BUILT BEFORE THE LOG IS WALKED, not after.
   *
   * A row's cards are looked up by the LOCAL SOURCE its statuses name, so the
   * team's own source list has to exist before the first row does. Building it
   * here rather than beside the report also collects the artifact
   * reconstruction's `notes` in the same pass.
   */
  const statNotes = [];
  const teamOut = team || buildTeam({ idFor, catalogues, mapping, notes: statNotes });
  const sourcesByKey = teamSources(teamOut, { catalogue: catalogues, charData, setBonuses });
  const sourceOf = (key) => {
    const known = sourcesByKey.get(key);
    if (known) return known;
    // A source that belongs to no unit -- a party resonance has nobody to be
    // built from -- so the table names it directly.
    const extra = extraSources[key];
    return extra ? { icon: null, iconKind: null, ...extra, libKey: key } : null;
  };

  // Everything a card could not be built from, and how far each card reached.
  // Both halves are the report: nothing a row needed is allowed to vanish.
  const buffNotes = [];
  const buffNoteSeen = new Set();
  const pushBuffNote = (n) => {
    const id = JSON.stringify(n);
    if (buffNoteSeen.has(id)) return;
    buffNoteSeen.add(id);
    buffNotes.push(n);
  };
  const cardCount = new Map();

  const enemyLevel = sample.target_details?.[0]?.level ?? null;

  const entries = [];
  const byAbility = new Map(); // "char|ability" -> { char, ability, hits, mapped, ignored }
  const note = (charName, ability, hits, mapped, isIgnored) => {
    const key = `${charName}|${ability}`;
    const row = byAbility.get(key) || { char: charName, ability, hits: 0, mapped, ignored: isIgnored };
    row.hits += hits;
    byAbility.set(key, row);
    return row;
  };

  const damage = (sample.logs || []).filter((e) => e.event === 'damage');
  // gcsim emits a `calc` right after each `damage`, carrying the EXACT
  // multiplier that hit used (`calc.talent`) -- the oracle the row split below
  // needs, and the only place the true motion value (mode bonus, per-part
  // coefficient) is written down.
  //
  // PAIRED BY ORDER, NOT BY KEY. Two parts of one cast land on the SAME frame
  // with the same ability name (苍噬 fires part0 and part1 together), so
  // `char_index|frame|abil` collides and a keyed lookup would hand both hits the
  // same part -- the 34 rows that stayed wrong. The log lists the pair
  // damage-then-calc, so matching each calc to the pending damage of its own
  // (character, ability) is exact.
  const calcForDamage = new Map();
  const pendingCalc = new Map();
  for (const e of sample.logs || []) {
    if (e.event === 'damage') {
      pendingCalc.set(`${e.char_index}|${e.logs?.abil}`, e);
    } else if (e.event === 'calc') {
      const k = `${e.char_index}|${e.logs?.abil}`;
      const d = pendingCalc.get(k);
      if (d) { calcForDamage.set(d, e); pendingCalc.delete(k); }
    }
  }
  let seq = 0;
  const nextId = () => `e${++seq}`;

  // Merge the hits of ONE CAST into one row whose hit count is the cast's run
  // length. gcsim logs one event per part (苍噬 fires twice back to back), and
  // one row per part would bury the rotation in noise.
  const flush = (cast) => {
    if (!cast) return;
    const {
      ci, ability, hits, total, critAll, critNone, ele, events,
    } = cast;

    const cd = details[ci];
    const mapped = abilities[idFor[ci].id]?.[ability];
    const isIgnored = Boolean(ignored[ability]) || REACTION.test(ability);
    const report = note(cd.name, ability, hits, Boolean(mapped), isIgnored);
    if (!mapped) return;

    const src = (sources[ci] || []).find((s) => s.key === mapped.source);
    const stage = findStage(src, mapped.stage);
    if (!src || !stage) {
      // A mapping whose stage name no longer exists is a table that has drifted;
      // say so loudly instead of dropping the row silently.
      report.mapped = false;
      report.stale = true;
      return;
    }

    const stageIndex = src.stages.indexOf(stage);
    const sourceLabel = {
      ...src,
      stages: src.stages.map((st, i) => (i === stageIndex ? { ...st, hits } : st)),
    };
    const elementOf = (e) => (e ? e[0].toUpperCase() + e.slice(1) : null);
    const enemyOverrides = enemyLevel != null ? { enemyLevel } : {};

    // THE ROW'S OWN CARDS. Grouped by source, so two statuses naming one source
    // (法尔伽's a1-anemo and a1-pyro are both p1) become one card holding both.
    const attachCards = (map, count) => {
      const cards = rowDrops([...map.values()], sourceOf, pushBuffNote);
      for (const c of cards) {
        const rec = cardCount.get(c.source.libKey)
          || { libKey: c.source.libKey, kind: c.source.kind, name: c.source.name, rows: 0, hits: 0 };
        rec.rows += 1;
        rec.hits += count;
        cardCount.set(c.source.libKey, rec);
      }
      return cards;
    };

    /**
     * The `scaling` a row or child carries so it reproduces gcsim's OWN number.
     *
     * gcsim writes the multiplier it used (`calc.talent`) and logs one event per
     * hit, neither of which the local talent table can express: 法尔伽's 狂飙突进
     * runs at 220% of the table value, its C1 doubles 四风将起, and a multi-part
     * skill fires several coefficients that must be kept apart. `computePart`
     * lets `scaling` WIN over the table. `null` when the table already agrees,
     * so an ordinary row keeps a clean override set.
     */
    const scalingFor = (talent, count, localMult, localHits) => {
      const s = {};
      if (talent != null && Number.isFinite(talent) && localMult
        && Math.abs(talent / localMult - 1) > 1e-6) {
        s.mult = talent;
      }
      if (count != null && localHits && count !== localHits) s.hits = count;
      return Object.keys(s).length ? s : null;
    };

    // SPLIT THE RUN BY THE PART EACH HIT IS.
    //
    // gcsim logs one event per hit, and one ability fires several parts whose
    // motion values DIFFER (杜林's burst is 202.23/163.88/190.13), or the same
    // part at a situational multiplier (法尔伽's 狂飙突进 220%, its C1's 200%).
    // A single row holding one `stageIndex` and no `partIndex` computed part 0
    // for EVERY hit -- which is why a multi-part skill showed one wrong number
    // and its segments did not match. So a cast with more than one hit becomes
    // a PARENT with ONE CHILD PER HIT, each child carrying that hit's own
    // multiplier, buffs and crit mode.
    //
    // ONE HIT IS ONE PART -- a repeated hit is NOT folded into a `×2` child.
    // Two hits used to merge whenever they agreed on (talent, element, crit,
    // buffs) and the row drew them as `×2 = ...`. That read well until the two
    // hits were not the same: a reaction on the FIRST hit moves its damage while
    // the status list the log hands the second does not name it, so the pair
    // merged on a signature that MISSED the change and the row reported a number
    // NEITHER hit rolled. Whether a hit reacted is not a fact a merged row can
    // hold -- and the SAME skill already split when a stack moved mid-cast (苍噬's
    // buff signature drifted between its two halves), so one component drew two
    // ways. Splitting every hit is uniform and auditable: the log lists N hits,
    // the row holds N parts, and each part keeps its own cards.
    const groups = events.map((h) => ({
      talent: h.talent,
      ele: h.ele,
      count: 1,
      crits: [h.crit],
      buffs: new Map(h.buffs),
    }));

    if (groups.length <= 1) {
      // ONE NUMBER: the ordinary row, exactly as before -- plus a multiplier
      // override only when gcsim's differs from the table's.
      const g = groups[0];
      const scaling = scalingFor(g.talent, hits, stage.mult, stage.hits);
      entries.push({
        id: nextId(),
        charId: idFor[ci].id,
        element: elementOf(g.ele || ele),
        drops: attachCards(g.buffs, hits),
        ...(scaling ? { scaling } : {}),
        statOverrides: { ...enemyOverrides },
        critMode: critAll ? 'crit' : critNone ? 'never' : 'avg',
        picked: { sourceKey: mapped.source, stageIndex },
        summary: { sourceKey: mapped.source, sourceLabel },
        note: noteText(hits, total, critAll, critNone),
      });
      return;
    }

    const parentId = nextId();
    const parts = groups.map((g, i) => ({
      partIndex: i,
      mult: g.talent ?? stage.parts?.[i]?.mult ?? stage.mult,
      hits: g.count,
    }));
    const children = groups.map((g, i) => {
      const localMult = stage.parts?.[i]?.mult ?? stage.mult;
      const localHits = stage.parts?.[i]?.hits ?? stage.hits;
      const scaling = scalingFor(g.talent, g.count, localMult, localHits);
      const allCrit = g.crits.every(Boolean);
      const noneCrit = g.crits.every((c) => !c);
      return {
        id: `${parentId}-p${i}`,
        partIndex: i,
        element: elementOf(g.ele),
        drops: attachCards(g.buffs, g.count),
        ...(scaling ? { scaling } : {}),
        statOverrides: { ...enemyOverrides },
        critMode: allCrit ? 'crit' : noneCrit ? 'never' : 'avg',
        expanded: false,
      };
    });
    entries.push({
      id: parentId,
      charId: idFor[ci].id,
      element: elementOf(ele),
      // A compound row holds no buffs of its own -- each child carries its
      // own, which is the reason the split exists.
      drops: [],
      statOverrides: { ...enemyOverrides },
      critMode: critAll ? 'crit' : critNone ? 'never' : 'avg',
      picked: { sourceKey: mapped.source, stageIndex },
      summary: {
        sourceKey: mapped.source,
        sourceLabel,
        parts,
        partCount: groups.length,
        perHit: hits ? total / hits : 0,
        total,
        hits,
      },
      children,
      note: noteText(hits, total, critAll, critNone),
    });
  };

  // GROUP THE LOG INTO CASTS.
  //
  // One cast of a multi-part skill fires several damage events, and gcsim stamps
  // each of them with the SAME `source_frame` -- the frame the cast began. So
  // merging only ADJACENT same-ability hits UNDER-COUNTS a cast whose parts are
  // interleaved with other abilities: 杜林's burst lands its three parts on one
  // frame, but the run splits them 2+1 and the row read "2 段" where the log (and
  // the local table) have three. Group by (character, ability, source_frame):
  // a cast is a cast however its hits are interleaved. The hits INSIDE a cast are
  // still split by part at flush time. Events with no `source_frame` fall back
  // to the old adjacency rule, so a shape the log never emits keeps its behaviour.
  const newCast = (ci, ability, ele) => ({
    ci, ability, hits: 0, total: 0, critAll: true, critNone: true, ele, events: [],
  });
  const castMap = new Map();
  const casts = [];
  let adjacent = null;
  for (const event of damage) {
    const L = event.logs || {};
    const ci = event.char_index;
    let cast;
    if (L.source_frame != null) {
      const key = `${ci}|${L.abil}|${L.source_frame}`;
      cast = castMap.get(key);
      if (!cast) {
        cast = newCast(ci, L.abil, L.ele);
        castMap.set(key, cast);
        casts.push(cast);
      }
    } else if (!adjacent || adjacent.ci !== ci || adjacent.ability !== L.abil) {
      adjacent = newCast(ci, L.abil, L.ele);
      casts.push(adjacent);
      cast = adjacent;
    } else {
      cast = adjacent;
    }
    cast.hits += 1;
    cast.total += Number(L.damage) || 0;
    cast.critAll = cast.critAll && Boolean(L.crit);
    cast.critNone = cast.critNone && !L.crit;

    // THIS HIT'S OWN SLICE. The row is no longer one merged buff map: a run can
    // hold several PARTS, so each hit keeps its own statuses and the split at
    // flush time can hand each part exactly what IT had.
    const hitCalc = calcForDamage.get(event);
    const hit = {
      talent: hitCalc?.logs?.talent != null ? Number(hitCalc.logs.talent) : null,
      crit: Boolean(L.crit),
      ele: L.ele || null,
      buffs: new Map(),
    };
    cast.events.push(hit);

    // THE CARDS ARE THE HIT'S OWN. Each status the log lists for this hit was
    // live for it, so a row collects exactly what its hits had.
    /**
     * Absorb ONE status (or sub-status): map it to a source, read its lines,
     * and record each mod on the run.
     *
     * NOT a `continue`-able loop body: `pre_damage_mods` (below) holds several
     * sub-statuses that must go through exactly this path, so it is a function
     * the whole `Object.entries` walk and the unwrapper both call.
     */
    const absorb = (name, raw) => {
      if (!buffTable[name]) {
        pushBuffNote({ kind: 'buff-status-unknown', status: name, ability: L.abil });
        return;
      }
      for (const p of statusLines(name, raw, buffTable, pushBuffNote)) {
        // Deduped BY STATUS, not just by source+stat. A status listed on several
        // hits of one row is ONE mod, but two DIFFERENT statuses that name the
        // same source and the same field (尼可's Grace of Kenosis and Guidance
        // of Theosis are both p1 and BOTH add flat ATK -- the second is "an
        // additional 300") genuinely stack, and collapsing them would understate
        // the row by 300 ATK.
        const id = `${name}\u0000${p.source}\u0000${p.key}`;
        const prev = hit.buffs.get(id);
        if (prev && prev.value !== p.value) {
          // Never happens on the sample this was built against (a merged run
          // sits inside one buff state), but if it ever did the row must not
          // quietly pick one: the FIRST wins and the drift is reported.
          pushBuffNote({
            kind: 'buff-value-drift', status: name, source: p.source, key: p.key,
            from: prev.value, to: p.value, ability: L.abil,
          });
          continue;
        }
        hit.buffs.set(id, p);
      }
    };

    /**
     * Absorb ONE resistance shred from `resist_mods`.
     *
     * Its entries are also `name, [lines]` pairs, but the line the app needs is
     * `amount` (a fraction like `-0.35`), paired with `ele` to say WHICH
     * resistance. Read straight from the log: the log DOES carry the number, and
     * the table used to hardcode it instead -- 20 for 杜林's `durin-a1-*`, whose
     * real amount is 35. That is exactly the 0.94 every 杜林 / 布伦妮 / 法尔伽
     * row was off by, a wrong resistance hiding behind a matched panel.
     */
    const absorbResist = (sub, raw) => {
      const source = buffTable[sub];
      if (typeof source !== 'string') {
        pushBuffNote({ kind: 'buff-status-unknown', status: sub, ability: L.abil });
        return;
      }
      const line = {};
      for (const s of (Array.isArray(raw) ? raw : [])) {
        const at = String(s).indexOf(':');
        if (at < 0) continue;
        line[String(s).slice(0, at).trim()] = String(s).slice(at + 1).trim();
      }
      const amount = Number(line.amount);
      const suffix = damageTypeSuffix(line.ele);
      if (!Number.isFinite(amount) || !suffix) {
        pushBuffNote({ kind: 'buff-inactive', status: sub, line: 'amount', text: line.amount });
        return;
      }
      const key = `resShred${suffix}`;
      const value = round6(Math.abs(amount) * 100);
      const id = `${sub}\u0000${source}\u0000${key}`;
      const prev = hit.buffs.get(id);
      if (prev && prev.value !== value) {
        pushBuffNote({
          kind: 'buff-value-drift', status: sub, source, key, from: prev.value, to: value, ability: L.abil,
        });
        return;
      }
      hit.buffs.set(id, { source, key, value });
    };

    for (const [name, raw] of Object.entries(L)) {
      if (HIT_KEYS.has(name)) continue;
      // `pre_damage_mods` and `resist_mods` are CONTAINERS, not statuses: each
      // packs several sub-statuses as `name, [lines]` pairs. They are the
      // per-hit damage% and resistance shreds that apply at the moment of the
      // hit -- 法尔伽's 风帜的先引 stacks, 布伦妮's 振铃鼓舞, 翠绿之影's shred.
      // Unwrap them, or they are skipped and the row's bonus / resistance comes
      // up short.
      if (name === 'pre_damage_mods') {
        for (const [sub, subRaw] of nestedStatuses(raw)) absorb(sub, subRaw);
        continue;
      }
      if (name === 'resist_mods') {
        for (const [sub, subRaw] of nestedStatuses(raw)) absorbResist(sub, subRaw);
        continue;
      }
      absorb(name, raw);
    }
  }
  for (const cast of casts) flush(cast);

  const rows = [...byAbility.values()];
  const mappedHits = rows.filter((r) => r.mapped).reduce((n, r) => n + r.hits, 0);
  const ignoredHits = rows.filter((r) => !r.mapped && r.ignored).reduce((n, r) => n + r.hits, 0);
  const report = {
    damageEvents: damage.length,
    entries: entries.length,
    mappedHits,
    ignoredHits,
    unmappedHits: damage.length - mappedHits - ignoredHits,
    byAbility: rows.sort((a, b) => b.hits - a.hits),
    // What the rows were given beyond the axis itself: the panel, and the cards.
    statNotes,
    buffs: {
      cards: [...cardCount.values()].sort((a, b) => b.hits - a.hits),
      notes: buffNotes,
    },
  };

  const doc = {
    kind: CONFIG_KIND,
    version: CONFIG_VERSION,
    team: teamOut,
    axes: [{ id: 'gcsim', name: 'gcsim 导入', entries }],
    activeId: 'gcsim',
  };
  return { doc, report };
}

/** The note a row carries: what gcsim rolled, so the gap is visible. */
function noteText(hits, total, critAll, critNone) {
  const per = hits ? total / hits : total;
  const crit = critAll ? '全暴击' : critNone ? '未暴击' : '暴击混合';
  return `gcsim：${hits} 击 · 单击 ${fmt(per)} · 合计 ${fmt(total)} · ${crit}`;
}

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/* --------------------------------------------------------------------- team */

/**
 * The team, rebuilt from the sample's own `character_details`.
 *
 * Artifacts carry the SETS (which is what the planner's 2/4-piece buff pool
 * reads) AND the stat aggregate, written as one substat row per stat -- see
 * `artifactSlots` for why the total is not split back into rolls.
 */
function buildTeam({ idFor, catalogues, mapping, notes }) {
  const units = idFor.map(({ id, detail }, i) => {
    const weaponId = detail.weapon?.name
      ? resolveByName(detail.weapon.name, catalogues.weapon, mapping.weapons)
      : null;

    const slots = artifactSlots(detail, catalogues, mapping, notes);

    const cons = Number(detail.cons) || 0;
    const t = detail.talents || {};
    return {
      id: `u${i + 1}`,
      char: {
        id,
        level: Number(detail.level) || 90,
        constellation: cons,
        talents: {
          normal: t.attack || 1,
          skill: (t.skill || 1) + (cons >= 3 ? 3 : 0),
          burst: (t.burst || 1) + (cons >= 5 ? 3 : 0),
        },
      },
      weapon: { id: weaponId, refine: Number(detail.weapon?.refine) || 1 },
      artifacts: { active: 'a1', sets: [{ id: 'a1', name: 'gcsim', slots }] },
    };
  });
  return { version: 1, units };
}

/* --------------------------------------------------------------- artifacts */

/**
 * gcsim's `character_details[i].stats` is a 25-slot vector in gcsim's OWN
 * attribute order (`pkg/core/attributes/stats.go`), which is not the app's.
 * The translation, index by index:
 *
 *    0 NoStat     1 DEF%      2 DEF       3 HP        4 HP%      5 ATK
 *    6 ATK%       7 ER        8 EM        9 CR       10 CD      11 Heal
 *   12 Pyro%     13 Hydro%   14 Cryo%    15 Electro% 16 Anemo%  17 Geo%
 *   18 Dendro%   19 Phys%    20 AtkSpd   21 Dmg%     22..25 delimiter + bases
 *
 * CHECKED, not assumed: this run's own `add stats` line for varka
 * (`hp=4780 atk=357.7 def=18.5 atk%=1.288 def%=0.109 em=102.6 er=0.065 cr=0.397
 * cd=1.492`) lands on indices 3, 5, 2, 6, 1, 8, 7, 9, 10 of his vector, and the
 * other three characters agree with theirs cell for cell.
 *
 * `unit` is HOW THE APP CAN HOLD THE NUMBER, which is not the same for all of
 * them: a substat's value is free text, so any flat or percent stat fits there
 * verbatim; an element or healing bonus only exists as a goblet's or circlet's
 * MAIN stat, whose value is computed from the artifact curve. `null` means the
 * app has nowhere to put it, and the report says so rather than dropping it
 * silently.
 */
const GS_STAT = {
  1: { key: 'defPct', unit: 'sub' },
  2: { key: 'def', unit: 'sub' },
  3: { key: 'hp', unit: 'sub' },
  4: { key: 'hpPct', unit: 'sub' },
  5: { key: 'atk', unit: 'sub' },
  6: { key: 'atkPct', unit: 'sub' },
  7: { key: 'er', unit: 'sub' },
  8: { key: 'em', unit: 'sub' },
  9: { key: 'critRate', unit: 'sub' },
  10: { key: 'critDmg', unit: 'sub' },
  11: { key: 'healBonus', unit: 'circlet' },
  12: { key: 'pyroDmg', unit: 'goblet' },
  13: { key: 'hydroDmg', unit: 'goblet' },
  14: { key: 'cryoDmg', unit: 'goblet' },
  15: { key: 'electroDmg', unit: 'goblet' },
  16: { key: 'anemoDmg', unit: 'goblet' },
  17: { key: 'geoDmg', unit: 'goblet' },
  18: { key: 'dendroDmg', unit: 'goblet' },
  19: { key: 'physBonus', unit: 'goblet' },
  20: { key: 'atkSpd', unit: null },
  21: { key: 'dmgBonus', unit: null },
};

/**
 * The keys the vector carries as a FRACTION and the panel wants as a percent.
 *
 * `1.288` is 128.8% ATK, and the app's `atkPct` is that 128.8. Flat stats (HP,
 * ATK, DEF, EM) are left alone -- `4780` is already 4780.
 */
const GS_PCT = new Set([
  'hpPct', 'atkPct', 'defPct', 'er', 'critRate', 'critDmg', 'healBonus',
  'pyroDmg', 'hydroDmg', 'cryoDmg', 'electroDmg', 'anemoDmg', 'geoDmg',
  'dendroDmg', 'physBonus', 'dmgBonus',
]);

/** The artifact breakpoints a main stat's curve is sampled at. */
const MAIN_LEVELS = [0, 4, 8, 12, 16, 20];

/**
 * The five artifact slots for one character: the SETS from the sample, plus the
 * stat aggregate as ONE substat row per stat.
 *
 * WHY ONE ROW PER STAT. `add stats` is a total, not the pieces it came from.
 * Splitting 128.8% ATK into legal rolls would invent rolls nobody made; one row
 * carrying the total is the same number with none of the claim. The model has no
 * rule against a large substat -- the legality list is a picker, not a validator
 * -- so this is a presentation choice rather than a false statement about the
 * pieces.
 *
 * A note is pushed for any stat the app cannot hold, so a dropped number shows
 * up in the report instead of vanishing.
 */
function artifactSlots(detail, catalogues, mapping, notes) {
  const slots = {};
  SLOT_KEYS.forEach((k) => { slots[k] = blankPiece(); });

  // `detail.sets` is `{ setKey: pieces }` (`{adaycarvedfromrisingwinds: 4}`).
  // A set with N pieces fills N slots in the game's own slot order; the rest
  // stay empty, which is what "4-piece + off-piece" looks like.
  let slot = 0;
  for (const [key, pieces] of Object.entries(detail.sets || {})) {
    const setId = resolveByName(key, catalogues.artifact, mapping.sets);
    if (!setId) continue;
    for (let n = 0; n < Number(pieces) && slot < SLOT_KEYS.length; n += 1) {
      slots[SLOT_KEYS[slot]].setId = catalogueId(setId, catalogues.artifact[setId]);
      slot += 1;
    }
  }

  const rows = [];
  const mains = [];
  (Array.isArray(detail.stats) ? detail.stats : []).forEach((raw, index) => {
    const value = Number(raw) || 0;
    if (!value) return;
    const spec = GS_STAT[index];
    if (!spec || !spec.unit) {
      notes.push({ kind: 'stat-unmapped', index, value });
      return;
    }
    const v = GS_PCT.has(spec.key) ? value * 100 : value;
    if (spec.unit === 'sub') rows.push({ key: spec.key, value: v });
    else mains.push({ slot: spec.unit, key: spec.key, value: v, index });
  });

  // A main stat can only take a value its own curve has, at a breakpoint. The
  // +20 row is where a real goblet or circlet sits, so that is what gets written;
  // anything the curve does not hold is reported rather than rounded into shape.
  for (const m of mains) {
    const level = MAIN_LEVELS.find(
      (lv) => Math.abs((mainStatValue(m.key, lv) ?? NaN) - m.value) < 0.05
    );
    if (level == null) {
      notes.push({ kind: 'stat-unrepresentable', index: m.index, key: m.key, value: m.value });
      continue;
    }
    slots[m.slot].mainStat = m.key;
    slots[m.slot].level = level;
  }

  // Four substat rows per piece, in slot order. The unused rows stay blank:
  // "empty" and "a roll of 0" are different things, and the blank is the honest
  // one.
  SLOT_KEYS.forEach((key, i) => {
    rows.slice(i * SUB_COUNT, (i + 1) * SUB_COUNT).forEach((r, j) => {
      slots[key].subStats[j] = { key: r.key, value: r.value };
    });
  });

  return slots;
}

/* ------------------------------------------------------------------- drops */

/**
 * Every source this team offers, keyed by the LIBRARY key the planner uses.
 *
 * THIS IS IDENTITY ONLY. The numbers a card carries come from the sample, not
 * from here; what this map supplies is the thing the card is ABOUT -- its kind,
 * its icon, its name, and the owner whose panel a formula would read. Sources
 * are built by the planner's own `buildUnitSources` (not a second copy of its
 * rules), so the card the import attaches is the card the pool would have
 * offered.
 */
function teamSources(team, { catalogue, charData, setBonuses }) {
  // The artifact catalogue shape `buildUnitSources` expects, built for the sets
  // this team actually wears rather than all 66.
  const sets = {};
  for (const [id, bonuses] of Object.entries(setBonuses || {})) {
    const meta = catalogue.artifact?.[id];
    if (!meta) continue;
    sets[id] = {
      id,
      chsName: meta.chsName,
      enName: meta.enName,
      setIcon: meta.setIcon,
      bonuses,
    };
  }

  const out = new Map();
  for (const unit of team?.units || []) {
    const charId = unit.char?.id;
    const sources = buildUnitSources(unit, {
      char: catalogue.char?.[charId] || null,
      detail: charData?.[charId] || null,
      weapon: catalogue.weapon?.[unit.weapon?.id] || null,
      sets,
    });
    // Keyed by the LIBRARY key, not by unit: two units carrying one weapon is
    // one weapon, the same reason the library itself is keyed that way.
    for (const s of sources) {
      if (!s.libKey || out.has(s.libKey)) continue;
      out.set(s.libKey, {
        kind: s.kind,
        icon: s.icon,
        iconKind: s.iconKind,
        rank: s.rank || '',
        name: s.name || null,
        owner: s.owner || null,
        libKey: s.libKey,
      });
    }
  }
  return out;
}

/**
 * gcsim's stat-line keys -> the app's panel field, and whether the value is a
 * fraction the panel wants as a percent.
 *
 * `atk%: 0.25` is 25% ATK, so `pct` marks the lines that need the x100. Flat
 * stats (`atk: 527.49`) are already in the panel's own unit and are left alone.
 *
 * `atkspd%` lands on `speed`, which is CARRIED and displayed but deliberately
 * feeds no damage field (see `buff-model.js`): attack speed changes how often
 * you hit, not how hard one hit is.
 */
const LINE_STAT = {
  atk: { key: 'atk' }, hp: { key: 'hp' }, def: { key: 'def' }, em: { key: 'em' },
  'atk%': { key: 'atkPct', pct: true }, 'hp%': { key: 'hpPct', pct: true },
  'def%': { key: 'defPct', pct: true },
  er: { key: 'er', pct: true }, cr: { key: 'critRate', pct: true },
  cd: { key: 'critDmg', pct: true },
  'dmg%': { key: 'dmgBonus', pct: true }, 'atkspd%': { key: 'speed', pct: true },
  'heal%': { key: 'healBonus', pct: true }, 'phys%': { key: 'physBonus', pct: true },
  'pyro%': { key: 'pyroDmg', pct: true }, 'hydro%': { key: 'hydroDmg', pct: true },
  'cryo%': { key: 'cryoDmg', pct: true }, 'electro%': { key: 'electroDmg', pct: true },
  'anemo%': { key: 'anemoDmg', pct: true }, 'geo%': { key: 'geoDmg', pct: true },
  'dendro%': { key: 'dendroDmg', pct: true },
};

/**
 * The `name, [lines]` pairs a CONTAINER status holds.
 *
 * `pre_damage_mods` does not follow the ordinary `[line, line]` shape: it is a
 * flat list of a bare name string followed by THAT sub-status's own line array,
 * repeated (`['varka-a4', ['status: added', 'dmg%: 0.22'], ...]`). Unwrapping it
 * here lets each sub-status go through `statusLines` unchanged.
 */
function nestedStatuses(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    if (typeof list[i] === 'string' && Array.isArray(list[i + 1])) {
      out.push([list[i], list[i + 1]]);
      i += 1;
    }
  }
  return out;
}

/** The keys a `damage` event carries about the HIT rather than about a status. */
const HIT_KEYS = new Set([
  'abil', 'amp', 'attack-tag', 'cata', 'crit', 'damage', 'ele',
  'source_frame', 'target',
]);

/** `25.000000000000004`-style float dust, trimmed after the x100. */
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The stat lines ONE status contributed, as `{ source, key, value }` triples.
 *
 * A status is an array of `"<name>: <value>"` strings (`status: added`,
 * `expiry_frame: 529`, `atk%: 0.25`). The first two say WHEN, not WHAT, so they
 * are dropped. A `reason:` line means the status did NOT apply -- 四风原典 sits
 * in the log with `reason: conditions not met` -- so it contributes nothing and
 * the row gets no card for it, which is the honest reading: it really did
 * nothing on that hit.
 *
 * The table understands two shapes, because the log does:
 *   - a STRING is a local source key, and the log's own lines carry the numbers;
 *   - an OBJECT is keyed by the log's LINE name and holds `{ source, stats }`,
 *     for the statuses whose log says WHICH debuff without saying how much
 *     (`resist_mods: [vvpyro, durin-a1-pyro]`, whose amounts live in the talent
 *     and set text, not in the log).
 */
function statusLines(name, raw, table, note) {
  const out = [];
  const mapping = table[name];
  const lines = (Array.isArray(raw) ? raw : []).map(String).map((s) => {
    const at = s.indexOf(':');
    return at < 0 ? [s.trim(), ''] : [s.slice(0, at).trim(), s.slice(at + 1).trim()];
  }).filter(([k]) => k && k !== 'status' && k !== 'expiry_frame');

  if (typeof mapping === 'string') {
    for (const [lineKey, text] of lines) {
      // `reason: conditions not met` -- 四风原典 and 图莱杜拉的回忆 sit in the log
      // saying exactly this. It is a status that did NOT apply, which is not the
      // same as a line this importer cannot read.
      if (lineKey === 'reason') {
        note({ kind: 'buff-inactive', status: name, line: lineKey, text });
        continue;
      }
      const spec = LINE_STAT[lineKey];
      if (!spec) {
        note({ kind: 'buff-line-unknown', status: name, line: lineKey });
        continue;
      }
      const n = Number(text);
      if (!Number.isFinite(n)) {
        note({ kind: 'buff-inactive', status: name, line: lineKey, text });
        continue;
      }
      out.push({ source: mapping, key: spec.key, value: round6(spec.pct ? n * 100 : n) });
    }
    return out;
  }

  for (const [lineKey] of lines) {
    const entry = mapping[lineKey];
    if (!entry) {
      note({ kind: 'buff-line-unknown', status: name, line: lineKey });
      continue;
    }
    for (const [key, value] of Object.entries(entry.stats || {})) {
      out.push({ source: entry.source, key, value: Number(value) });
    }
  }
  return out;
}

/**
 * The cards ONE ROW carries, from the status lines its own hits produced.
 *
 * Several statuses can name one source (`varka-a1-anemo` and `varka-a1-pyro` are
 * both 法尔伽's p1; `celestialgift-4pc-active-buff` and `-holder-pyro` are both
 * the 4-piece), so the lines are grouped BY SOURCE into one card each -- the
 * shape the planner's own editor produces, and the reason a card holds a list.
 */
function rowDrops(pairs, sourceOf, note) {
  const bySource = new Map();
  for (const p of pairs) {
    if (!bySource.has(p.source)) bySource.set(p.source, []);
    bySource.get(p.source).push({ key: p.key, value: p.value, tag: '' });
  }

  const out = [];
  // Sorted by source key so a file diff stays readable run to run.
  for (const [key, buffs] of [...bySource].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const src = sourceOf(key);
    if (!src) {
      note({ kind: 'buff-source-missing', source: key });
      continue;
    }
    // A FRESH source object per row: a drop is per-entry state, and a shared
    // object would let an edit on one row move on another.
    out.push({ id: `d-${key}`, source: { ...src }, buffs });
  }
  return out;
}