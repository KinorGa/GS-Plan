// gcsim source -> the human-auditable mapping table (public/data/gcsim-abilities.json).
//
// WHY THIS EXISTS
//   `gcsim-abilities.json` used to name every ability by hand, which kept it
//   honest but capped it at the four characters someone had typed out. This
//   script reads gcsim's own Go source and proposes the same table for every
//   character, so a run of ANY team has somewhere to land.
//
// WHAT IS AUTHORITATIVE
//   Ability names come from the `Abil:` field of every `info.AttackInfo{...}` a
//   character package writes. The SOURCE is normally the file the block sits in
//   (attack/charge/plunge -> normal, skill -> skill, burst -> burst, cons ->
//   constellation, asc -> passive), but a skill-state attack (法尔伽's 狂飙突进
//   normals) lives in attack.go while its ROW is on the skill, so a name that
//   does not resolve inside the file's own source is retried against EVERY
//   source and only accepted when exactly one row answers. A name this cannot
//   place is left OUT and listed in the report: a missing row shows up in the
//   importer's report, a wrong row is a confident lie.
//
// THE TRANSLATION PROBLEM
//   gcsim names abilities in English; the local table keys stages by the CHINESE
//   row name (`stages[].chs`). public/data/char/en/<id>.json carries the SAME
//   rows in the SAME order (the generator asserts it), so
//   matching an English row and reading the Chinese one at that index translates.
//
// USAGE
//   node scripts/gcsim-map.mjs [--src <dir>] [--write]
//   Default is a dry run that prints coverage; --write updates the table.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'gcsim-abilities.json');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = argOf('--src', process.env.GCSIM_SRC || 'D:/CPT/tmp/gcsim-report/allgo');
const WRITE = args.includes('--write');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const charlist = readJson(path.join(DATA, 'charlist.json'));
const weaponlist = readJson(path.join(DATA, 'weaponlist.json'));
const artifactlist = readJson(path.join(DATA, 'artifactlist.json'));
const talentDamage = readJson(path.join(DATA, 'talent-damage.json'));
const current = readJson(OUT);

/* ---------------------------------------------------------------- catalogues */

/**
 * The local id a gcsim name denotes: an exact English-name match first, then a
 * UNIQUE prefix on either side ("raiden" -> "Raiden Shogun"). Ambiguity is
 * reported rather than picked.
 */
function resolveCatalog(name, catalog, idOf) {
  const n = norm(name);
  for (const [id, e] of Object.entries(catalog)) if (norm(e.enName) === n) return { id: String(idOf(id, e)), exact: true };
  // gcsim uses the given name where the game uses the clan name too
  // ("ayaka" -> 神里绫华 / "Kamisato Ayaka"), so a unique prefix OR suffix counts.
  const one = (pred) => Object.entries(catalog).filter(([, e]) => pred(norm(e.enName)));
  let hits = one((en) => en.startsWith(n) || n.startsWith(en));
  if (hits.length !== 1) { const s = one((en) => en.endsWith(n)); if (s.length === 1) hits = s; }
  if (hits.length === 1) return { id: String(idOf(hits[0][0], hits[0][1])), exact: false };
  return { id: null, hits: hits.map(([id, e]) => String(idOf(id, e))) };
}

if (!fs.existsSync(SRC)) {
  throw new Error(
    `找不到 gcsim 源码目录 ${SRC}。可以从 github.com/genshinsim/gcsim 取一份源码，\n` +
    "把 internal/ 下的 .go 摊平成 <dir>/gcsim-main__<path>__<file>.go，或用 --src/GCSIM_SRC 指到它。"
  );
}
const sources = fs.readdirSync(SRC);

