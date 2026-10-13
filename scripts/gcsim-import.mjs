#!/usr/bin/env node
// gcsim -> GS-Plan, from the command line.
//
// THE IMPORT ITSELF IS NOT HERE. It lives in `src/lib/gcsim-import.js`, because
// the planner's 导入 button runs the SAME function in the browser -- one
// importer, so a file imported on the page and a file written by this script are
// the same document. That module's header says what the import promises and what
// it refuses to invent; this file is only the CLI half.
//
// WHAT IS LEFT HERE: read the sample off disk (decompressing whichever wrapper
// it happens to carry), read the dataset the importer needs, write the config.
// The browser half of that job is `src/lib/gcsim-sample.js`.
//
// USAGE
//   node scripts/gcsim-import.mjs [--sample <file>] [--out <file>]
//                                 [--abilities <file>] [--team <file>]
//                                 [--report <file>]
//
//   --sample     the gcsim export (zlib OR gzip OR plain JSON). Default
//                scratch/_gcsim_serve_sample.json
//   --out        where to write the config. Default data/gcsim-config.json
//   --abilities  the name -> row table AND the status -> source table. Default
//                public/data/gcsim-abilities.json
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
// `src/lib/buff-sources.js` reaches `components/BuffCard.jsx` for the one table
// that names a source kind. Registering the JSX loader as well is what lets the
// SAME source-building code run here instead of this script growing a second
// copy of it -- two copies of that table is the drift the module warns about.
register(new URL('../tests/jsx-loader.mjs', import.meta.url));

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// The importer ITSELF lives in `src/`, so the planner can run it in the browser
// too. Registered ABOVE, because it imports extensionless paths and reaches a
// `.jsx` component through `buff-sources` -- Node needs both hooks before the
// first `await import` of anything under `src/`.
const { importGcsim, resolveByName } = await import('../src/lib/gcsim-import.js');
// Re-exported so `tests/check-gcsim-import.mjs` can keep importing them from
// here, where it has always found them.
export { importGcsim, resolveByName };
// The OUT writer is the app's own (see `buildConfigFile`), so the file this
// script produces and the file the export button produces cannot drift apart.
const { buildConfigFile } = await import('../src/lib/config-file.js');

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

/**
 * The artifact set bonuses for the sets a run uses, keyed by set id.
 *
 * `buildUnitSources` needs a set's 2/4-piece TEXT to name the source it offers;
 * the values come from the library like every other source's do. Only the sets
 * this team actually wears are read -- the other sixty would be sixty file
 * reads for nothing.
 */
function readSetBonuses(ids) {
  const out = {};
  for (const id of ids) {
    const file = path.join(ROOT, 'public/data/artifact/chs', `${id}.json`);
    if (!fs.existsSync(file)) continue;
    const bonuses = readJson(file)?.info?.setBonuses;
    if (bonuses) out[id] = bonuses;
  }
  return out;
}

function main() {
  const sampleFile = arg('sample', path.join(ROOT, 'scratch/_gcsim_serve_sample.json'));
  const abilitiesFile = arg('abilities', path.join(ROOT, 'public/data/gcsim-abilities.json'));
  const outFile = arg('out', path.join(ROOT, 'data/gcsim-config.json'));
  const reportFile = arg('report', null);
  const teamFile = arg('team', null);

  const sample = loadSample(sampleFile);
  const mapping = readJson(abilitiesFile);
  const talentDamage = readJson(path.join(ROOT, 'public/data/talent-damage.json'));
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

  // The sets this run wears, resolved exactly as `buildTeam` resolves them.
  const setIds = [...new Set(
    (sample.character_details || []).flatMap((cd) => Object.keys(cd.sets || {}).map(
      (key) => resolveByName(key, catalogues.artifact, mapping.sets)
    )).filter(Boolean).map(String)
  )];
  const setBonuses = readSetBonuses(setIds);

  const { doc, report } = importGcsim({
    sample, mapping, catalogues, charData, talentDamage, team, setBonuses,
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  // WRITTEN THROUGH THE APP'S OWN WRITER, so the file this produces is exactly
  // the file the export button produces: pooled, pretty-printed, and with the
  // kind/version the reader expects rather than a copy of them kept in step by
  // hand.
  fs.writeFileSync(outFile, buildConfigFile({ team: doc.team, axes: doc.axes, activeId: doc.activeId }));
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
    console.error('未映射的命中没有写进轴；如果它是命座/天赋伤害，先在 talent-damage.json 里标记 damage:true 并填 mult，再把它加进 gcsim-abilities.json。');
  }

  // The panel: what crossed over, and what the app had nowhere to put.
  if (report.statNotes?.length) {
    for (const n of report.statNotes) {
      if (n.kind === 'stat-unmapped') {
        console.error(`词条 index ${n.index} = ${n.value} 没有对应的本地字段，没写进面板。`);
      } else {
        console.error(`词条 ${n.key} = ${n.value} 不在圣遗物曲线上，没写进面板。`);
      }
    }
  } else {
    console.error('词条：add stats 的数值全部写进了面板。');
  }

  // The buffs: which source reached how many rows, and everything unreadable.
  const cards = report.buffs?.cards || [];
  if (cards.length) {
    console.error(`增益：${cards.length} 个来源按 sample 逐条挂卡 ——`);
    for (const c of cards) {
      const label = c.name?.chs || c.name?.en || c.libKey;
      console.error(`  ${String(c.rows).padStart(4)} 条 / ${String(c.hits).padStart(4)} 击  ${label}  (${c.libKey})`);
    }
  } else {
    console.error('增益：这条日志里没有可挂的状态；行里只有面板。');
  }
  for (const n of report.buffs?.notes || []) {
    if (n.kind === 'buff-status-unknown') {
      console.error(`增益：状态「${n.status}」不在 gcsim-abilities.json 的 buffs 表里，这几击没挂卡。`);
    } else if (n.kind === 'buff-line-unknown') {
      console.error(`增益：状态「${n.status}」的 ${n.line} 没有对应的本地字段，这一项没挂上。`);
    } else if (n.kind === 'buff-inactive') {
      console.error(`增益：状态「${n.status}」的 ${n.line} =「${n.text}」，这一击没生效，不挂卡。`);
    } else if (n.kind === 'buff-source-missing') {
      console.error(`增益：来源 ${n.source} 在这支队伍里不存在，挂在它上面的数值没能落到行里。`);
    } else if (n.kind === 'buff-calc-flat-no-rule') {
      console.error(`增益：「${n.ability}」带着附加伤害 ${n.value}，但 calc 表里没有可归属的规则，这几击没挂这张卡。`);
    } else if (n.kind === 'buff-calc-flat-unexplained') {
      console.error(`增益：「${n.ability}」的附加伤害 ${n.value} 拆不成 calc 表里的来源（最接近 ${n.closest}），整笔挂给了第一条规则。`);
    } else if (n.kind === 'buff-calc-ignore-def-unexplained') {
      console.error(`增益：无视防御 ${n.value}% 拆不成 calc 表里的份额，整笔挂给了第一条规则。`);
    } else {
      console.error(`增益：${n.status} 的 ${n.key} 在一行内出现了两个值（${n.from} / ${n.to}），取了第一个。`);
    }
  }

  console.error('行里的 note 记录了 gcsim 的单击/合计；导入方法：规划器右上角「导入」选择上面这个 json。');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();