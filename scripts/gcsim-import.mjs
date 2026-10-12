#!/usr/bin/env node
// gcsim -> GS-Plan: turn an exported gcsim run into a `lunaris-config` file.
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
//   `{ kind: "lunaris-config", ... }` -- the exact file the planner's 导入 button
//   reads (see src/lib/config-file.js). No new UI, no new storage: the importer
//   only writes the document the app already knows how to load.
//
// WHAT IS AND IS NOT FAITHFUL (read this before judging the numbers)
//   The AXIS is faithful: every mapped hit becomes a row with the right talent
//   source, the right stage, the right hit count, and the right crit mode. Each
//   row's note records what gcsim actually rolled, so a mismatch is visible and
//   auditable rather than hidden.
//
//   The NUMBERS are NOT gcsim's yet. gcsim's damage depends on the buff stack,
//   the artifact rolls and the talent passives that were live at that frame, and
//   this pass rebuilds only the team's identity (character, weapon, level,
//   constellation, talent LEVELS) plus the artifact SETS. Two things are
//   deliberately left out, because guessing them would be worse than leaving a
//   hole (the codebase's rule: a wrong number is worse than an empty field):
//
//     - artifact stat VALUES. `add stats` is a flat aggregate, and the model
//       stores five slots of legal rolls; splitting the aggregate back into rolls
//       would fabricate piece values that never existed.
//     - buffs. gcsim applies them frame by frame.
//
//   So the rows render, the rotation is right, and the panel alignment is the
//   next step. `--report` prints exactly which numbers came from gcsim.
//
// USAGE
//   node scripts/gcsim-import.mjs [--sample <file>] [--out <file>]
//                                 [--abilities <file>] [--team <file>]
//                                 [--report <file>]
//
//   --sample     the gcsim export (zlib OR gzip OR plain JSON). Default
//                scratch/_gcsim_serve_sample.json
//   --out        where to write the config. Default data/gcsim-config.json
//   --abilities  the name->row table. Default public/data/gcsim-abilities.json
//   --team       take the team from an existing config file instead of rebuilding
//                it (escape hatch; the axis is unaffected)
//   --report     also write the JSON audit report here
//
// EXIT CODE
//   0 when the file was written, even if some hits were unmapped -- the report
//   says which. 1 only when nothing usable could be produced.

import { register } from 'node:module';
// The app writes extensionless relative imports (`./team-model`); Node needs the
// bundler's resolution to find them. Registering the checks' resolver here keeps
// the importer runnable with a plain `node scripts/gcsim-import.mjs`.
register(new URL('../tests/resolve-js.mjs', import.meta.url));

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

