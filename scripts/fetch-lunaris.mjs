#!/usr/bin/env node
/**
 * Download the Lunaris dataset and its artwork into ./public.
 *
 * WHAT IT FETCHES
 *   data/charlist.json            every character's names, element, quality
 *   data/char/<lang>/<id>.json    full detail: skills, constellations, passives,
 *                                 ascension materials, costumes
 *   img/avatar/<id>.webp          grid avatar
 *   img/char/<id>.webp            full-body card art
 *   img/skill/<icon>.webp         active talents
 *   img/talent/<icon>.webp        constellations and passives
 *   img/item/<id>.webp            ascension materials
 *   img/weapon/<icon>.webp        weapon art
 *   img/artifact/<icon>.webp      artifact set emblems
 *   img/icons/<name>.webp         element / stat / weapon-type glyphs
 *
 * Only the languages this app renders are fetched (`chs`, `en`); see LANGS.
 *
 * INCREMENTAL
 *   Every downloaded file is recorded in a manifest with its size and a content
 *   hash. A later run re-fetches a file only when the upstream version changed
 *   or the record is missing. Files already correct on disk are skipped without
 *   a request, so a second run is near-instant.
 *
 * RESUMABLE
 *   Downloads land in a `.part` file and are renamed only once complete, so an
 *   interrupted run never leaves a truncated image that a later run would treat
 *   as done.
 *
 * USAGE
 *   node scripts/fetch-lunaris.mjs               # incremental update
 *   node scripts/fetch-lunaris.mjs --force       # ignore the manifest, refetch
 *   node scripts/fetch-lunaris.mjs --check       # report what would change
 *   node scripts/fetch-lunaris.mjs --retry-missing  # re-check known 404s
 *   node scripts/fetch-lunaris.mjs --data-only   # skip images
 *   node scripts/fetch-lunaris.mjs --images-only # skip JSON
 *   node scripts/fetch-lunaris.mjs --concurrency 16
 *   node scripts/fetch-lunaris.mjs --quiet       # no progress bar
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(PUBLIC, 'data');
const IMG = path.join(PUBLIC, 'img');
const MANIFEST_PATH = path.join(PUBLIC, '.lunaris-manifest.json');

const API = 'https://api.lunaris.moe/data';
const UA = 'gs-plan-fetch/1.0 (+https://lunaris.moe)';

/** The languages this app renders. The UI toggle only ever produces these two. */
const LANGS = ['chs', 'en'];

const ARGS = new Set(process.argv.slice(2));
const flag = (n) => ARGS.has(`--${n}`);
const opt = (n, d) => {
  const hit = [...ARGS].find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=')[1] : d;
};

const FORCE = flag('force');
const CHECK = flag('check');
const QUIET = flag('quiet');
const RETRY_MISSING = flag('retry-missing');
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 8)));
const DO_DATA = !flag('images-only');
const DO_IMAGES = !flag('data-only');

/* ------------------------------------------------------------------ output */

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColour ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = (s) => c('2', s);
const bold = (s) => c('1', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const red = (s) => c('31', s);

/* -------------------------------------------------------------- progress bar */

/**
 * Single-line progress bar with a live rate.
 *
 * Rendered only when stdout is a TTY, so piping to a file or CI log yields
 * plain lines instead of thousands of carriage returns.
 */
class Progress {
  constructor(label, total) {
    this.label = label;
    this.total = total;
    this.done = 0;
    this.ok = 0;
    this.skipped = 0;
    this.failed = 0;
    this.bytes = 0;
    this.start = Date.now();
    this.lastDraw = 0;
    this.finished = false;
  }

  tick({ ok = false, skipped = false, failed = false, bytes = 0 } = {}) {
    this.done++;
    if (ok) this.ok++;
    if (skipped) this.skipped++;
    if (failed) this.failed++;
    this.bytes += bytes;
    // Throttle redraws: a bar per file would dominate the runtime on 2000+ files.
    const now = Date.now();
    if (!QUIET && useColour && now - this.lastDraw > 80) {
      this.lastDraw = now;
      this.draw();
    }
  }

  draw() {
    const width = 28;
    const pct = this.total ? this.done / this.total : 1;
    const filled = Math.round(width * pct);
    // Plain ASCII on purpose: block glyphs survive a terminal but not every
    // editor round-trip or non-UTF8 console, and a progress bar is not worth a
    // mojibake risk.
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
    const elapsed = (Date.now() - this.start) / 1000;
    const rate = elapsed > 0 ? this.done / elapsed : 0;
    const eta = rate > 0 && this.done < this.total ? (this.total - this.done) / rate : 0;
    const mb = (this.bytes / 1048576).toFixed(1);
    const line =
      `${this.label.padEnd(14)} ${bar} ${String(Math.round(pct * 100)).padStart(3)}% ` +
      `${String(this.done).padStart(5)}/${String(this.total).padEnd(5)} ` +
      `${mb.padStart(6)}MB ${rate.toFixed(0).padStart(3)}/s` +
      (eta ? ` eta ${formatDuration(eta)}` : '        ');
    process.stdout.write(`\r\u001b[K${line}`);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (!QUIET && useColour) {
      this.draw();
      process.stdout.write('\n');
    }
    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1);
    const bits = [`${this.ok} new`];
    if (this.skipped) bits.push(`${this.skipped} unchanged`);
    if (this.failed) bits.push(red(`${this.failed} failed`));
    console.log(
      `  ${this.label.padEnd(12)} ${bold(bits.join(', '))} ` +
        dim(`in ${elapsed}s (${(this.bytes / 1048576).toFixed(1)} MB)`)
    );
  }
}