// The canonical (full) gcsim name of a weapon/set is the `zz_*.dm.go` token, NOT
// the package folder -- the folder is a short alias ("alley" for "The Alley
// Flash"). The log carries the canonical name, so the override has to be keyed
// by it.
function canonical(dirMatch) {
  const out = new Map();
  for (const f of sources) {
    const m = dirMatch.exec(f);
    if (!m) continue;
    const tok = /^zz_(.+)\.dm\.go$/.exec(m[2]);
    out.set(m[1], tok ? tok[1] : m[1]);
  }
  return out;
}
const weaponCanon = canonical(/internal__weapons__[a-z]+__(.+?)__(.+)$/);
const setCanon = canonical(/internal__artifacts__(.+?)__(.+)$/);
const charDirs = new Set();
for (const f of sources) {
  const m = /internal__characters__(.+?)__(.+)$/.exec(f);
  if (m) charDirs.add(m[1] === 'common' ? 'traveler' : m[1]);
}

/* ------------------------------------------------------------------- rows */

const EN = path.join(DATA, 'char', 'en');
const CHS = path.join(DATA, 'char', 'chs');
const detailFile = (dir, id) => {
  const names = fs.readdirSync(dir).filter((x) => x === id + '.json' || x.startsWith(id + '_'));
  return names.length ? path.join(dir, names[0]) : null;
};

/**
 * One character's rows, per source, in EN and CHS. Returns null when the id has
 * no detail file at all (the 旅行者, whose rows live under 10000005_<ELEMENT>).
 */
function localRows(id) {
  const enPath = detailFile(EN, id), chsPath = detailFile(CHS, id);
  if (!enPath || !chsPath) return null;
  const en = readJson(enPath), chs = readJson(chsPath);
  const out = { names: {}, rows: {} };
  for (const key of Object.keys(en.skills || {})) {
    out.names[key] = en.skills[key].name || '';
    const enRows = Object.keys(en.skills[key].multipliers || {});
    const chsRows = Object.keys(chs.skills?.[key]?.multipliers || {});
    if (chsRows.length !== enRows.length) {
      throw new Error(`行数不一致 ${id} ${key}: en ${enRows.length} vs chs ${chsRows.length} —— en/chs 漂移了，stage 会指错行`);
    }
    out.rows[key] = enRows.map((name, i) => ({
      en: name,
      chs: chsRows[i] ?? null,
      numeric: en.skills[key].multipliers[name].some((v) => /%/.test(String(v))),
    }));
  }
  return out;
}

/* ------------------------------------------------------------------ match */

const NA_ROW = /^(\d+)-Hit DMG$/;

/** The stage a name denotes WITHIN one source's rows, or null. */
function stageInRows(source, name, src) {
  const rows = src?.rows?.[source];
  if (!rows || !rows.length) return null;
  const nm = norm(name);
  const numeric = rows.filter((r) => r.numeric);

  if (/^Normal \d+$/.test(name)) {
    const na = rows.filter((r) => NA_ROW.test(r.en));
    return na[Number(name.split(' ')[1])] || null;
  }
  if (/^Normal$/.test(name)) return rows.find((r) => NA_ROW.test(r.en)) || null;
  if (/^(Charge|Charge Attack|Charged Attack)$/.test(name)) {
    return rows.find((r) => r.numeric && /Charged Attack/.test(r.en))
      || rows.find((r) => r.numeric && /^Charge/.test(r.en)) || null;
  }
  if (/^(Low Plunge|High Plunge)( Attack)?$/.test(name)) return rows.find((r) => /Low\/High Plunge/.test(r.en)) || null;
  if (/^Plunge Collision$/.test(name)) return rows.find((r) => /^Plunge DMG$/.test(r.en)) || null;

  let r = rows.find((x) => norm(x.en) === nm) || rows.find((x) => norm(x.en) === nm + 'dmg');
  if (r) return r;
  for (const d of [...name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1])) {
    const dn = norm(d.replace(/\d+/g, ''));
    if (dn.length < 4 || dn === 'initial' || dn === 'wave') continue;
    r = rows.find((x) => norm(x.en).includes(dn));
    if (r) return r;
  }
  const sn = norm(name.replace(/\s*\([^)]*\)/g, '').replace(/\bN\b/g, '').replace(/\bNormal\b/gi, ''));
  if (sn.length >= 4) {
    r = rows.find((x) => norm(x.en) === sn) || rows.find((x) => norm(x.en) === sn + 'dmg');
    if (r) return r;
    r = rows.find((x) => x.numeric && norm(x.en).includes(sn));
    if (r) return r;
    r = rows.find((x) => x.numeric && sn.includes(norm(x.en)) && norm(x.en).length >= 5);
    if (r) return r;
  }
  const localName = norm(src?.names?.[source]);
  if (nm === localName) return numeric[0] || null;
  // gcsim shortens a long talent name to its tail ("Soumetsu" for
  // "Kamisato Art: Soumetsu"), so the local name ENDING in the ability name
  // also denotes the main hit.
  if (nm.length >= 4 && localName.endsWith(nm)) return numeric[0] || null;
  return null;
}

