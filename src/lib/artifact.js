// Artifact domain: one import surface for the equipment row.
//
// The implementation is split three ways, because the three layers have
// genuinely different reasons to change:
//
//   artifact-model.js      the RULES      five independent slots, stat pools,
//                                         derived values, 2-pc/4-pc counting
//   artifact-meta.js       the PRESENTATION  slot labels, stat glyphs, defaults
//   artifact-catalogue.js  the DATA       fetching and indexing the set files
//   artifact-curves.js     the TABLE      main-stat values, which upstream does
//                                         not publish
//
// This barrel re-exports all of them, so `import { blankSet } from '../lib/artifact'`
// keeps working. Prefer it over reaching into a layer directly: it is the seam
// that lets the split change without touching callers.
//
// THE BRIEF
//   Five slots, each shown independently with its own icon, its own set, a main
//   stat and four substats. Everything icon-led.

export * from './artifact-model';
export * from './artifact-sets';
export * from './artifact-meta';
export * from './artifact-catalogue';