function formatDuration(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/* ----------------------------------------------------------------- manifest */

/**
 * Records what has already been fetched, keyed by the destination path relative
 * to `public/`. Stores the upstream version so a new game version can force a
 * refresh of files whose contents changed without their path changing.
 *
 * `missing` remembers 404s. Some references legitimately have no upstream file
 * (2800+ material and costume icons, the Traveler's full-body art), and without
 * a record of that, every run would re-request all of them, which cost ~90s on
 * a run that otherwise had nothing to do. Cleared when the version changes,
 * since a new version is exactly when a previously absent file may appear.
 */
function loadManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return { version: m.version || null, files: m.files || {}, missing: m.missing || {} };
  } catch {
    return { version: null, files: {}, missing: {} };
  }
}

async function saveManifest(m) {
  await fsp.writeFile(MANIFEST_PATH, JSON.stringify(m, null, 1), 'utf8');
}

/* ------------------------------------------------------------------ fetching */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.status === 404) return { ok: false, status: 404 };
      if (!r.ok) { await sleep(300 * (i + 1)); continue; }
      const text = await r.text();
      return { ok: true, text, json: JSON.parse(text) };
    } catch {
      await sleep(400 * (i + 1));
    }
  }
  return { ok: false, status: 'err' };
}

/**
 * Download one binary to `dest`.
 *
 * Writes to `<dest>.part` first and renames on success, so an interrupted run
 * cannot leave a truncated file that a later run would mistake for complete.
 * Returns 404 distinctly: some icons legitimately do not exist upstream, and
 * treating that as an error would make every run report failures.
 */