/**
 * A name -> `{ source, row }`, trying the file's own source first and then every
 * other one, accepting a hit from another source only when it is the ONLY one.
 */
function matchAny(name, src, prefer) {
  if (prefer) {
    const r = stageInRows(prefer, name, src);
    if (r) return { source: prefer, row: r };
  }
  const found = [];
  for (const s of ['normalattack', 'elementalskill', 'elementalburst']) {
    if (s === prefer) continue;
    const r = stageInRows(s, name, src);
    if (r) found.push({ source: s, row: r });
  }
  if (found.length === 0 && prefer && /\(initial\)/i.test(name)) {
    const main = (src.rows[prefer] || []).find((r) => r.numeric);
    if (main) return { source: prefer, row: main };
  }
  return found.length === 1 ? found[0] : null;
}

/* -------------------------------------------------------------- extraction */

/**
 * Every `Abil:` in a file: `{ name }`, `{ template }` or `{ unknown }`.
 *
 * An Abil is not always inside an `info.AttackInfo{...}` literal -- an
 * `ai.Abil = "..."` on a value built elsewhere is just as real, and reading only
 * the literals silently dropped a quarter of the abilities. So every `Abil:` in
 * the file counts; the AttackTag beside it is not read here, because the source
 * is usually the file and the name is retried against every source anyway.
 */
function abilEntries(text) {
  const out = [];
  const re = /Abil:\s*("(?:[^"\\]|\\.)*"|fmt\.Sprintf\(\s*"(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(text))) {
    const expr = m[1];
    const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(expr);
    if (lit) { out.push({ name: lit[1] }); continue; }
    if (/^fmt\.Sprintf/.test(expr)) {
      const inner = /"((?:[^"\\]|\\.)*)"/.exec(expr);
      out.push(inner ? { template: inner[1] } : { unknown: expr });
      continue;
    }
    const vv = new RegExp(expr + '\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
    out.push(vv ? { name: vv[1] } : { unknown: expr });
  }
  return out;
}

const GO_KEYS = "gcsim-main__pkg__core__keys__character.dm.go";
const GO_SHORTCUT = "gcsim-main__pkg__shortcut__character.dm.go";

const SOURCE_OF_FILE = { attack: 'normalattack', charge: 'normalattack', plunge: 'normalattack', aimed: 'normalattack', skill: 'elementalskill', burst: 'elementalburst' };

function filesByChar() {
  const byChar = new Map();
  for (const f of sources) {
    const m = /internal__characters__(.+?)__(.+)$/.exec(f);
    if (!m) continue;
    const ch = m[1] === 'common' ? 'traveler' : m[1];
    if (!byChar.has(ch)) byChar.set(ch, []);
    byChar.get(ch).push({ part: m[2].replace(/\.go$/, ''), full: path.join(SRC, f) });
  }
  return byChar;
}

const idOfChar = (ch) => resolveCatalog(ch, charlist, (id) => id).id;
function slotStage(id, slot) {
  const entry = talentDamage.characters?.[id]?.[slot];
  if (!entry || entry.damage !== true || !(Number(entry.mult) > 0)) return null;
  return entry.basis ? `${entry.basis}倍率伤害` : '伤害';
}