const { buildSources } = await import('../src/char-sources.js');
const { SLOT_KEYS, blankPiece } = await import('../src/lib/artifact-model.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

/* ------------------------------------------------------------------ loading */

/** The sample file, decompressing whichever wrapper it happens to carry. */
export function loadSample(file) {
  let buf = fs.readFileSync(file);
  // gcsim's `.gz` export is a bare ZLIB stream (magic 78 9c), not gzip -- piping
  // it through gunzip fails. So sniff the magic bytes rather than the extension:
  // zlib, then gzip, then plain JSON.
  if (buf[0] === 0x78) buf = inflateSync(buf);
  else if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

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
 * @param {object} [input.team]      a team to use verbatim (escape hatch)
 */
export function importGcsim({ sample, mapping, catalogues, charData, team = null }) {
  const details = sample.character_details || [];
  const abilities = mapping.abilities || {};
  const ignored = mapping.ignored || {};

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
    sources[index] = buildSources(data, element, null, id, levelsFor(detail));
  }

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
  let seq = 0;
  const nextId = () => `e${++seq}`;

  // Merge CONSECUTIVE hits of the same ability into one row whose hit count is
  // the run length. gcsim logs one event per part (苍噬 fires twice back to back),
  // and one row per part would bury the rotation in noise.
  let run = null;
  const flush = () => {
    if (!run) return;
    const { ci, ability, hits, total, critAll, critNone, ele } = run;
    run = null;

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
    entries.push({
      id: nextId(),
      charId: idFor[ci].id,
      element: ele ? ele[0].toUpperCase() + ele.slice(1) : null,
      drops: [],
      statOverrides: enemyLevel != null ? { enemyLevel } : {},
      critMode: critAll ? 'crit' : critNone ? 'never' : 'avg',
      picked: { sourceKey: mapped.source, stageIndex },
      summary: { sourceKey: mapped.source, sourceLabel },
      note: noteText(hits, total, critAll, critNone),
    });
  };

  for (const event of damage) {
    const L = event.logs || {};
    const ci = event.char_index;
    if (!run || run.ci !== ci || run.ability !== L.abil) {
      flush();
      run = { ci, ability: L.abil, hits: 0, total: 0, critAll: true, critNone: true, ele: L.ele };
    }
    run.hits += 1;
    run.total += Number(L.damage) || 0;
    run.critAll = run.critAll && Boolean(L.crit);
    run.critNone = run.critNone && !L.crit;
  }
  flush();

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
  };

  const teamOut = team || buildTeam({ idFor, catalogues, mapping });
  const doc = {
    kind: 'lunaris-config',
    version: 1,
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
 * Artifacts are carried as the SETS only (which is what the planner's 2/4-piece
 * buff pool reads) with the slot stats left blank -- see the file header for why
 * the flat `add stats` aggregate is not forced back into rolls.
 */
function buildTeam({ idFor, catalogues, mapping }) {
  const units = idFor.map(({ id, detail }, i) => {
    const weaponId = detail.weapon?.name
      ? resolveByName(detail.weapon.name, catalogues.weapon, mapping.weapons)
      : null;

    // `detail.sets` is `{ setKey: pieces }` (`{adaycarvedfromrisingwinds: 4}`).
    // A set with N pieces fills N slots, in the game's own slot order; the rest
    // stay empty, which is what "4-piece + off-piece" looks like.
    const slots = {};
    SLOT_KEYS.forEach((k) => { slots[k] = blankPiece(); });
    let slot = 0;
    for (const [key, pieces] of Object.entries(detail.sets || {})) {
      const setId = resolveByName(key, catalogues.artifact, mapping.sets);
      if (!setId) continue;
      for (let n = 0; n < Number(pieces) && slot < SLOT_KEYS.length; n += 1) {
        slots[SLOT_KEYS[slot]].setId = catalogueId(setId, catalogues.artifact[setId]);
        slot += 1;
      }
    }

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

/* ---------------------------------------------------------------------- CLI */

/** Read the char detail files only for the characters this run actually uses. */
function readCharData(ids) {
  const out = {};
  for (const id of ids) {
    const file = path.join(ROOT, 'public/data/char/chs', `${id}.json`);
    out[id] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const sampleFile = arg('sample', path.join(ROOT, 'scratch/_gcsim_serve_sample.json'));
  const abilitiesFile = arg('abilities', path.join(ROOT, 'public/data/gcsim-abilities.json'));
  const outFile = arg('out', path.join(ROOT, 'data/gcsim-config.json'));
  const reportFile = arg('report', null);
  const teamFile = arg('team', null);

  const sample = loadSample(sampleFile);
  const mapping = readJson(abilitiesFile);
  const catalogues = {
    char: readJson(path.join(ROOT, 'public/data/charlist.json')),
    weapon: readJson(path.join(ROOT, 'public/data/weaponlist.json')),
    artifact: readJson(path.join(ROOT, 'public/data/artifactlist.json')),
  };

  const ids = (sample.character_details || []).map(
    (cd) => mapping.characters?.[cd.name] || resolveByName(cd.name, catalogues.char)
  );
  if (ids.some((id) => !id)) {
    throw new Error('有 gcsim 角色没能对应到本地 id；先在 gcsim-abilities.json 的 characters 里补上');
  }
  const charData = readCharData([...new Set(ids)]);
  const team = teamFile ? readJson(teamFile).team || readJson(teamFile) : null;

  const { doc, report } = importGcsim({ sample, mapping, catalogues, charData, team });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 2));
  if (reportFile) {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }

  printReport(report, outFile);
  process.exit(0);
}

function printReport(report, outFile) {
  const w = Math.max(24, ...report.byAbility.map((r) => r.ability.length)) + 2;
  console.error('ability -> 行 对照结果（gcsim 击数）');
  for (const r of report.byAbility) {
    const state = r.mapped ? 'ok' : r.stale ? '行名过时!' : r.ignored ? '忽略(反应)' : '未映射';
    console.error(`  ${r.ability.padEnd(w)} ${String(r.hits).padStart(4)}  ${r.char.padEnd(8)} ${state}`);
  }
  console.error('');
  console.error(`damage 事件 ${report.damageEvents} · 映射 ${report.mappedHits} · 忽略 ${report.ignoredHits} · 未映射 ${report.unmappedHits}`);
  console.error(`写出 ${report.entries} 条目 -> ${outFile}`);
  if (report.unmappedHits) {
    console.error('未映射的命中没有写进轴（多为命座/天赋伤害，需要补 public/data/talent-damage.json 后再对照）。');
  }
  console.error('行里的 note 记录了 gcsim 的单击/合计；面板对齐（圣遗物词条与增益栈）是下一步。');
  console.error('导入方法：规划器右上角「导入」选择上面这个 json。');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();