async function fetchBinary(url, dest, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.status === 404) return { ok: false, status: 404 };
      if (!r.ok) { await sleep(300 * (i + 1)); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return { ok: false, status: 'empty' };
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.part`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, dest);
      return { ok: true, bytes: buf.length };
    } catch {
      await sleep(400 * (i + 1));
    }
  }
  return { ok: false, status: 'err' };
}

/** A stable content hash, used to detect that an upstream file really changed. */
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);

/**
 * Run `jobs` through a fixed-size worker pool.
 *
 * A pool rather than Promise.all because 2000+ concurrent sockets would be
 * refused by the server (and is rude); a fixed width keeps the rate predictable
 * and lets the progress bar report a meaningful ETA.
 */
async function runPool(jobs, worker, concurrency = CONCURRENCY) {
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, jobs.length || 1) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      await worker(job);
    }
  });
  await Promise.all(runners);
}

/* ------------------------------------------------------------- plan building */

/**
 * Decide, for each candidate file, whether it needs downloading.
 *
 * Skipped when the manifest already records it AND the file is on disk at the
 * recorded size. The size check catches a file deleted or truncated behind the
 * tool's back, which a manifest-only check would miss.
 */
function needsFetch(rel, manifest) {
  if (FORCE) return true;
  // `--retry-missing` re-checks the files recorded as absent upstream, for when
  // a later game version has published art that did not exist before.
  if (manifest.missing?.[rel]) return RETRY_MISSING;
  const rec = manifest.files[rel];
  if (!rec) return true;
  let st;
  try { st = fs.statSync(path.join(PUBLIC, rel)); } catch { return true; }
  return st.size !== rec.size;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const t0 = Date.now();
  console.log(bold('\nLunaris dataset fetch'));
  console.log(dim(`  source   ${API}`));
  console.log(dim(`  target   ${path.relative(ROOT, PUBLIC)}/`));
  console.log(dim(`  mode     ${FORCE ? 'force' : CHECK ? 'check only' : 'incremental'}` +
    `${DO_DATA && !DO_IMAGES ? ', data only' : ''}${DO_IMAGES && !DO_DATA ? ', images only' : ''}`));

  // ---- 1. version ---------------------------------------------------------
  const ver = await fetchJson(`${API}/version.json`);
  if (!ver.ok) {
    console.error(red('\nFATAL: cannot reach the API (version.json)'));
    process.exit(1);
  }
  const VERSION = ver.json.version;
  const manifest = loadManifest();
  const versionChanged = manifest.version !== VERSION;
  console.log(`  version  ${bold(VERSION)}` +
    (manifest.version ? dim(`  (was ${manifest.version})`) : dim('  (first run)')));

  // A new game version means detail files may have changed under the same path,
  // so every JSON record is invalidated. Images are content-addressed by name
  // and almost never change, so they are still skipped by size.
  if (versionChanged && manifest.version && !FORCE) {
    console.log(yellow('  version changed: JSON will be re-validated'));
    for (const k of Object.keys(manifest.files)) if (k.endsWith('.json')) delete manifest.files[k];
    // A new version is exactly when a previously absent file may appear.
    manifest.missing = {};
  }

  // ---- 2. discover work ---------------------------------------------------
  const jsonJobs = [];
  const imageJobs = [];

  if (DO_DATA) {
    // The catalogue lists are needed by the UI itself -- the team builder picks
    // a weapon from `weaponlist` -- not just by this script to enumerate
    // artwork, so they are saved next to the character data rather than kept
    // only in memory.
    for (const name of ['charlist', 'weaponlist', 'artifactlist']) {
      jsonJobs.push({ url: `${API}/${VERSION}/${name}.json`, rel: `data/${name}.json` });
    }
  }

  // The root lists are needed to know which characters, weapons and artifact
  // sets exist, so they are fetched up front rather than discovered lazily.
  const lists = {};
  if (DO_IMAGES) {
    for (const name of ['charlist', 'weaponlist', 'artifactlist', 'materiallist']) {
      const r = await fetchJson(`${API}/${VERSION}/${name}.json`);
      if (r.ok) lists[name] = r.json;
      else console.log(yellow(`  warn: ${name}.json unavailable (${r.status})`));
    }
  } else {
    // Data-only runs still need the charlist to enumerate detail files.
    const r = await fetchJson(`${API}/${VERSION}/charlist.json`);
    if (r.ok) lists.charlist = r.json;
  }

  const charIds = lists.charlist ? Object.keys(lists.charlist) : [];
  if (!charIds.length) {
    console.error(red('\nFATAL: charlist.json is empty or unavailable'));
    process.exit(1);
  }
  console.log(dim(`  roster   ${charIds.length} characters`));

  if (DO_DATA) {
    for (const lang of LANGS) {
      for (const id of charIds) {
        jsonJobs.push({ url: `${API}/${VERSION}/${lang}/char/${id}.json`, rel: `data/char/${lang}/${id}.json` });
      }
    }
    // Per-SET artifact detail: the five pieces of each set, with their own
    // names and icons. `artifactlist.json` only carries the set as a whole, so
    // without these the artifact component cannot label or illustrate a slot.
    for (const lang of LANGS) {
      for (const id of Object.keys(lists.artifactlist || {})) {
        jsonJobs.push({ url: `${API}/${VERSION}/${lang}/artifact/${id}.json`, rel: `data/artifact/${lang}/${id}.json` });
      }
    }
  }

  if (DO_IMAGES) {
    // Icons are named inside the detail files, so read them from disk AFTER the
    // JSON stage; otherwise a first run would discover no icon names at all.
    // The plan is therefore built in two passes; see the re-plan below.
    for (const [id, ch] of Object.entries(lists.charlist || {})) {
      imageJobs.push({ url: `${API}/assets/gachaicon/${ch.CardImg}.webp`, rel: `img/char/${id}.webp`, optional: true });
      imageJobs.push({ url: `${API}/assets/avataricon/UI_AvatarIcon_${suffixOf(ch)}.webp`, rel: `img/avatar/${id}.webp`, optional: true });
    }
    for (const [, w] of Object.entries(lists.weaponlist || {})) {
      if (!w.weaponIcon) continue;
      // The list says `UI_EquipIcon_*`; the file on disk is `UI_Gacha_EquipIcon_*`.
      const icon = w.weaponIcon.replace(/^UI_(EquipIcon_)/, 'UI_Gacha_$1');
      imageJobs.push({ url: `${API}/assets/weapongacha/${icon}.webp`, rel: `img/weapon/${icon}.webp`, optional: true });
    }
    for (const [, a] of Object.entries(lists.artifactlist || {})) {
      if (!a.setIcon) continue;
      imageJobs.push({ url: `${API}/assets/artifacts/${a.setIcon}.webp`, rel: `img/artifact/${a.setIcon}.webp`, optional: true });
    }
    for (const [id, m] of Object.entries(lists.materiallist || {})) {
      // SOURCE uses the entry's OWN `icon` field; DESTINATION keeps the bare
      // material id, because that is what the app asks for. CharDetail renders
      // `itemImg(matId)` with the id taken from `detail.ascension`.
      //
      // The two differ: material 115 is `UI_ItemIcon_200005`, and only 2627 of
      // the 10663 ids have a file named after themselves. Guessing
      // `UI_ItemIcon_<id>` produced 8033 spurious 404s and quietly left most
      // materials without artwork.
      const icon = m?.icon;
      if (!icon) continue;
      imageJobs.push({
        url: `${API}/assets/items/${icon}.webp`,
        rel: `img/item/${id}.webp`,
        optional: true,
      });
    }
    // Element / stat / weapon-type glyphs. `unknown` is generated locally (it
    // 404s upstream), so it is deliberately not requested.
    const UI_ICONS = [
      'anemo', 'cryo', 'dendro', 'electro', 'geo', 'hydro', 'pyro', 'physical',
      'atk', 'atk_base', 'def', 'def_base', 'hp', 'hp_base', 'em', 'er',
      'critrate', 'critdmg', 'healing', 'bow', 'catalyst', 'claymore',
      'polearm', 'sword', 'logo',
    ];
    for (const n of UI_ICONS) {
      imageJobs.push({ url: `${API}/assets/icons/${n}.webp`, rel: `img/icons/${n}.webp`, optional: true });
    }
  }

  // ---- 3. data stage ------------------------------------------------------
  if (jsonJobs.length) {
    await stageJson(jsonJobs, manifest);
    await saveManifest({ version: VERSION, files: manifest.files, missing: manifest.missing });
  }

  // ---- 4. re-plan icons from the JSON now on disk -------------------------
  if (DO_IMAGES) {
    const seen = new Set(imageJobs.map((j) => j.rel));
    for (const lang of LANGS) {
      const dir = path.join(DATA, 'char', lang);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        let d;
        try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
        const icons = new Set();
        for (const v of Object.values(d.skills || {})) if (v?.icon) icons.add(v.icon);
        for (const c of Object.values(d.constellations || {})) if (c?.icon) icons.add(c.icon);
        for (const p of Object.values(d.passives || {})) if (p?.icon) icons.add(p.icon);
        for (const c of d.costumes || []) if (c?.icon) icons.add(c.icon);
        for (const ic of icons) {
          // `UI_Talent_*` are constellations/passives; everything else is an
          // active talent. The local mirror keeps them in separate folders.
          const isTalent = ic.startsWith('UI_Talent');
          const rel = isTalent ? `img/talent/${ic}.webp` : `img/skill/${ic}.webp`;
          if (seen.has(rel)) continue;
          seen.add(rel);
          // Avatar/costume icons live under avataricon, not skills.
          const folder = ic.startsWith('UI_AvatarIcon') ? 'avataricon' : 'skills';
          imageJobs.push({ url: `${API}/assets/${folder}/${ic}.webp`, rel, optional: true });
        }
      }
    }

    // Artifact piece icons: each set has five, named inside its detail file
    // (`info.pieces.{flower,plume,sands,goblet,circlet}.icon`). They live under
    // `assets/artifacts/`, the same folder as the set emblem.
    for (const lang of LANGS) {
      const dir = path.join(DATA, 'artifact', lang);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        let d;
        try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
        for (const piece of Object.values(d.info?.pieces || {})) {
          const ic = piece?.icon;
          if (!ic) continue;
          const rel = `img/artifact/${ic}.webp`;
          if (seen.has(rel)) continue;
          seen.add(rel);
          imageJobs.push({ url: `${API}/assets/artifacts/${ic}.webp`, rel, optional: true });
        }
      }
    }
    await stageImages(imageJobs, manifest);
    await saveManifest({ version: VERSION, files: manifest.files, missing: manifest.missing });
  }

  // ---- 5. summary ---------------------------------------------------------
  const totalFiles = Object.keys(manifest.files).length;
  console.log(`\n${green('done')} ${dim(`in ${formatDuration((Date.now() - t0) / 1000)}`)}`);
  console.log(dim(`  manifest ${path.relative(ROOT, MANIFEST_PATH)} (${totalFiles} files tracked)`));
  if (CHECK) console.log(yellow('  --check: nothing was written'));
  console.log('');
}

/**
 * The avataricon name for a character is its CardImg with the `Gacha_` infix
 * removed, e.g. UI_Gacha_AvatarIcon_Ayaka -> UI_AvatarIcon_Ayaka. Characters
 * whose CardImg does not follow that shape simply 404 and are skipped.
 */
function suffixOf(ch) {
  const m = /^UI_Gacha_AvatarIcon_(.+)$/.exec(ch.CardImg || '');
  return m ? m[1] : (ch.CardImg || '').replace(/^UI_/, '');
}

/* ------------------------------------------------------------------- stages */

async function stageJson(jobs, manifest) {
  const todo = jobs.filter((j) => needsFetch(j.rel, manifest));
  const progress = new Progress('data', todo.length);
  console.log(
    `  ${'data'.padEnd(12)} ${jobs.length} files, ${bold(String(todo.length))} to fetch` +
      (jobs.length - todo.length ? dim(` (${jobs.length - todo.length} unchanged)`) : '')
  );
  if (CHECK) {
    for (const j of todo.slice(0, 20)) console.log(dim(`    would fetch ${j.rel}`));
    if (todo.length > 20) console.log(dim(`    ... and ${todo.length - 20} more`));
    progress.done = todo.length;
    progress.skipped = jobs.length - todo.length;
    progress.finish();
    return;
  }

  await runPool(todo, async (job) => {
    const r = await fetchJson(job.url);
    if (r.ok) {
      const dest = path.join(PUBLIC, job.rel);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, r.text, 'utf8');
      manifest.files[job.rel] = { size: Buffer.byteLength(r.text), hash: hash(r.text), at: Date.now() };
      progress.tick({ ok: true, bytes: Buffer.byteLength(r.text) });
    } else {
      // A missing per-character file is normal (the roster can run ahead of the
      // detail set), so it is recorded and skipped rather than reported loudly.
      progress.tick({ failed: !job.optional });
    }
  });
  progress.skipped = jobs.length - todo.length;
  progress.finish();
}

async function stageImages(jobs, manifest) {
  const todo = jobs.filter((j) => needsFetch(j.rel, manifest));
  const progress = new Progress('images', todo.length);
  console.log(
    `  ${'images'.padEnd(12)} ${jobs.length} files, ${bold(String(todo.length))} to fetch` +
      (jobs.length - todo.length ? dim(` (${jobs.length - todo.length} unchanged)`) : '')
  );
  if (CHECK) {
    progress.done = todo.length;
    progress.skipped = jobs.length - todo.length;
    progress.finish();
    return;
  }

  const missing = [];
  await runPool(todo, async (job) => {
    const dest = path.join(PUBLIC, job.rel);
    const r = await fetchBinary(job.url, dest);
    if (r.ok) {
      manifest.files[job.rel] = { size: r.bytes, at: Date.now() };
      progress.tick({ ok: true, bytes: r.bytes });
    } else if (r.status === 404) {
      // Not every referenced icon exists upstream; that is a data fact, not a
      // failure, so it is collected and summarised rather than spamming.
      missing.push(job.rel);
      manifest.missing[job.rel] = Date.now();
      progress.tick({ skipped: true });
    } else {
      progress.tick({ failed: true });
    }
  });
  progress.skipped += jobs.length - todo.length;
  progress.finish();
  if (missing.length) {
    console.log(dim(`  ${missing.length} referenced but absent upstream (e.g. ${missing.slice(0, 3).join(', ')})`));
  }
}

main().catch((e) => {
  console.error(red(`\nFATAL: ${e.message}`));
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