function abilitiesForChar(ch, files) {
  const id = idOfChar(ch);
  if (!id) return { error: `角色 ${ch} 找不到本地 id` };
  const src = localRows(id);
  if (!src) return { error: `角色 ${ch} (${id}) 缺 en/chs 数据` };
  const abilities = {};
  const misses = [];
  for (const { part, full } of files) {
    if (/zz_.*\.dm\.go$/.test(part)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const prefer = SOURCE_OF_FILE[part] || null;
    for (const e of abilEntries(text)) {
      if (e.unknown) { misses.push(`${ch} | ${part} | <var:${e.unknown}>`); continue; }
      const raw = e.name ?? e.template;
      const cm = /\(C(\d)\)/.exec(raw) || /\bC(\d)\b/.exec(raw);
      const am = /\(A(\d)\)/.exec(raw);
      const slot = cm ? `const${cm[1]}` : am ? `p${am[1]}` : null;
      if (slot) {
        const stage = slotStage(id, slot);
        if (stage) abilities[raw] = { source: slot, stage };
        else misses.push(`${ch} | ${slot} | ${raw}`);
        continue;
      }
      if (e.template) {
        for (const [name, hit] of expandTemplate(e.template, src, prefer)) {
          if (hit) abilities[name] = { source: hit.source, stage: hit.row.chs };
          else misses.push(`${ch} | ${part} | ${name}`);
        }
        continue;
      }
      const hit = matchAny(raw, src, prefer);
      // a damage ability may only land on a row that carries a multiplier
      if (hit && !hit.row.numeric) {
        misses.push(`${ch} | ${part} | ${raw} (matched a non-damage row: ${hit.row.en})`);
      } else if (hit) abilities[raw] = { source: hit.source, stage: hit.row.chs };
      else misses.push(`${ch} | ${part} | ${raw}`);
    }
  }
  return { id, abilities, misses };
}

/** `<base> %v` -> one concrete ability name per row the base names. */
function expandTemplate(template, src, prefer) {
  const base = template.replace(/%[vsd]|%\d*v/g, '').trim();
  const out = [];
  const naRows = (s) => (src.rows[s] || []).filter((r) => NA_ROW.test(r.en));
  if (/^Normal$/i.test(base)) {
    naRows('normalattack').forEach((r, i) => out.push([`Normal ${i}`, { source: 'normalattack', row: r }]));
    return out;
  }
  const bn = norm(base.replace(/normal|charge/gi, ''));
  if (bn.length < 3) return out;
  // the rows that name the base, in every source; the file's own source wins
  const order = [prefer, 'normalattack', 'elementalskill', 'elementalburst'].filter(Boolean);
  for (const s of [...new Set(order)]) {
    const hits = (src.rows[s] || []).filter((r) => r.numeric && norm(r.en).includes(bn));
    if (hits.length) { hits.forEach((r, i) => out.push([`${base} ${i}`, { source: s, row: r }])); return out; }
  }
  return out;
}

/* ------------------------------------------------------------------- main */

const table = {};
const misses = [];
const errors = [];
const byChar = filesByChar();
for (const ch of [...byChar.keys()].sort()) {
  if (ch === 'traveler') { errors.push('traveler: 数据分元素存在 10000005_<ELEMENT>.json，暂不生成'); continue; }
  const res = abilitiesForChar(ch, byChar.get(ch));
  if (res.error) { errors.push(res.error); continue; }
  table[res.id] = res.abilities;
  misses.push(...res.misses);
}

const weaponOv = {}, weaponMiss = [];
for (const [dir, canon] of weaponCanon) {
  const r = resolveCatalog(canon, weaponlist, (id) => id);
  if (r.id && !r.exact) weaponOv[canon] = r.id;
  else if (!r.id) weaponMiss.push(`${dir} -> ${canon} (${r.hits.join('/') || 'none'})`);
}
const setOv = {}, setMiss = [];
for (const [dir, canon] of setCanon) {
  const r = resolveCatalog(canon, artifactlist, (id, e) => e.setId);
  if (r.id && !r.exact) setOv[canon] = r.id;
  else if (!r.id) setMiss.push(`${dir} -> ${canon} (${r.hits.join('/') || 'none'})`);
}
const charOv = {}, charMiss = [];
{
  // gcsim's OWN name table, not the folder names: an export names a character by
  // its `keys.Char.String()` ("kamisatoayaka"), while a config may use any alias
  // in pkg/shortcut ("ayaka"). The key resolves through the catalogue's English
  // name for free; an alias that does not is written here so a run that carries
  // either spelling lands.
  const constToKey = new Map();
  const keysGo = fs.readFileSync(path.join(SRC, GO_KEYS), "utf8");
  for (const m of keysGo.matchAll(/^\t([A-Z]\w+)\s+\/\/\s+(\w+)$/gm)) constToKey.set(m[1], m[2]);
  const shortcutGo = fs.readFileSync(path.join(SRC, GO_SHORTCUT), "utf8");
  for (const m of shortcutGo.matchAll(/^\t"([a-z0-9]+)":\s+keys\.(\w+),$/gm)) {
    const key = constToKey.get(m[2]);
    if (!key) continue;
    const byKey = resolveCatalog(key, charlist, (id) => id);
    if (!byKey.id) { charMiss.push(`${m[1]} -> ${key}`); continue; }
    if (!resolveCatalog(m[1], charlist, (id) => id).id) charOv[m[1]] = byKey.id;
  }
}
for (const ch of [...charDirs].sort()) {
  if (resolveCatalog(ch, charlist, (id) => id).id) continue;
  if (!charOv[ch]) charMiss.push(ch);
}

const mapped = Object.values(table).reduce((a, b) => a + Object.keys(b).length, 0);
console.log(`characters: ${charDirs.size} (resolved ${Object.keys(table).length}), errors: ${errors.length}`);
for (const e of errors) console.log('  ! ' + e);
console.log(`abilities: ${mapped} mapped, ${misses.length} missed => ${(100 * mapped / (mapped + misses.length)).toFixed(1)}%`);
console.log(`char overrides ${Object.keys(charOv).length} (${charMiss.length} unresolved), weapon ${Object.keys(weaponOv).length} (${weaponMiss.length}), set ${Object.keys(setOv).length} (${setMiss.length})`);
if (charMiss.length) console.log('  char unresolved: ' + charMiss.join(', '));
if (weaponMiss.length) console.log('  weapon unresolved: ' + weaponMiss.join(', '));
if (setMiss.length) console.log('  set unresolved: ' + setMiss.join(', '));
if (args.includes('--report')) { console.log('--- misses ---'); console.log(misses.join('\n')); }
if (args.includes('--dump')) {
  for (const id of argOf('--dump', '').split(',')) console.log('=== ' + id + ' ===\n' + JSON.stringify(table[id], null, 1));
}

if (WRITE) {
  const merged = {
    _comment: [
      "gcsim -> GS-Plan 对照表。由 scripts/gcsim-map.mjs 从 gcsim 的 Go 源码生成，",
      "不要手改：改了就重跑  node scripts/gcsim-map.mjs --write 。",
      "",
      "   node scripts/gcsim-map.mjs            # 只打印覆盖率",
      "   node scripts/gcsim-map.mjs --report   # 再列出所有没配上的 ability",
      "",
      "abilities 的键是 gcsim 日志里的 ability 名，值是 { source, stage }。",
      "stage 用「中文行名」：行名是人能核对的，下标会随天赋表增删而整体漂移、",
      "且漂移后不报错。",
      "",
      "只写「推断不出来」的特例：characters 是 pkg/shortcut 里那些和英文名对不上的",
      "别名（英文名本身走代码推断），weapons/sets 目前都能推断所以是空的。",
      "",
      "生成器不猜：配不上的 ability 宁可不写（导入时会出现在报告里），也不写一个",
      "像是对的错行。旅行者按元素分文件，暂不生成。",
    ],
    characters: { ...charOv },
    weapons: { ...weaponOv },
    sets: { ...current.sets, ...setOv },
    abilities: table,
    buffs: current.buffs,
    extraSources: current.extraSources,
    ignored: current.ignored,
  };
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}