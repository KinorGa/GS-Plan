#!/usr/bin/env node
/**
 * Download the six Excel tables a character's and a weapon's stats are built
 * from, into ./stats-src.
 *
 * WHAT IT FETCHES (Dimbreath/AnimeGameData2, `ExcelBinOutput/`)
 *   AvatarExcelConfigData          attackBase / hpBase / defenseBase + which
 *                                  growth curve each stat uses
 *   AvatarCurveExcelConfigData     the four GROW_CURVE_* tables, 100 levels each
 *   AvatarPromoteExcelConfigData   the ascension bonus per promote phase
 *   WeaponExcelConfigData          main + secondary prop: initValue and curve
 *   WeaponCurveExcelConfigData     the eighteen weapon grow curves
 *   WeaponPromoteExcelConfigData   the weapon ascension bonus (base ATK only)
 *
 * WHY THE GAME'S OWN TABLES
 *   `public/data/charlist.json` and `weaponlist.json` carry ROUNDED display
 *   values (a Lv95 Varka is stored as atk 392, not 392.4743). The base numbers
 *   and the curves are what reproduce those tables exactly, so they are what the
 *   app computes from. See docs/STATS.md.
 *
 * INCREMENTAL
 *   Every file is recorded in a manifest with its byte length and a sha256. A
 *   later run re-downloads a file only when upstream changed it or the record is
 *   missing, so re-running after a new game version costs seconds.
 *
 * USAGE
 *   node scripts/fetch-stats.mjs             # incremental update
 *   node scripts/fetch-stats.mjs --check     # report what would change, download nothing
 *   node scripts/fetch-stats.mjs --force     # ignore the manifest, refetch all
 *
 * Env: STATS_PROXY=host:port for the SOCKS fallback (default 127.0.0.1:10808).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { get } from './lib/socks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'stats-src');
const MANIFEST_PATH = path.join(OUT, '.manifest.json');

const PROJECT = 'Dimbreath%2FAnimeGameData2';
const RAW = (file) =>
  `https://gitlab.com/api/v4/projects/${PROJECT}/repository/files/${encodeURIComponent(file)}/raw?ref=main`;

const FILES = [
  'AvatarExcelConfigData',
  'AvatarCurveExcelConfigData',
  'AvatarPromoteExcelConfigData',
  'WeaponExcelConfigData',
  'WeaponCurveExcelConfigData',
  'WeaponPromoteExcelConfigData',
];

const ARGS = new Set(process.argv.slice(2));
const CHECK = ARGS.has('--check');
const FORCE = ARGS.has('--force');
const QUIET = ARGS.has('--quiet');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * `get` with a few retries.
 *
 * The SOCKS proxy in front of GitLab drops a connection now and then
 * ("read ECONNRESET"), and a single blip used to fail a whole file -- which for
 * the 1.2 MB promote table is a minute of wasted work. Retrying the same URL is
 * safe because every request here is a plain GET.
 */
async function getWithRetry(url, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await get(url);
    } catch (e) {
      last = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw last;
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { files: {} };
  }
}

const manifest = loadManifest();
fs.mkdirSync(OUT, { recursive: true });

let fetched = 0;
let skipped = 0;
let failed = 0;

for (const name of FILES) {
  const dest = path.join(OUT, `${name}.json`);
  const url = RAW(`ExcelBinOutput/${name}.json`);

  let res;
  try {
    res = await getWithRetry(url);
  } catch (e) {
    failed++;
    console.error(`  ${name}: ${e.message}`);
    continue;
  }
  if (res.status !== 200) {
    failed++;
    console.error(`  ${name}: HTTP ${res.status}`);
    continue;
  }

  const digest = sha(res.buf);
  const prev = manifest.files[name];
  const unchanged = !FORCE && prev && prev.sha === digest && fs.existsSync(dest);

  if (unchanged) {
    skipped++;
    if (!QUIET) console.log(`  ${name.padEnd(30)} unchanged (${res.buf.length} B)`);
    continue;
  }
  if (CHECK) {
    fetched++;
    console.log(`  ${name.padEnd(30)} ${prev ? 'CHANGED' : 'NEW'} (${res.buf.length} B)`);
    continue;
  }

  // Land in a `.part` and rename, so an interrupted run never leaves a truncated
  // JSON that the next run would treat as complete.
  await fsp.writeFile(`${dest}.part`, res.buf);
  await fsp.rename(`${dest}.part`, dest);
  manifest.files[name] = { sha: digest, bytes: res.buf.length, fetchedAt: new Date().toISOString() };
  fetched++;
  if (!QUIET) console.log(`  ${name.padEnd(30)} ${prev ? 'updated' : 'saved'} (${res.buf.length} B)`);
}

if (!CHECK) {
  await fsp.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 1), 'utf8');
}

const verb = CHECK ? 'would download' : 'downloaded';
console.log(`\n${verb} ${fetched}, skipped ${skipped}${failed ? `, ${failed} FAILED` : ''}  ->  stats-src/`);
if (failed) process.exitCode = 1;
