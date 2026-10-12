// The configuration file: one team plus all of its damage axes.
//
// WHY ONE FILE
//   The export used to carry the team alone. A team with no rotation is half a
//   plan, and the axis lived in a separate storage key with no way out of the
//   browser at all -- so sharing a setup, or keeping a backup, silently dropped
//   the part that took the longest to build.
//
// THE BUFF LIBRARY IS DELIBERATELY NOT INCLUDED
//   The library holds DEFAULT values for each source. A dropped card COPIES those
//   values onto the axis, and edits after that touch only the copy -- so the
//   numbers in an exported axis are already self-contained and the file
//   reproduces the same damage without it.
//
//   It is also shared knowledge rather than part of one setup: the same weapon
//   grants the same buffs in every configuration. Bundling it would let two
//   files disagree about a weapon, and importing someone else's would overwrite
//   the reader's own research for no reason.
//
// SHAPE
//   { kind, version, team, axes: [{ id, name, entries }], activeId }
//
//   `kind` exists so importing the wrong file says so, instead of failing
//   somewhere further in with a confusing error.

import { normaliseTeam } from './team-model';
import { normaliseAxes } from './axes-store';

export const CONFIG_KIND = 'lunaris-config';
export const CONFIG_VERSION = 1;

/**
 * The whole configuration as a file.
 *
 * Pretty-printed: this is a file a person may open, diff or hand-edit.
 */
export function buildConfigFile({ team, axes, activeId }) {
  const normalised = normaliseAxes({ axes, activeId });
  return JSON.stringify(
    {
      kind: CONFIG_KIND,
      version: CONFIG_VERSION,
      team: normaliseTeam(team),
      axes: normalised.axes,
      activeId: normalised.activeId,
    },
    null,
    2
  );
}

/** A filename that sorts and says what it is. */
export function configFilename(now = new Date()) {
  const d = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `lunaris-config-${d}.json`;
}

/**
 * Read a configuration file.
 *
 * Accepts two shapes:
 *   the full configuration                   -> team AND axes
 *   a bare team document (`{ version, units }`) -> team only, axes untouched
 *
 * The second is the shape the previous export produced, so files already saved
 * still import. It returns `axes: null` to mean "leave the existing axes alone"
 * rather than inventing an empty one, which would look like the import wiped the
 * rotations.
 */
export function parseConfigFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`不是合法的 JSON：${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('顶层必须是一个对象');
  }

  if (raw.kind && raw.kind !== CONFIG_KIND) {
    throw new Error(`这是「${raw.kind}」文件，不是配置文件`);
  }

  // A bare team document: the previous export format.
  if (!raw.kind && Array.isArray(raw.units)) {
    return { team: normaliseTeam(raw), axes: null, activeId: null, teamOnly: true };
  }

  if (!raw.team && !raw.axes) {
    // Name the likely mistake. The buff library is the other file this app
    // exports, and picking it is the obvious wrong turn -- it has `entries` too,
    // but as a MAP of source key to buffs rather than a list of axis entries, so
    // saying only "no team and no axes" leaves the user to work it out.
    if (raw.entries && !Array.isArray(raw.entries)) {
      throw new Error('这看起来是增益库文件（entries 是来源到增益的映射表），不是配置文件；配置文件应包含 team 和 axes');
    }
    throw new Error('既没有 team 也没有 axes，不像配置文件');
  }

  const team = normaliseTeam(raw.team);
  const axes = normaliseAxes({ axes: raw.axes, activeId: raw.activeId });

  return { team, axes: axes.axes, activeId: axes.activeId, teamOnly: false };
}

/**
 * A short description of what an import will do, for the confirmation step.
 *
 * Shown BEFORE anything is replaced: importing overwrites the team and every
 * axis, which is not recoverable and should not be a surprise.
 */
export function describeImport(parsed) {
  const units = parsed.team?.units?.length || 0;
  const chars = (parsed.team?.units || []).filter((u) => u.char?.id).length;
  if (parsed.teamOnly) {
    return { units, chars, axes: null };
  }
  const axes = parsed.axes || [];
  return {
    units,
    chars,
    axes: axes.length,
    entries: axes.reduce((n, a) => n + (a.entries?.length || 0), 0),
  };
}