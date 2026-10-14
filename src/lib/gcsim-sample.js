// Run the gcsim importer IN THE BROWSER: decode the file, load the data it
// needs, hand both to `gcsim-import.js`.
//
// WHY THIS IS A SEPARATE MODULE FROM THE IMPORTER
//   `gcsim-import.js` is PURE -- every dataset it reads is a parameter -- which is
//   what lets one function serve the CLI (reading disk) and the planner (reading
//   `fetch`) without knowing the difference. This is the wiring, and it is the
//   only part that knows about `DecompressionStream`, `fetch` and the caches.
//
// EVERY DATASET IT NEEDS IS ONE THE PLANNER ALREADY LOADS, so an import costs one
// extra request (`gcsim-abilities.json`, 5 KB) and joins the rest:
//
//   catalogue.js           charlist + weaponlist          (`loadCatalogue`)
//   artifact-catalogue.js  every set's name, icon and 2/4-piece bonuses
//   catalogue.js           one detail file per character in the run
//   use-talent-damage.js   the curated constellation/passive table
//
// THE CHARACTER FILES ARE READ IN `chs`, WHATEVER LANGUAGE THE PAGE IS IN. The
// mapping table names a stage by its Chinese row name and `findStage` matches
// `stages[].chs` and nothing else, so the sources have to be built from the
// Chinese file or every stage lookup misses. That is a property of the table,
// not a preference -- which is also why the imported rows read in Chinese.

import { loadCatalogue, loadCharacterDetail } from './catalogue';
import { loadArtifacts } from './artifact-catalogue';
import { fetchJsonOrThrow } from './json-cache';
import { loadTalentDamage } from './use-talent-damage';
import { importGcsim, resolveByName } from './gcsim-import';

const ABILITIES_URL = '/data/gcsim-abilities.json';
const SAMPLE_LANG = 'chs';

/**
 * A gcsim export, from the bytes the browser read.
 *
 * gcsim's `.gz` export is a bare ZLIB stream (magic 78), NOT gzip -- piping it
 * through gunzip fails. So sniff the magic bytes rather than the extension:
 * gzip, then zlib, then plain JSON. The CLI does exactly the same, and for the
 * same reason.
 */
export async function decodeSample(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return JSON.parse(await inflate(bytes, 'gzip'));
  if (bytes[0] === 0x78) return JSON.parse(await inflate(bytes, 'deflate'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * `deflate` here means the ZLIB wrapper, which is what gcsim writes.
 *
 * A missing `DecompressionStream` is SAID rather than worked around: the
 * alternative is a 40 KB inflate implementation in the bundle for a browser
 * nobody in this repo targets, and the message names the way out.
 */
async function inflate(bytes, format) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('这个浏览器没有 DecompressionStream，解不开 .gz。请换较新的 Chrome / Edge / Firefox / Safari，或先用命令行跑 npm run gcsim:import。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).text();
}

/**
 * A gcsim sample -> `{ doc, report }`, ready for the same import dialog the JSON
 * path uses.
 *
 * `report` is the importer's own audit -- how many hits mapped, which did not,
 * and why -- and it is meant to be SHOWN. An import that quietly dropped twelve
 * hits is a wrong rotation the user has no other way to notice.
 */
export async function importGcsimSample(buffer, lang = 'chs') {
  const sample = await decodeSample(buffer);
  const [mapping, catalogue, artifacts] = await Promise.all([
    fetchJsonOrThrow(ABILITIES_URL),
    loadCatalogue(),
    loadArtifacts(lang),
  ]);

  // Resolved HERE because the detail files are an INPUT and have to be fetched
  // before the call. An id that does not resolve is left out on purpose:
  // `importGcsim` then reports it with the message that names the table to fix.
  const ids = [...new Set((sample.character_details || []).map(
    (cd) => mapping.characters?.[cd.name] || resolveByName(cd.name, catalogue.chars)
  ).filter(Boolean).map(String))];
  const details = await Promise.all(ids.map((id) => loadCharacterDetail(id, SAMPLE_LANG)));
  const charData = {};
  ids.forEach((id, i) => { if (details[i]) charData[id] = details[i]; });

  // The sets a run wears are a subset of the ones already loaded, so passing
  // them all costs nothing and saves a second lookup table.
  const setBonuses = {};
  for (const [id, set] of Object.entries(artifacts.sets)) {
    if (set.bonuses) setBonuses[id] = set.bonuses;
  }

  return importGcsim({
    sample,
    mapping,
    // `stats` is the stat FACTORS table the planner already loaded, so the importer
    // derives each unit's panel from the same numbers the panel editor uses (see
    // `panelByCharId`); without it `derivePanel` falls back to the rounded tables.
    catalogues: {
      char: catalogue.chars,
      weapon: catalogue.weapons,
      artifact: artifacts.sets,
      stats: catalogue.stats,
    },
    charData,
    talentDamage: await loadTalentDamage(),
    setBonuses,
  });
}
