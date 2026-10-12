// The team document: the single serializable shape for a whole team.
//
// WHY THIS EXISTS
//   The builder kept a unit's stats in one place and its artifacts in another,
//   with no shared type. That is fine for rendering but wrong for everything
//   else: a save file has to hold both, an importer has to produce both, and a
//   second view (a damage card, a planner row) has to READ both without
//   reaching into the builder's component state.
//
//   So the team is defined here as ONE plain object with no React in it. Every
//   consumer -- the builder, an exporter, a future calculator -- reads and
//   writes the same shape, and nothing about it depends on which component
//   happens to be on screen.
//
// THE SHAPE IS THE CONTRACT
//   {
//     version: 1,                      // bumped when the shape changes
//     units: [
//       {
//         id: 'u1',                    // stable across a save/load round trip
//         char: { id: '10000046', level: 90, constellation: 0,
//                 talents: { normal: 1, skill: 1, burst: 1 } },
//         weapon: { id: '15503', refine: 1 },
//         artifacts: {                       // lib/artifact-sets shape
//           active: 'a1',                    // which config is IN USE
//           sets: [{ id: 'a1', name: '暴击', slots: { flower: {...}, ... } }],
//         },
//       },
//     ],
//   }
//
// A UNIT HOLDS SEVERAL ARTIFACT CONFIGURATIONS. `artifacts` is a container of
//   named builds with one active, so swapping sets is a selection rather than
//   five edits. See lib/artifact-sets.js for the shape and the migration.
//
// WHY THE UNIT IS NESTED RATHER THAN FLAT
//   A character's weapon and artifacts are only meaningful attached to that
//   character. Keeping them on the unit means exporting a team is
//   `JSON.stringify(team)` and importing it is a validation pass -- no
//   reassembly, no parallel arrays to keep aligned.
//
// WHAT IS DERIVED, AND THEREFORE NOT STORED
//   - main-stat values (from `mainStatValue(stat, level)`)
//   - 2-piece / 4-piece bonuses (`activeBonuses`)
//   - ascension phase (`ascensionPhaseFor`)
//   Storing any of these would let a saved file disagree with itself.

import { blankArtifacts, normaliseArtifacts } from './artifact-sets';
import { CHAR_LEVEL_MAX, CHAR_LEVEL_MIN, TALENT_MAX, TALENT_MIN } from './catalogue';

/** Bumped only when a change would break an older reader. */
export const TEAM_VERSION = 1;

/** A fresh unit for `charId`. */
export function blankUnit(charId = null) {
  return {
    id: null, // assigned by `addUnit`, which needs the existing list
    char: {
      id: charId,
      level: 90,
      constellation: 0,
      talents: { normal: 1, skill: 1, burst: 1 },
    },
    weapon: { id: null, refine: 1 },
    // Always at least one complete five-slot build, never a partial one: a
    // half-built artifact model is the most likely thing to crash a consumer.
    // The container allows more than one -- see lib/artifact-sets.js.
    artifacts: blankArtifacts(),
  };
}

/** A team with no units. */
export const blankTeam = () => ({ version: TEAM_VERSION, units: [] });

/**
 * The next free unit id.
 *
 * Derived from the list rather than from a module-level counter, so ids survive
 * an import and never collide with the ids already in the document. A counter
 * would restart at 1 after a reload and hand out an id that is already in use.
 */
export function nextUnitId(units) {
  const highest = (units || []).reduce((max, u) => {
    const n = Number(String(u?.id || '').replace(/^u/, ''));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `u${highest + 1}`;
}

/** Append a new unit, returning the new team. */
export function addUnit(team, charId) {
  const units = team.units || [];
  return { ...team, units: [...units, { ...blankUnit(charId), id: nextUnitId(units) }] };
}

/** Remove a unit by id. */
export const removeUnit = (team, id) => ({
  ...team,
  units: (team.units || []).filter((u) => u.id !== id),
});

/** Replace one unit by id, returning the new team. */
export const withUnit = (team, id, next) => ({
  ...team,
  units: (team.units || []).map((u) => (u.id === id ? { ...u, ...next } : u)),
});

/**
 * Fill in anything a loaded document is missing.
 *
 * An import must never be able to produce a model the UI cannot render, so
 * every field is defaulted here rather than defended against at each use site.
 * Unknown extra keys are preserved: a file written by a NEWER version should
 * survive a round trip through this one instead of being silently stripped.
 *
 * @param   {any} raw
 * @returns {object} A valid team, or one that is at least renderable.
 */
export function normaliseTeam(raw) {
  const units = Array.isArray(raw?.units) ? raw.units : [];

  return {
    ...raw,
    version: TEAM_VERSION,
    units: units.map((u, i) => {
      const base = blankUnit(null);
      // The OLD single-build shape and the new container both land here, and
      // both come out a container: the migration is normaliseArtifacts below.
      return {
        ...base,
        ...u,
        // Guaranteed unique even if the file repeated an id or omitted them.
        id: u?.id || `u${i + 1}`,
        char: {
          ...base.char,
          ...u?.char,
          // BOUNDED FIELDS ARE CLAMPED, not trusted.
          //
          // A file is the one input that can hold anything, and an out-of-range
          // level is not merely ugly: every derived lookup is keyed by level, so
          // 250 finds no row, and the stepper shows a number its own +/- buttons
          // then refuse to move. Clamping keeps the document inside the range the
          // rest of the app assumes.
          level: clamp(u?.char?.level, base.char.level, CHAR_LEVEL_MIN, CHAR_LEVEL_MAX),
          constellation: clamp(u?.char?.constellation, base.char.constellation, 0, 6),
          talents: {
            normal: clamp(u?.char?.talents?.normal, base.char.talents.normal, TALENT_MIN, TALENT_MAX),
            skill: clamp(u?.char?.talents?.skill, base.char.talents.skill, TALENT_MIN, TALENT_MAX),
            burst: clamp(u?.char?.talents?.burst, base.char.talents.burst, TALENT_MIN, TALENT_MAX),
          },
        },
        weapon: { ...base.weapon, ...u?.weapon },
        // The container is rebuilt from whatever was there, so the OLD bare
        // build and the new { active, sets } both come out normalised.
        artifacts: normaliseArtifacts(u?.artifacts),
      };
    }),
  };
}

/**
 * `value` as a number inside `[min, max]`, or `fallback` when it is not a number.
 *
 * A non-numeric value falls back rather than becoming `NaN`: `NaN` propagates
 * silently through every calculation it touches and compares false against
 * everything, which is far harder to notice than a wrong-but-finite number.
 */
function clamp(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A stable string for the document.
 *
 * `normaliseTeam` first, so exporting an in-memory team and exporting the same
 * team after a load produce identical bytes -- otherwise a save/load/save cycle
 * would show a spurious diff.
 */
export const serialiseTeam = (team) => JSON.stringify(normaliseTeam(team), null, 2);

/**
 * Parse a document, throwing a message a user can act on.
 *
 * Import is the one place malformed input is expected, so the errors name what
 * was wrong rather than surfacing a raw `SyntaxError`.
 */
export function parseTeam(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object') throw new Error('expected an object at the top level');
  if (!Array.isArray(raw.units)) throw new Error('expected a "units" array');
  return normaliseTeam(raw);
}
