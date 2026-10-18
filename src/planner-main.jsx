// Rotation planner: the team, its buff pool, and the damage axis.
//
// ONE PAGE
//   The team panel at the top IS the team editor -- character row, and the
//   selected unit's artifacts. There is no separate builder page to visit: a
//   rotation is planned FOR a team, and the team is edited where you plan it.
//
//   This is the same `TeamPanel` the builder page used to mount, embedded here
//   rather than reimplemented, so the two cannot drift.
//
// THE POOL IS DERIVED FROM THE TEAM
//   Every item a unit carries is a potential buff source: normal attack,
//   elemental skill, elemental burst, each passive talent, each UNLOCKED
//   constellation, the weapon, and each artifact set bonus. `useTeamSources`
//   builds them from the unit's own configuration, so the pool says what the
//   team can actually bring rather than what a fixture claimed.
//
//   The buff VALUES are empty by design: upstream publishes prose and opaque
//   params, not stat tables, so a source starts blank for a human to fill in.
//   See `lib/buff-sources.js`.
//
// State for the AXIS lives HERE, in one map keyed by entry id, so that
// "independent" is a property of the data structure rather than a hope. Each
// entry's array is its own; the pool is derived and only ever read from.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import BuffPool from './components/BuffPool';
import AppDialog from './components/AppDialog';
import BulkStatsDialog from './components/BulkStatsDialog';
import ConfigTransfer from './components/ConfigTransfer';
import AxisSummary from './components/AxisSummary';
import { useTalentDamage } from './lib/use-talent-damage';
import { ENTRY_MIME, entriesToJson, entriesToText, parseEntriesJson } from './lib/entry-clipboard';
import { computeAxis } from './lib/axis-compute';
import { applyBulkSettings, countBulkTargets } from './lib/bulk-apply';
import { scopeForUnit } from './lib/buff-formula';
import { activeArtifacts } from './lib/artifact-sets';
import * as Segment from './lib/rotation-segment';
import { loadDataFile } from './lib/data-file';
import { invalidateLibrary } from './lib/buff-library';
import { invalidateFlags } from './lib/buff-flags';
import EntryGroup from './components/EntryGroup';
import TeamPanel from './components/TeamPanel';
import { I18nProvider, useI18n } from './i18n';
import { iconImg } from './game';
import { useCatalogue, loadCharacterDetail } from './lib/catalogue';
import {
  blankAxis, loadAxes, nextAxisId, nextEntryId, normaliseAxes,
  replaceAxes as replaceAxesInStore, saveAxes,
} from './lib/axes-store';
import { TeamProvider, useTeam } from './lib/team-context';
import { useTeamSources } from './lib/use-team-sources';
import './index.css';

/**
 * How many pastes can be undone.
 *
 * A paste is a rare, deliberate act, not a keystroke -- twenty is far more than
 * anyone reaches in a session, and each snapshot is a few kilobytes.
 */
const UNDO_LIMIT = 20;

/**
 * Apply `fn` to the entry with this id, WHEREVER IT SITS.
 *
 * A row can be a top-level entry or a MEMBER OF A SEGMENT, and every edit path used
 * to assume the former: `list.map((e) => e.id === id ? ... : e)` matches nothing when
 * the row lives inside a segment, so the change was discarded without an error. That
 * made every edit inside a loop silently do nothing -- a buff deleted, a stat typed,
 * a card re-picked, all accepted by the UI and then dropped.
 *
 * The walk itself now lives in `RotationSegment`, which owns the container's
 * internals. This wrapper exists only because `updateEntries` callers expect a
 * list-in/list-out `fn`.
 */
const mapEntry = (list, id, fn) => Segment.update(list, id, fn);



/**
 * The team as the damage card's character picker needs it.
 *
 * The card reads `{ id, chsName, enName, element }` per member, while a unit in
 * the document holds only `char.id`. This is the one place those two shapes meet
 * -- kept separate from the document so the document never has to carry display
 * data it would then have to keep in sync.
 *
 * It ALSO carries the unit's BUILD -- level, weapon and artifacts. The damage
 * card derives its stat panel from those, so without them the panel would still
 * be the hardcoded constants it used to be and a team's artifacts would have no
 * effect on the damage below it.
 */
function useTeamChoices(units) {
  const { catalogue } = useCatalogue();
  return useMemo(
    () =>
      (units || [])
        .map((u) => {
          const c = catalogue?.chars?.[u.char?.id];
          if (!c) return null;
          return {
            id: u.char.id,
            unitId: u.id,
            chsName: c.chsName,
            enName: c.enName,
            element: c.element,
            // `weaponType` is REQUIRED, not decorative: the damage card draws the
            // character's weapon glyph from it, and `weaponOf(undefined)` falls
            // back to the `unknown` icon -- a "?" where the sword should be. It
            // was omitted here, so every entry in the planner showed that "?"
            // while the standalone damage page (which passes a whole character
            // object) was fine.
            weaponType: c.weaponType,
            qualityType: c.qualityType,
            // The build, for the stat derivation.
            level: u.char?.level ?? 90,
            // The identity fields a formula may read as `$命座` / `$精炼`. The
            // constellation also decides which constellation SOURCES exist, and
            // the refinement which weapon values are shown; carrying them here
            // means the formula scope and the pool read the same numbers.
            constellation: u.char?.constellation ?? 0,
            refine: u.weapon?.refine ?? 1,
            // THE TALENT LEVELS, which decide WHICH COLUMN of the multiplier table
            // the card reads. `char-sources.buildSources` took level 10
            // unconditionally, so 法尔伽's 元素战技 at Lv5 showed its Lv10
            // coefficient -- 501.12% instead of 368.88%, a 36% overstatement on
            // every skill hit. The levels were stored on the unit and consumed by
            // the buff list, but never reached the damage side at all.
            talents: u.char?.talents || null,
            weaponId: u.weapon?.id ?? null,
            // The ACTIVE artifact configuration's five slots, resolved here so
            // every downstream reader -- the damage rows, the $ scope, the
            // panel derivation -- sees plain slots and never has to know the
            // unit holds more than one build. See lib/artifact-sets.js.
            artifacts: activeArtifacts(u),
          };
        })
        .filter(Boolean),
    [units, catalogue]
  );
}

/**
 * The DETAIL FILE for every character the axis uses, keyed by character id.
 *
 * WHY THE AXIS NEEDS THEM UP FRONT. `computeAxis` is synchronous by design -- it is
 * a pure function of the data, so a reader cannot be handed a stale number while
 * something loads. That means the detail files, which hold the talent multipliers
 * and the stat table, have to be resolved BEFORE the computation rather than by
 * each card as it mounts. A card mounting later would otherwise change the axis
 * total, which is exactly the bug this replaces.
 *
 * The AXIS's characters are required. The TEAM's are loaded too (`extraIds`), because
 * the pool's cards are editable and a formula on one reads ITS OWN owner's panel -- so
 * `teamScope` needs a scope for every team member, not only the ones the axis happens
 * to name. A pool card that showed `$总攻击力 0` while its character was on the team
 * is exactly that gap: the detail file had never been requested. `loadCharacterDetail` is
 * a module-level cache, so an id the pool already loaded costs nothing here.
 */
function useAxisCharacterDetails(entries, lang, extraIds = []) {
  const [map, setMap] = useState({});
  /**
   * EVERY ROW'S CHARACTER, at any depth.
   *
   * This read `entries.map((e) => e.charId)`, which only sees the top level. A
   * segment carries `charId: 'none'` -- its members are the rows with characters --
   * so merging an axis made this list EMPTY: no detail file loaded, every member
   * failed to compute, and the axis total silently dropped to zero with the summary
   * panel disappearing entirely.
   *
   * `Segment.flatten` is the container's own answer to "what rows are in here", so
   * the depth is its business rather than this hook's.
   */
  const charIds = useMemo(
    () => [...new Set([
      ...Segment.flatten(entries || []).map(({ row }) => row.charId),
      ...(extraIds || []),
    ].filter((id) => id && id !== 'none'))],
    [entries, extraIds]
  );
  const key = charIds.join(',');

  useEffect(() => {
    if (!charIds.length) { setMap({}); return undefined; }
    let alive = true;
    Promise.all(charIds.map(async (id) => [id, await loadCharacterDetail(id, lang)]))
      .then((pairs) => { if (alive) setMap(Object.fromEntries(pairs)); });
    return () => { alive = false; };
    // `key` is the stable identity of `charIds`; the array itself is rebuilt every
    // render, so depending on it would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lang]);

  return map;
}

function Page() {
  const { lang, setLang, L } = useI18n();

  const { units } = useTeam();
  const pool = useTeamSources(units, lang);
  const team = useTeamChoices(units);
  const { catalogue } = useCatalogue();
  const talentDamageTable = useTalentDamage();

  // The axis starts EMPTY for a NEW rotation. A pre-filled one would just be a
  // hardcoded guess; the point is that the user builds the sequence themselves.
  // A previously saved rotation is restored instead -- see below.
  //
  // A newly added entry opens expanded so its character can be picked right
  // away; every other entry stays collapsed, which is what keeps a long
  // rotation scannable.
  //
  // RESTORED FROM STORAGE on mount, and written back on every change. The team
  // and the buff library already survive a reload, so the axis not surviving was
  // the odd one out: clicking 增益库 is a full page navigation, and the user came
  // back to an empty planner with no warning that the work was about to be lost.
  //
  // A LIST of axes rather than one: single-target and AoE want different
  // sequences, and they belong to the same team, so they live together instead of
  // as documents the user has to remember to save separately.
  //
  // NORMALISED ON LOAD, rather than trusting storage to have the current shape.
  // A document may predate a schema change (or come from an older build), while
  // the in-memory state is what every component actually renders from. A stored
  // `enemyRes: 30` used to stay a single dead key in the panel on screen, so the
  // resistance silently read as its 10% default until the next reload. Running the
  // same repair here means the state and the stored copy cannot describe different
  // documents.
  const [axesState, setAxesState] = useState(() => normaliseAxes(loadAxes()));

  /**
   * The child entries a selection implies.
   *
   * A TALENT ROW CAN CONTAIN MORE THAN ONE NUMBER. `59.27%+110.08%` is two hits of
   * different damage types written in one row, so the single entry the user
   * selected becomes a PARENT with one child per number. The count is read from
   * the row's own text by `char-sources.parseMultiplierParts` and arrives here as
   * `partCount` -- it is not a property of the skill, and it is not "one child per
   * talent row".
   *
   * `partCount === 1` returns `undefined`, so an ordinary selection keeps the
   * entry exactly as it is today: no children, no parent rendering, nothing to
   * migrate.
   *
   * CHILDREN NEVER SHARE ANYTHING. Each keeps its OWN `drops` and its OWN
   * `statOverrides`, and nothing on the parent is inherited downwards. That is the
   * entire reason the split exists: the two halves meet different resistances, so
   * a buff belongs to one of them -- sharing it would make "drag a Pyro RES shred
   * onto the Pyro half" meaningless.
   *
   * Re-selecting a DIFFERENT compound row rebuilds the children, but a child is
   * matched by `partIndex` first, so its drops survive as long as the part is
   * still there. Switching to a plain row drops the children entirely; the drops
   * go with them, because there is no longer a part for them to belong to.
   */
  const syncChildren = (entry, summary) => {
    const count = summary?.partCount || 1;
    if (count <= 1) return undefined;

    const existing = Array.isArray(entry.children) ? entry.children : [];
    const byPart = new Map(existing.map((c) => [c.partIndex, c]));

    return Array.from({ length: count }, (_, i) => {
      const kept = byPart.get(i);
      if (kept) return kept;
      return {
        id: `${entry.id}-p${i}`,
        partIndex: i,
        // The FIRST number is the talent's own element. The ones after it are the
        // added halves, and the dataset does not say what they are -- 法尔伽's
        // follows "the elements of the characters in the party", which is a
        // property of the player's team, not of this file. So it is left unset
        // and the child says so, rather than silently repeating the skill's
        // element and reading the wrong resistance.
        element: null,
        drops: [],
        statOverrides: {},
        expanded: false,
      };
    });
  };

  // Which axis action is asking for confirmation. One at a time, so a single
  // piece of state rather than three booleans that could contradict each other.
  const [renamingAxis, setRenamingAxis] = useState(false);
  const [deletingAxis, setDeletingAxis] = useState(false);
  // The "new axis" menu: open, and therefore showing what a new axis can start
  // from. Transient by nature -- a menu left open across a reload would be a
  // surprise rather than a convenience -- so it is not in `pool-view`.
  const [axisSourceOpen, setAxisSourceOpen] = useState(false);
  /**
   * Persist AXES on a trailing edge.
   *
   * `saveAxes` packs the whole axis list and stringifies it (hundreds of KB for a
   * real rotation), so doing that on every keystroke was ~11 ms of synchronous
   * work per edit. The latest state is kept in a ref and written once the user
   * pauses; page hide/unload and unmount flush it immediately, so a delayed write
   * cannot lose the last change.
   */
  const latestAxes = useRef(axesState);
  const lastSavedAxes = useRef(axesState);
  const axesSaveTimer = useRef(null);
  const flushAxes = useCallback(() => {
    if (axesSaveTimer.current != null) {
      clearTimeout(axesSaveTimer.current);
      axesSaveTimer.current = null;
    }
    // A reload must not write the state the page STARTED with over a document
    // another tab (or a test seeding storage) has written since. Nothing has
    // changed here, so there is nothing to flush.
    if (latestAxes.current === lastSavedAxes.current) return;
    lastSavedAxes.current = latestAxes.current;
    saveAxes(latestAxes.current);
  }, []);
  useEffect(() => {
    latestAxes.current = axesState;
    if (axesState === lastSavedAxes.current) return undefined;
    if (axesSaveTimer.current != null) clearTimeout(axesSaveTimer.current);
    axesSaveTimer.current = setTimeout(() => {
      axesSaveTimer.current = null;
      lastSavedAxes.current = latestAxes.current;
      saveAxes(latestAxes.current);
    }, 400);
    return () => {
      if (axesSaveTimer.current != null) clearTimeout(axesSaveTimer.current);
    };
  }, [axesState]);
  useEffect(() => {
    const onHide = () => flushAxes();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAxes();
    };
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flushAxes();
    };
  }, [flushAxes]);

  const activeAxis = axesState.axes.find((a) => a.id === axesState.activeId) || axesState.axes[0];
  const entries = activeAxis.entries;

  /**
   * THE AXIS, COMPUTED FROM DATA.
   *
   * Every number the planner shows comes from here: the rows, the axis total, the
   * element and source shares. Nothing reads a stored result, and nothing trusts a
   * value a card reported earlier.
   *
   * WHY THIS REPLACED THE OLD ARRANGEMENT. Numbers used to be computed in the
   * components and cached on the entries -- a child's `figure`, the parent's
   * `summary.perHit` -- and those caches were written only while a card happened to
   * be mounted. The visible result was an axis whose TOTAL depended on which rows
   * the user had expanded: the same imported file showed 443,081, then 597,979,
   * then 608,978, with the rows never changing. A derived number that is stored and
   * then trusted is the bug; deriving it on demand is the fix.
   *
   * `useMemo` over the DATA is what makes it cheap and correct at once: any change
   * to the team, the entries or the language recomputes, and nothing else does. No
   * call site has to remember to invalidate anything, which is what the old
   * arrangement relied on and repeatedly got wrong.
   */
  // The whole team, not just the axis's characters: the pool's cards need a scope
  // for their own owner, so a dropped one can resolve a formula (see the hook).
  const teamCharIds = useMemo(() => team.map((t) => t.id), [team]);
  const details = useAxisCharacterDetails(entries, lang, teamCharIds);
  // The `$` scope of every team member, derived once. A dropped card's formula
  // reads its OWN owner's panel, so the entry rows need this map to resolve one
  // -- see `lib/buff-formula.js`.
  const withDetail = useMemo(
    () => team.map((t) => ({ ...t, detail: details[t.id] || null })),
    [team, details]
  );
  const teamScope = useMemo(
    () => new Map(withDetail.map((t) => [t.id, scopeForUnit(t, catalogue)])),
    [withDetail, catalogue]
  );
  const axis = useMemo(() => {
    if (!catalogue) return { byId: new Map(), total: 0, perHit: 0, computed: 0, entries: entries.length };
    return computeAxis(entries, withDetail, catalogue, talentDamageTable);
  }, [entries, withDetail, catalogue, talentDamageTable]);

  /**
   * Everything the artifact optimiser reads, in one stable object.
   *
   * It merges the axis's rows for ONE character into a closed-form expression
   * (see `lib/merged-expression.js`), so it needs exactly what `computeAxis`
   * needs and nothing else. Built here rather than inside the artifact row
   * because the row has no axis in hand -- it is rendered by `TeamPanel`, which
   * has no axis either -- and re-loading the axis from storage down there would
   * be a second source of truth for the same document.
   */
  const optimizeBundle = useMemo(
    () => ({ entries, team: withDetail, catalogue, talentDamage: talentDamageTable }),
    [entries, withDetail, catalogue, talentDamageTable]
  );

  /**
   * THE ROWS A BUFF INSTANCE CAN BE BOUND TO, flattened, NAMED, AND PLACED.
   *
   * A row can sit in three places, and the binding panel has to see all of them:
   *
   *   - a TOP-LEVEL entry
   *   - a MEMBER of a loop (`Segment.rows`), which is a row of its own with its
   *     own drops
   *   - a PART of a compound row (`e4-p1`), which is where a `59.27%+110.08%` row
   *     keeps its separate buffs -- the two halves meet different resistances, so
   *     a buff belongs to one of them and not to the row as a whole
   *
   * AND THEY NEST, to any depth: a compound row inside a loop inside a loop is a
   * real axis. So each target carries its `path` -- the containers it sits in,
   * outermost first -- and the panel renders that path rather than an indent
   * alone. An indent says "this is deeper"; it cannot say DEEPER IN WHAT, which
   * is the question a list of a hundred ids is actually asking. Two `第1段` rows
   * under two different loops are indistinguishable by depth, and telling them
   * apart is the whole job of this panel.
   *
   * A CONTAINER IS NOT BINDABLE, and that is deliberate rather than an omission:
   * a loop renders its members and a compound parent renders `cardOnly` with an
   * empty drop list (see EntryGroup's header note), so a buff spliced onto either
   * would have nowhere to show and would not reach the damage. A bind that looks
   * accepted and does nothing is worse than no bind at all.
   *
   * The container's NAME is the one the user already sees on the axis: a loop's
   * editable title (falling back to 循环), a compound row's stage label, which is
   * what its own header prints. Inventing a name here would give the same thing
   * two names on one screen.
   */
  const bindTargets = useMemo(() => {
    const charName = (row, fallbackCharId) => {
      const charId = row.charId && row.charId !== 'none' ? row.charId : fallbackCharId;
      const c = charId ? team.find((t) => t.id === charId) : null;
      return c ? (lang === 'chs' ? c.chsName : c.enName) : '';
    };

    /** What a container row is called, in the words its own header uses. */
    const containerName = (row) => {
      if (Segment.isSegment(row)) return row.name || L({ chs: '循环', en: 'Loop' });
      // A compound row: the stage it multiplies, as its header prints it.
      if (row.summary?.stage) return L(row.summary.stage);
      return L({ chs: '多段伤害', en: 'Multi-part' });
    };

    const out = [];
    const visit = (row, path, fallbackCharId) => {
      if (Array.isArray(row.children) && row.children.length) {
        const next = [...path, { id: row.id, name: containerName(row), loop: Segment.isSegment(row) }];
        row.children.forEach((c) => visit(c, next, row.charId || fallbackCharId));
        return;
      }
      const name = charName(row, fallbackCharId);
      /**
       * THE ROW'S OWN NAME, which a leaf has nowhere else to show.
       *
       * A multi-part row is a CONTAINER and appears in its parts' paths, so the
       * panel already names it. A single-stage row is a LEAF -- it has no parts
       * to carry its name -- so without this every plain row reads just 法尔伽 and
       * two different hits of one character are indistinguishable in the list.
       * That is what made the panel look like the nesting was incomplete.
       *
       * A part shows its PART NUMBER instead, because its name IS its position in
       * the row above it; repeating the parent's stage here would print the same
       * words twice on one line, once in the path and once in the label.
       */
      const own = row.summary?.stage ? L(row.summary.stage) : '';
      const part = Number.isInteger(row.partIndex)
        ? L({ chs: `第${row.partIndex + 1}段`, en: `part ${row.partIndex + 1}` })
        : '';
      out.push({
        id: row.id,
        // The human reading: who, and which hit of theirs it is.
        label: [name, part || own].filter(Boolean).join(' · ') || L({ chs: '未选角色', en: 'no character' }),
        path,
        depth: path.length,
        // The drops travel WITH the target, so the pool derives "who carries this
        // instance" from the entries themselves rather than from a stored list.
        drops: row.drops || [],
      });
    };
    (entries || []).forEach((row) => visit(row, [], null));
    return out;
  }, [entries, team, lang, L]);

  /**
   * UNDO / REDO, FOR PASTE ONLY.
   *
   * WHY ONLY PASTE. Every edit in this app goes through React state, which the
   * browser's own undo stack knows nothing about -- `execCommand` is the only way
   * to reach it, it is deprecated, and it does not apply to a `setState`. So an
   * undo has to be built here, and building it for EVERY edit means filtering the
   * constant automatic reports the damage cards emit, which is where such a
   * feature usually breaks.
   *
   * A paste needs no such filtering: it is one deliberate, user-initiated action
   * that inserts a batch of rows at once, which is also the edit a person is least
   * willing to undo by hand. Editing a number back needs no help.
   *
   * The stacks hold whole ENTRY LISTS rather than diffs. An axis is a few dozen
   * small objects; a snapshot is a few kilobytes, and a diff would be a second
   * implementation of what a change means.
   *
   * THEY LIVE IN REFS, NOT STATE, and that is load-bearing rather than a
   * preference. The key handler has to decide SYNCHRONOUSLY whether it is going to
   * `preventDefault`, and a `setState` updater does not run until React next
   * renders -- so a `did` flag set inside one was still false when the handler read
   * it, `preventDefault` never fired, and Ctrl+Z did nothing at all while looking
   * correct. Measured: 8 rows pasted on top of 8, Ctrl+Z, still 16.
   *
   * Nothing renders FROM these stacks, so there is no reason for them to be state;
   * `stackVersion` exists only to re-render a component that wants to show whether
   * an undo is available.
   */
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const [, bumpStacks] = useState(0);

  /**
   * WHICH ENTRIES ARE SELECTED, for copy and paste.
   *
   * APPLICATION-LEVEL, not the browser's own selection, and that is forced rather
   * than chosen: `Selection.addRange()` adds a second range only in Firefox --
   * Chrome and Safari REPLACE the first -- so selecting several non-adjacent rows
   * with the native selection API is impossible. A `Set` of ids is what actually
   * works, and it is how a file manager or a mail client does the same job.
   *
   * `anchor` is the last row clicked without Shift, which is what a Shift-click
   * extends FROM.
   */
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectAnchor, setSelectAnchor] = useState(null);

  // A selection that outlives its entries would leave Copy acting on rows that are
  // gone. Switching axes does exactly that, so the selection is scoped to the axis
  // it was made in.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectAnchor(null);
  }, [axesState.activeId]);

  /**
   * A click on an entry's row, as a selection gesture.
   *
   * The three gestures every list in every OS uses, so none of them needs
   * explaining in the UI:
   *
   *   plain click   narrows the selection to this row, OR clears it when this row
   *                 is already the ONLY one selected -- a second click on a
   *                 selected row is how you undo the first, and without it a click
   *                 can select but never deselect
   *   ctrl / cmd    toggles this row, leaving the rest alone
   *   shift         extends from the anchor
   */
  /**
   * The selection the last COMMITTED render had, readable from an event handler.
   *
   * `selectEntry` used to close over `selectedIds` and `selectAnchor` directly, which
   * put both in its dependency list -- so every selection change minted a new
   * `selectEntry`, which minted a new `onSelect` for every row, which defeated the
   * `React.memo` on `EntryGroup` and re-rendered the whole axis on every click. The
   * refs let the handler read the current values without changing identity, so
   * `onSelect` is stable for as long as the entries are.
   */
  const selectedIdsRef = useRef(selectedIds);
  const selectAnchorRef = useRef(selectAnchor);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { selectAnchorRef.current = selectAnchor; }, [selectAnchor]);

  const selectEntry = useCallback((id, { shift = false, meta = false } = {}) => {
    const selectAnchor = selectAnchorRef.current;
    const selectedIds = selectedIdsRef.current;
    if (shift && selectAnchor) {
      /**
       * THE RANGE IS TAKEN IN DISPLAY ORDER, not from a top-level scan.
       *
       * `entries.findIndex` only knows the top-level rows, so an anchor or a target
       * inside a segment was not found at all and a Shift-click there did nothing.
       * `Segment.flatten` lists every row the way the axis shows it, so a range spans
       * a segment's members the same way it spans ordinary rows.
       *
       * Only the rows VISIBLE at the top level are taken when the endpoints are both
       * top-level: a segment counts as ONE position, because that is what the user is
       * pointing at -- selecting from row 1 to row 9 must take the segment as a whole
       * rather than silently reaching inside it.
       */
      const seq = [];
      for (const row of entries) {
        if (Segment.isSegment(row)) {
          seq.push(row);
          seq.push(...Segment.rows(row));
        } else {
          seq.push(row);
        }
      }
      const pickable = new Set(entries.map((e) => e.id));
      const a = seq.findIndex((e) => e.id === selectAnchor);
      const b = seq.findIndex((e) => e.id === id);
      if (a >= 0 && b >= 0) {
        // A segment's members are only included when an ENDPOINT is inside that
        // segment -- otherwise the segment is one unit in the range.
        const insideSegment = !pickable.has(selectAnchor) || !pickable.has(id);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const chosen = seq.slice(lo, hi + 1)
          .filter((e) => insideSegment || pickable.has(e.id))
          .map((e) => e.id);
        setSelectedIds(new Set(chosen));
        return;
      }
    }
    if (meta) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setSelectAnchor(id);
      return;
    }
    // Clicking the one selected row clears it. Checked against the CURRENT set
    // rather than computed from the previous state inside the updater, because the
    // anchor has to be cleared at the same time -- leaving it set would make a
    // later Shift-click span from a row that is no longer selected.
    if (selectedIds.size === 1 && selectedIds.has(id)) {
      setSelectedIds(new Set());
      setSelectAnchor(null);
      return;
    }
    setSelectedIds(new Set([id]));
    setSelectAnchor(id);
  }, [entries]);

  /**
   * Edit the ACTIVE axis's entries.
   *
   * Every entry mutation goes through here so none of them has to know which axis
   * is open. The other axes are passed through untouched, which is what keeps a
   * switch from leaking edits into the axis you left.
   */
  const updateEntries = useCallback((fn) => {
    setAxesState((s) => {
      let changed = false;
      const axes = s.axes.map((a) => {
        if (a.id !== s.activeId) return a;
        const next = fn(a.entries);
        // Preserve the whole state reference for a no-op. `Segment.update` already
        // returns the original list when the target row is unchanged; mapping a
        // fresh axis around that list here would throw the signal away and restart
        // the same report -> render cycle one level higher.
        if (next === a.entries) return a;
        changed = true;
        return { ...a, entries: next };
      });
      return changed ? { ...s, axes } : s;
    });
  }, []);

  /**
   * Paste entries into the active axis.
   *
   * INSERTED AFTER THE SELECTION when there is one, at the end otherwise -- so a
   * paste lands next to the rows you were working on rather than at the bottom of a
   * long rotation.
   *
   * EVERY PASTED ENTRY GETS A FRESH ID. An id identifies a row within this axis, so
   * reusing the copied one would collide with an entry already here -- and the two
   * would then edit each other, which is the same failure `nextEntryId` exists to
   * prevent for a new entry.
   */
  const pasteEntries = useCallback((incoming) => {
    if (!incoming?.length) return 0;
    let added = 0;
    updateEntries((list) => {
      // SNAPSHOT THE LIST BEING REPLACED, inside this updater so it is the exact
      // pre-paste list -- reading `entries` outside would capture a render that may
      // already be stale.
      undoRef.current = [...undoRef.current.slice(-(UNDO_LIMIT - 1)), list];
      // A NEW PASTE ENDS THE REDO BRANCH. Redoing onto a state that no longer
      // exists would restore rows the user never had -- the same rule every editor
      // follows.
      redoRef.current = [];
      bumpStacks((n) => n + 1);

      const fresh = [];
      /**
       * EVERY PASTED ROW IS A DEEP COPY WITH FRESH IDS, and the copying is done by
       * the container rather than here.
       *
       * This was hand-written per level and got it wrong twice. First the buff cards
       * were copied without ids, so every card in a pasted entry answered to every
       * edit addressed to any of them -- deleting one row wiped the same row from its
       * siblings. Then the same at the next level up, for a pasted segment's members,
       * where all four members' cards came out sharing one id.
       *
       * Both were a level of the tree that nobody remembered to write out. `clone`
       * walks the whole tree with ONE rule -- every node gets a fresh id -- so there
       * is no per-level code left to forget.
       *
       * The root id comes from `nextEntryId` over the list AND the rows already
       * placed, so two pasted rows cannot both be `e7`; everything below it is
       * derived from that id and its own position, which makes it unique by
       * construction.
       */
      for (const e of incoming) {
        fresh.push({
          ...Segment.clone(e, () => nextEntryId([...list, ...fresh])),
          expanded: false,
        });
      }
      added = fresh.length;

      const ids = [...selectedIds];
      const last = ids.length ? Math.max(...ids.map((id) => list.findIndex((e) => e.id === id))) : -1;
      const at = last >= 0 ? last + 1 : list.length;
      return [
        ...list.slice(0, at).map((e) => ({ ...e, expanded: false })),
        ...fresh,
        ...list.slice(at).map((e) => ({ ...e, expanded: false })),
      ];
    });
    setSelectedIds(new Set());
    setSelectAnchor(null);
    return added;
  }, [updateEntries, selectedIds]);

  /**
   * Undo the last paste: restore the list it replaced.
   *
   * THE CURRENT LIST GOES ONTO THE REDO STACK FIRST, which is what makes redo
   * possible -- and it is the same snapshot mechanism, so redo needs no separate
   * notion of what a "paste" was. `expanded` is cleared on the way in for the same
   * reason `repairEntries` clears it: which rows are open is a property of the
   * moment, and restoring it would fold rows the user was looking at.
   *
   * Returns whether anything happened, so the key handler can decide whether to
   * swallow the keystroke.
   */
  const undoPaste = useCallback(() => {
    // READ SYNCHRONOUSLY, so the caller can preventDefault on the same tick.
    const stack = undoRef.current;
    if (!stack.length) return false;
    const prev = stack[stack.length - 1];
    undoRef.current = stack.slice(0, -1);

    updateEntries((list) => {
      redoRef.current = [...redoRef.current.slice(-(UNDO_LIMIT - 1)), list];
      // `expanded` is cleared for the same reason `repairEntries` clears it on
      // load: which rows are open is a property of the moment, and restoring it
      // would fold rows the user was looking at.
      return prev.map((e) => ({ ...e, expanded: false }));
    });
    // The selection names rows that may no longer exist, so it is dropped rather
    // than left pointing at whatever took their id.
    setSelectedIds(new Set());
    setSelectAnchor(null);
    bumpStacks((n) => n + 1);
    return true;
  }, [updateEntries]);

  /** Redo: put back the list that undo replaced. */
  const redoPaste = useCallback(() => {
    const stack = redoRef.current;
    if (!stack.length) return false;
    const next = stack[stack.length - 1];
    redoRef.current = stack.slice(0, -1);

    updateEntries((list) => {
      undoRef.current = [...undoRef.current.slice(-(UNDO_LIMIT - 1)), list];
      return next.map((e) => ({ ...e, expanded: false }));
    });
    setSelectedIds(new Set());
    setSelectAnchor(null);
    bumpStacks((n) => n + 1);
    return true;
  }, [updateEntries]);

  /**
   * Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y), on the DOCUMENT.
   *
   * IT ONLY SWALLOWS THE KEYSTROKE WHEN IT ACTS. Undo belongs to whatever has
   * focus: inside a stat input the browser's own undo must remove the last typed
   * character, and stealing that would be a worse bug than having no undo at all.
   * So a field always keeps its own Ctrl+Z, and so does a page with nothing to
   * undo.
   *
   * `ref` rather than state for the guard, because `preventDefault` has to be
   * decided synchronously and the stack updater runs later.
   */
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      // `Ctrl+Z` undoes; `Ctrl+Shift+Z` and `Ctrl+Y` both redo -- the two redo
      // bindings every editor accepts, one from the macOS habit and one from the
      // Windows one.
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y';
      if (!isUndo && !isRedo) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const acted = isRedo ? redoPaste() : undoPaste();
      if (acted) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undoPaste, redoPaste]);

  /**
   * The `copy` handler, on the DOCUMENT.
   *
   * WHY THE EVENT AND NOT `navigator.clipboard.writeText`. The event carries its own
   * `clipboardData` and needs no permission -- the user's own Ctrl+C is the grant --
   * and it lets one keystroke write TWO formats at once: `text/plain` for anything
   * outside this app, and `application/x-lunaris-entries` for a lossless paste back
   * into it. `writeText` would have to choose one.
   *
   * IT DOES NOT PREVENT DEFAULT unless something is selected, so copying ordinary
   * text on the page keeps working.
   */
  useEffect(() => {
    const onCopy = (e) => {
      // A field owns its own copy: selecting digits in a stat box and copying them
      // must not put axis entries on the clipboard.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (!selectedIds.size) return;

      /**
       * THE SELECTED ROWS, in display order.
       *
       * Top-level first, so a SELECTED SEGMENT is copied as a segment -- `flatten`
       * descends into one and would hand back its members instead, so selecting a
       * loop and pressing Ctrl+C copied nothing at all.
       *
       * Members are then added for any selection INSIDE a segment, which is the case
       * `entries.filter` could not see. A segment is skipped when one of its own
       * members is selected, so a member and its container can never both be copied
       * and produce the member twice.
       */
      const topPicked = entries.filter((x) => selectedIds.has(x.id));
      const memberPicked = [];
      for (const row of entries) {
        if (!Segment.isSegment(row)) continue;
        if (topPicked.includes(row)) continue;
        for (const kid of Segment.rows(row)) {
          if (selectedIds.has(kid.id)) memberPicked.push(kid);
        }
      }
      const picked = [...topPicked, ...memberPicked];
      if (!picked.length) return;

      e.preventDefault();
      e.clipboardData.setData('text/plain', entriesToText(picked, L));
      e.clipboardData.setData(ENTRY_MIME, entriesToJson(picked));
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [entries, selectedIds, L]);

  /**
   * The `paste` handler, on the DOCUMENT.
   *
   * `readText()` is deliberately NOT used: it is gated behind the `clipboard-read`
   * permission, refused by default, and that is exactly what made a previous
   * feature in this app silently do nothing while every test passed.
   *
   * A paste that is not ours is left alone -- `preventDefault` is called only after
   * the payload parses -- so pasting ordinary text into the page still behaves.
   */
  useEffect(() => {
    const onPaste = (e) => {
      // A field owns its own paste, which is what makes typing a stat value work.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      const incoming = parseEntriesJson(e.clipboardData?.getData(ENTRY_MIME));
      if (!incoming) return;
      e.preventDefault();
      pasteEntries(incoming);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasteEntries]);

  // Escape clears the selection, the way it does in every list.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || !selectedIds.size) return;
      setSelectedIds(new Set());
      setSelectAnchor(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedIds]);

  const addEntry = () =>
    updateEntries((list) => [
      ...list.map((e) => ({ ...e, expanded: false })),
      // The id comes from the LIST, not a module counter. A counter restarts at 1
      // after a reload and would hand out an id that a restored entry already
      // holds, so editing one entry would silently edit the other too.
      {
        id: nextEntryId(list),
        charId: 'none',
        drops: [],
        // EMPTY overrides: the panel is derived, so a new entry has nothing of
        // its own to store yet.
        statOverrides: {},
        summary: null,
        expanded: true,
      },
    ]);

  const patchEntry = useCallback((id, patch) => {
    updateEntries((list) => mapEntry(list, id, (e) => ({ ...e, ...patch })));
  }, [updateEntries]);

  /**
   * Replace one row's DROPS, wherever that row sits.
   *
   * `patchEntry` above goes through `Segment.update`, which reaches a top-level
   * entry and a loop member and nothing else. That is enough for the edits made
   * from a row's own card, because a part's edits go through `EntryGroup`'s
   * `setChild`, which patches the PARENT's children array. A buff instance binds
   * from OUTSIDE the axis, so the walk has to be here instead.
   *
   * Three shapes, for the same reason `bindTargets` lists three:
   *   - top-level entry      -> `Segment.update`
   *   - loop member          -> `Segment.update` (it descends one level)
   *   - part of a compound   -> the PARENT's `children`, matched by `-pN` suffix
   *
   * The part case is walked by hand rather than by `Segment`, which stops at the
   * rows a CONTAINER holds and never looks inside an entry's own children -- the
   * distinction `Segment.rows` documents.
   */
  const patchDrops = useCallback((entryId, fn) => {
    updateEntries((list) => {
      // A part: `e4-p1`. The parent is what `Segment` can reach, so the change is
      // addressed to the parent and applied to the matching child.
      const part = String(entryId).match(/^(.*)-p\d+$/);
      if (part) {
        const parentId = part[1];
        return Segment.update(list, parentId, (parent) => {
          if (!Array.isArray(parent.children)) return parent;
          return {
            ...parent,
            children: parent.children.map((c) => (
              c.id === entryId ? { ...c, drops: fn(c.drops) } : c
            )),
          };
        });
      }
      return Segment.update(list, entryId, (e) => ({ ...e, drops: fn(e.drops) }));
    });
  }, [updateEntries]);

  /**
   * The card reports its selection AND its computed damage. This stores it.
   *
   * TWO THINGS ARRIVE IN ONE OBJECT and they must not be treated alike:
   *
   *   - the SELECTION (`sourceKey`, `stageIndex`, `reactionKey`, `parts`,
   *     `partCount`) -- which row is being hit, and therefore how many children
   *     the entry has; and
   *   - the NUMBERS (`perHit`, `total`, `hits`) -- what that row currently
   *     computes to, which moves whenever a stat, a buff or an enemy changes.
   *
   * Only the SELECTION may rebuild `children`, and the guard below used to test
   * both at once. That made a pure number change look like a new selection: a
   * card remounting with a different stat panel reported a different `perHit`,
   * sailed past the guard, and re-split the entry from its own view of it. On a
   * reload that is fatal -- `summary` and `children` are restored from storage,
   * the card remounts, and the echo overwrote both, so a saved two-part row came
   * back as a single `一段伤害` with its children's drops and overrides discarded.
   * Measured. It was reachable whenever a card's panel differed from the one that
   * produced the stored numbers, which is the normal case after any team edit.
   *
   * So the two are separated: the numbers are always recorded, but the split is
   * rebuilt ONLY when the selection actually changed.
   */
  const selectionKey = (s) =>
    [
      s?.sourceKey,
      s?.stageIndex,
      s?.reactionKey,
      s?.partIndex ?? '',
      s?.partCount || 1,
      // The coefficients, so a row whose text changed under the same name is not
      // mistaken for the same row.
      Array.isArray(s?.parts) ? s.parts.map((p) => `${p.mult}x${p.hits}`).join(',') : '',
    ].join('|');

  const setEntrySummary = useCallback((id, s) => {
    updateEntries((list) =>
      Segment.update(list, id, (e) => {
        const prev = e.summary;
        // Identical in every reported field: nothing to do, and returning the
        // same object is what breaks the report -> render -> report cycle.
        if (
          prev &&
          prev.sourceKey === s.sourceKey &&
          prev.stageIndex === s.stageIndex &&
          prev.reactionKey === s.reactionKey &&
          prev.perHit === s.perHit &&
          prev.hits === s.hits &&
          (prev.partCount || 1) === (s.partCount || 1)
        ) {
          return e;
        }
        // Same SELECTION, new numbers: record them, leave the split alone.
        // Rebuilding here is what let a recomputed `perHit` collapse a split.
        const sameSelection = prev && selectionKey(prev) === selectionKey(s);
        return {
          ...e,
          summary: s,
          children: sameSelection ? e.children : syncChildren(e, s),
        };
      })
    );
  }, [updateEntries]);

  // Through the segment, so a row inside a container can be removed from the axis
  // exactly as a top-level one can. A direct `list.filter` matched only the top level
  // and did nothing at all for a member.
  const removeEntry = useCallback(
    (id) => updateEntries((list) => Segment.remove(list, id)),
    [updateEntries],
  );

  // The effect above persists the empty list, so storage needs no separate clear.
  const clearAll = () => updateEntries(() => []);

  /**
   * THE BULK SETTINGS, and the ONE snapshot that makes them reversible.
   *
   * `bulkUndo` holds the list as it was just before the last apply -- a single
   * row, not a stack, because this is a deliberate "do it once" action rather
   * than a keystroke, and the recovery that matters is "put back what I just
   * overwrote". A second apply REPLACES the snapshot rather than pushing onto a
   * stack: Ctrl+Z already walks the paste history, and mixing the two would let
   * it step past an apply onto a state that never existed.
   */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkUndo, setBulkUndo] = useState(null);

  const bulkTargets = countBulkTargets(entries);

  const applyBulk = useCallback(({ critMode, stats }) => {
    updateEntries((list) => {
      // THE SNAPSHOT IS TAKEN INSIDE THE UPDATER, from the exact pre-apply list.
      // Reading `entries` out here would capture a render that may already be
      // stale, and the "recover" would restore rows the user had already changed.
      setBulkUndo(list);
      return applyBulkSettings(list, { critMode, stats });
    });
    setBulkOpen(false);
  }, [updateEntries]);

  /**
   * Put back the list the last apply overwrote.
   *
   * THE RUN IS CLEARED AFTERWARDS: the snapshot names one moment, and restoring
   * it twice would restore a state that predates whatever the user did in
   * between. One apply, one recovery.
   */
  const revertBulk = () => {
    if (!bulkUndo) return;
    const prev = bulkUndo;
    updateEntries(() => prev);
    setBulkUndo(null);
  };

  /**
   * The accordion: one row open at a time, so the axis never becomes a wall of
   * full-size cards again.
   *
   * IT IS LEVEL-AWARE, and it has to be. Collapsing every other `expanded` flag
   * unconditionally also closed the LOOP that contains the row being opened -- and
   * since a loop's members only exist while it is open, expanding a member unmounted
   * the member itself. The effect was that a loop could be opened but nothing inside
   * it ever could, with the row visibly collapsing as you clicked it.
   *
   * So the rule is applied WITHIN a level: opening a top-level row closes the other
   * top-level rows, and opening a member closes its SIBLINGS, while the segment above
   * it stays open because it is not a sibling -- it is the container.
   *
   * THE WALK LIVES IN THE SEGMENT, which is the only thing that knows where a row
   * sits. Written out here it needed three hand-rolled branches over `list` and
   * `list[].children`, and each one had to independently remember the same rule.
   */
  const toggleEntry = useCallback(
    (id) => updateEntries((list) => Segment.toggleOpen(list, id)),
    [updateEntries],
  );
  const expandEntry = useCallback(
    (id) => updateEntries((list) => Segment.setOpen(list, id, true)),
    [updateEntries],
  );

  /**
   * Merge the SELECTED entries into one segment.
   *
   * The walk, the ordering and the insert position all live in `Segment.merge`, which
   * is the only thing that knows the list's shape. What stays here is the part that
   * is about the SCREEN: which rows are selected, and minting the new id.
   *
   * Ids are NOT reissued for the members. They keep the ids they had: they are still
   * the same rows, and giving them new ones would break any in-flight reference for
   * no gain. Fresh ids are needed on PASTE, where the copies would otherwise collide
   * with the originals -- a different situation, handled by `Segment.clone`.
   */
  const mergeIntoLoop = useCallback((name) => {
    /**
     * THE ID IS MINTED OUTSIDE THE UPDATER, so the caller can be told it.
     *
     * `updateEntries` hands its function to React and runs it LATER, so anything
     * assigned inside it is still unset on the line after the call. Returning the id
     * from in there meant the caller got `null`, and the name field it opens for the
     * new segment never appeared -- the merge worked and the prompt silently did not.
     *
     * Reading `entries` for the id is safe here: it is the current render's list, the
     * only thing `nextEntryId` needs it for is to avoid a collision, and the updater
     * re-checks against the real list when it runs.
     */
    const id = nextEntryId(entries);
    updateEntries((list) => Segment.merge(list, [...selectedIds], { id, name: name || '' }));
    setSelectedIds(new Set());
    setSelectAnchor(null);
    return id;
  }, [updateEntries, selectedIds, entries]);

  /**
   * Unmerge a segment, putting its members back where it was.
   *
   * The order is preserved exactly, so a merge followed by a dissolve is a no-op --
   * which is the property that makes the feature safe to try.
   */
  const dissolveLoop = useCallback((loopId) => {
    updateEntries((list) => Segment.dissolve(list, loopId));
    setSelectedIds(new Set());
    setSelectAnchor(null);
  }, [updateEntries]);

  /** Rename a loop. An empty name is allowed and simply shows as 循环. */
  const renameLoop = useCallback((loopId, name) => {
    updateEntries((list) => list.map((e) => (
      e.id === loopId && e.kind === 'segment' ? { ...e, name: String(name || '') } : e
    )));
  }, [updateEntries]);

  /** Open or close a loop. Only one is open at a time, like every other row. */
  const toggleLoop = useCallback((loopId) => {
    updateEntries((list) => list.map((e) => (
      e.kind === 'segment' ? { ...e, expanded: e.id === loopId ? !e.expanded : false } : e
    )));
  }, [updateEntries]);

  /**
   * How many selected rows could become a loop.
   *
   * Zero while the selection contains a loop, because loops do not nest -- see
   * `mergeIntoLoop`. Counting rather than returning a boolean lets the button say
   * how many rows it will take.
   */
  const mergeableCount = (() => {
    // TOP-LEVEL rows only: merging takes whole rows from the axis, and a segment's
    // members are addressed through their container rather than individually.
    const picked = entries.filter((e) => selectedIds.has(e.id));
    if (picked.some((e) => e.kind === 'segment')) return 0;
    return picked.length;
  })();

  // Which loop is being named, if any. Held by ID rather than as a boolean, so the
  // rename control on any loop opens that loop's field and the field closes itself
  // on blur/Enter -- without either needing a dialog.
  const [namingLoop, setNamingLoop] = useState(null);

  const allCollapsed = entries.length > 0 && entries.every((e) => !e.expanded);  const toggleAll = () =>
    updateEntries((list) => list.map((e, i) => ({ ...e, expanded: allCollapsed && i === 0 })));

  /**
   * The delete confirmation's wording.
   *
   * The entry count is mentioned ONLY when there is one: "「群体循环」及其 0 个
   * 条目将被删除" reads like a bug. The last-axis case says RESET rather than
   * delete, because that is what actually happens and the difference matters.
   */
  const deleteBody = (() => {
    const n = entries.length;
    const name = activeAxis.name || L({ chs: '未命名轴', en: 'Unnamed axis' });
    if (axesState.axes.length > 1) {
      return n
        ? L({
          chs: `「${name}」及其 ${n} 个条目将被删除，此操作不可撤销。`,
          en: `"${name}" and its ${n} entries will be deleted. This cannot be undone.`,
        })
        : L({
          chs: `「${name}」将被删除，此操作不可撤销。`,
          en: `"${name}" will be deleted. This cannot be undone.`,
        });
    }
    return n
      ? L({
        chs: `这是最后一个轴，会被重置为空轴（名称清空、${n} 个条目删除）而不是真正移除 —— 界面总需要一个轴来显示。`,
        en: `This is the last axis, so it is RESET to an empty one (name cleared, ${n} entries deleted) rather than removed -- the page always needs an axis to show.`,
      })
      : L({
        chs: '这是最后一个轴，会被重置为空轴（名称清空）而不是真正移除 —— 界面总需要一个轴来显示。',
        en: 'This is the last axis, so it is RESET to an empty one (name cleared) rather than removed -- the page always needs an axis to show.',
      });
  })();

  /* ------------------------------------------------------------ the axes */

  const selectAxis = (id) => setAxesState((s) => ({ ...s, activeId: id }));

  /**
   * CREATE AN AXIS, blank or from another one.
   *
   * One verb with a source rather than two buttons, because "a new axis" and "a
   * copy of that axis" are the same act -- the only question is what it starts
   * from. Blank is the default and stays a single click; `from` names an axis to
   * take the contents of.
   *
   * WHY COPYING AN AXIS IS WORTH A MODE AT ALL. The usual reason is comparison:
   * single-target against AoE, or the same rotation with one artifact swapped.
   * The clipboard path exists, but it round-trips through the paste parser and
   * the selection and cannot carry an axis's NAME, so the copy arrives unnamed
   * beside the original with nothing saying which is which.
   *
   * THE COPY MUST NOT SHARE ANYTHING, because the whole point is to change one
   * and compare. So every id is minted fresh and every drop's buffs are deep
   * copied (see `Segment.clone`); ids inside a new axis are namespaced under that
   * axis's own id, so two axes can never address each other's rows.
   *
   * EVERYTHING ELSE IS CARRIED VERBATIM, INCLUDING THE DROPS. A dropped card is
   * part of the rotation being compared, so dropping it would make the copy a
   * different rotation rather than the same one. A drop spliced by a buff
   * INSTANCE keeps its `instanceId`, so the copy stays bound to that instance --
   * which is right: an instance is a definition, not a property of one axis, and
   * editing its values should still reach every axis carrying it.
   *
   * THE COPY IS NAMED AFTER ITS SOURCE, so the switcher never shows two identical
   * names: "首轮" becomes "首轮 副本", and an unnamed source becomes "副本".
   */
  const addAxis = (from = null) =>
    setAxesState((s) => {
      const axisId = nextAxisId(s.axes);
      const source = from ? s.axes.find((a) => a.id === from) : null;

      if (!source) {
        const axis = blankAxis(axisId);
        // The new axis becomes active, because adding one and not being taken to
        // it looks like nothing happened.
        return { ...s, axes: [...s.axes, axis], activeId: axis.id };
      }

      /**
       * IDS ARE MINTED UNDER THE NEW AXIS'S ID, not from the copy's own list.
       *
       * Numbering the copy `e1, e2, e3…` would reproduce the SOURCE's ids
       * exactly, since the source starts there too -- two axes whose rows answer
       * to the same address, which is what `nextAxisId` exists to prevent one
       * level up: editing a row in one axis would edit the row in the other.
       *
       * So the root of each cloned row is `${axisId}-${n}`. It stays readable and
       * unique across the document, and every descendant id derives from it
       * through `Segment.clone`, so no level can be forgotten.
       */
      const fresh = [];
      (source.entries || []).forEach((row, i) => {
        fresh.push(Segment.clone(row, () => `${axisId}-e${i + 1}`));
      });

      const copy = {
        id: axisId,
        name: source.name
          ? L({ chs: `${source.name} 副本`, en: `${source.name} copy` })
          : L({ chs: '副本', en: 'Copy' }),
        entries: fresh,
      };
      const at = s.axes.findIndex((a) => a.id === source.id);
      const axes = [...s.axes];
      // Inserted DIRECTLY AFTER its source, so the pair reads together in the
      // switcher rather than the copy landing at the far end of a long list.
      axes.splice(at + 1, 0, copy);
      return { ...s, axes, activeId: axisId };
    });

  const renameAxis = (id, name) =>
    setAxesState((s) => ({ ...s, axes: s.axes.map((a) => (a.id === id ? { ...a, name } : a)) }));

  /**
   * Delete an axis.
   *
   * ALWAYS AVAILABLE, including for the last one. It used to be hidden at one
   * axis, which meant a control that vanished was the only way to learn the rule
   * -- "can I not delete an axis?" is what that produces.
   *
   * Deleting the last axis RESETS it (a fresh blank one takes its place) rather
   * than leaving the page with no axis to show. The confirmation says so, so the
   * two cases are not a surprise.
   */
  const removeAxis = (id) =>
    setAxesState((s) => {
      const remaining = s.axes.filter((a) => a.id !== id);
      if (!remaining.length) {
        const axis = blankAxis(nextAxisId(s.axes));
        return { ...s, axes: [axis], activeId: axis.id };
      }
      const activeId = s.activeId === id
        ? (remaining[Math.max(0, s.axes.findIndex((a) => a.id === id) - 1)] || remaining[0]).id
        : s.activeId;
      return { ...s, axes: remaining, activeId };
    });

  /**
   * Replace the axes wholesale, on import.
   *
   * Writes storage directly as well as setting state, rather than relying on the
   * persistence effect: the effect runs after the render, so a reload in between
   * would come back with the OLD axes while the team had already been replaced --
   * a half-applied import, which is worse than either outcome.
   */
  const replaceAxes = useCallback((next) => {
    const normalised = normaliseAxes(next);
    replaceAxesInStore(normalised);
    setAxesState(normalised);
  }, []);

  /**
   * The row handlers, kept STABLE so a row that did not change can skip its render.
   *
   * Each of these used to be an arrow written inline in the `map` below, which mints a
   * new function on every render -- and a new prop re-renders the row it was given to.
   * So selecting one row rebuilt all of them and re-rendered the whole axis.
   *
   * `selectHandlers` is the one that needs the entry id, so it is a map rebuilt when
   * `entries` changes. That is right: a new entry needs a handler, and any edit
   * changes the axis anyway.
   */
  const selectHandlers = useMemo(() => {
    const byId = new Map();
    for (const e of entries) byId.set(e.id, (opts) => selectEntry(e.id, opts));
    return byId;
  }, [entries, selectEntry]);

  /** Stable for the same reason: an arrow here would re-render every row. */
  const clearNaming = useCallback(() => setNamingLoop(null), []);

  /**
   * Store a row's edited stat panel.
   *
   * Lifted out of the `map` for the reason above -- it takes the ids as ARGUMENTS, so
   * it needs nothing from the row it used to be written beside.
   *
   * A LEAF ROW stores the overrides on itself; the edit can land at any depth (top
   * level, or inside a loop), so it goes through `Segment.update` exactly as
   * `patchEntry` does. A direct `list.map` used to be enough for a top-level row and
   * silently dropped the SAME edit for a row inside a loop -- the failure this
   * codebase keeps meeting.
   */
  const reportStats = useCallback((id, overrides, parentId) => {
    if (!parentId) {
      updateEntries((list) => Segment.update(list, id, (entry) => ({
        ...entry,
        statOverrides: overrides,
      })));
      return;
    }
    // A PART's overrides belong to the CHILD. The parent is what `Segment` can
    // reach, so this is addressed to the parent and applied to the matching child
    // -- and reached through the container, so a compound row inside a loop works
    // too.
    updateEntries((list) => Segment.update(list, parentId, (entry) => ({
      ...entry,
      children: (entry.children || []).map((c) => (
        c.id === id ? { ...c, statOverrides: overrides } : c
      )),
    })));
  }, [updateEntries]);

  return (
    <div className="min-h-screen bg-background px-5 py-6">
      {/* 1600px, not 1500: the damage axis gets ~1180px at this width, which is
          the card's own size plus the collapsed-row chrome. At 1500 the axis had
          1100 and the row's left cluster and right figure sat noticeably close. */}
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        {/* ------------------------------------------------------- header */}
        {/* Patterned on `Layout`'s header: the logo and wordmark lock the page
            into the app, and the title shares its baseline instead of hanging
            below an unrelated line of text. The section nav that follows keeps
            its own horizontal padding, so the two are aligned but not nested. */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <img src={iconImg('logo')} alt="" className="h-8 w-8 shrink-0 object-contain" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                {L({ chs: '配队增益规划', en: 'Rotation Planner' })}
              </h1>
              <p className="truncate text-[11px] text-muted-foreground/70">
                {L({
                  chs: '上方配队 · 左侧增益来源 · 右侧伤害轴',
                  en: 'Team above · buff sources left · damage axis right',
                })}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* The way into the stat derivation. Everything below -- this axis's
                damage, a buff formula's `$总攻击力` -- is computed from
                `base * curve(level) + ascension` over tables nobody can see, so
                the page that opens those tables sits here, next to the pages whose
                numbers it explains. See src/stats-main.jsx. */}
            <a
              href="/stats.html"
              data-open-stat-audit
              className="rounded-lg border border-sky-400/40 bg-sky-400/[0.06] px-3 py-1.5 text-xs font-medium text-sky-300 transition-colors hover:border-sky-400/70 hover:bg-sky-400/[0.12]"
            >
              {L({ chs: '数值来源', en: 'Stat sources' })}
            </a>
            {/* The way into the buff library. Every source in the game needs its
                numbers filled in by hand (upstream publishes prose, not stat
                tables), and that is a page of its own -- see BuffEditor. */}
            <a
              href="/buffs.html"
              data-open-buff-editor
              className="rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/[0.06] px-3 py-1.5 text-xs font-medium text-[#7fd4c1] transition-colors hover:border-[#7fd4c1]/70 hover:bg-[#7fd4c1]/[0.12]"
            >
              {L({ chs: '增益库', en: 'Buff library' })}
            </a>
            {/* The way into the talent/constellation damage review.
                A sibling of 增益库 because it is the same kind of thing: a page
                where the numbers the game publishes as PROSE are entered by hand.
                Which constellations count as a hit cannot be derived -- see
                docs/TALENT-DAMAGE.md -- so it is reviewed, and the review lives
                beside the other curation page rather than in a URL you have to
                remember. */}
            <a
              href="/audit.html"
              data-open-talent-audit
              className="rounded-lg border border-amber-400/40 bg-amber-400/[0.06] px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:border-amber-400/70 hover:bg-amber-400/[0.12]"
            >
              {L({ chs: '伤害源审核', en: 'Damage sources' })}
            </a>
            <button
              onClick={() => setLang(lang === 'chs' ? 'en' : 'chs')}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {lang === 'chs' ? '中文' : 'EN'}
            </button>
          </div>
        </div>

        {/* -------------------------------------------------------- team */}
        {/* The whole editor, not a read-only strip: the planner is where a team
            is composed for the rotation being planned.

            THE SECTION IS LABELLED. It used to be a captionless block of cards
            between the page title and the buff pool, which read as three
            unrelated things stacked -- and the page description had to carry
            "上方是配队面板" to make up for it. It now wears the same heading
            style as 伤害轴, so the page reads as three named parts.

            The import/export row lives INSIDE the section for the same reason:
            the panel it belonged to has no visual box, so a sibling rendered
            directly under it was a mystery row whose scope was already unclear
            (it exports the axes too, not just the team). */}
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-white/50">
            {L({ chs: '队伍', en: 'Team' })}
          </h2>
          {/* WHAT THE ARTIFACT OPTIMISER MERGES. `team` is the WITH-DETAIL list,
              not the raw one: the merge resolves a row's buff formulas against
              its OWNER's panel, so a card whose owner's detail file had not been
              loaded would merge as a different number. Memoised on the same
              inputs the axis is computed from, so the bundle is stable across
              renders and only the optimiser's own dialog pays for it. */}
          <TeamPanel optimize={optimizeBundle} />
          <ConfigTransfer
            axes={axesState}
            onReplaceAxes={replaceAxes}
            onClearAxes={() => setAxesState(normaliseAxes(null))}
          />
        </section>

        {/* -------------------------------------------------- two columns */}
        {/* THE AXIS COMES FIRST ON A NARROW SCREEN. Side by side, the pool is
            the left column and the axis the right, which is the order the work
            goes in. Stacked, that order is a trap: the pool is a long list of
            every source the team carries, so at `lg` and below it pushed the
            axis -- the thing being built -- thousands of pixels down the page.
            `order` puts the axis first once the grid collapses, without moving
            it in the DOM (so the wide layout is unchanged), and the pool keeps
            its own sticky column the moment there is room for two. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <BuffPool
            pool={pool}
            teamScope={teamScope}
            axisEntries={entries}
            bindTargets={bindTargets}
            onPatchDrops={patchDrops}
            className="order-2 lg:order-none lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
          />

          <div className="order-1 flex flex-col gap-3 lg:order-none">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="shrink-0 text-xs font-bold uppercase tracking-wider text-white/50">
                  {L({ chs: '伤害轴', en: 'Damage Axis' })}
                </h2>

                {/* The axis picker. A native `<select>` rather than the app's
                    custom dropdowns: this one lives in a plain toolbar with no
                    clipping ancestor, and a native control gets keyboard and
                    long-list behaviour for free. The custom menus exist because
                    they needed icons and portals, which this does not. */}
                <select
                  data-axis-select
                  value={axesState.activeId}
                  onChange={(e) => selectAxis(e.target.value)}
                  className="min-w-0 max-w-[220px] truncate rounded-lg border border-white/10 bg-[#141418] px-2 py-1 text-[11px] text-white outline-none transition-colors hover:border-white/25 focus:border-[#7fd4c1]/50"
                >
                  {axesState.axes.map((a, i) => (
                    <option key={a.id} value={a.id}>
                      {a.name || L({ chs: `轴 ${i + 1}`, en: `Axis ${i + 1}` })}
                      {a.entries.length ? ` (${a.entries.length})` : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setRenamingAxis(true)}
                  title={L({ chs: '重命名当前轴', en: 'Rename this axis' })}
                  className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:border-white/25 hover:text-white/70"
                >
                  {L({ chs: '重命名', en: 'Rename' })}
                </button>

                {/*
                  ONE BUTTON, TWO SOURCES.

                  Creating an axis and copying one are the same act -- the only
                  question is what the new axis starts from -- so the button opens
                  the choice instead of being two buttons that must both be read to
                  understand either. Blank stays the FIRST option and the default,
                  because that is what "+ 轴" did and it must not become slower.

                  The list is every axis, INCLUDING the one you are on: "copy this
                  axis and change one thing" is the common case, and making the
                  active axis the one you cannot pick would be perverse.
                */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setAxisSourceOpen((v) => !v)}
                    data-add-axis
                    aria-expanded={axisSourceOpen}
                    title={L({ chs: '新建轴：空白或复制现有的', en: 'New axis: blank, or copied from an existing one' })}
                    className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                      axisSourceOpen
                        ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                        : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
                    }`}
                  >
                    {L({ chs: '+ 轴', en: '+ Axis' })} <span className="text-white/30">▾</span>
                  </button>

                  {axisSourceOpen && (
                    <>
                      {/* A click anywhere else closes it, which is what every menu
                          in this app does and what an open menu with no way out
                          would otherwise lack. */}
                      <div className="fixed inset-0 z-40" onClick={() => setAxisSourceOpen(false)} />
                      <div
                        data-axis-source-menu
                        className="absolute left-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-xl border border-white/15 bg-[#141418] py-1 shadow-xl shadow-black/60"
                      >
                        <button
                          type="button"
                          data-new-axis-blank
                          onClick={() => { addAxis(); setAxisSourceOpen(false); }}
                          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <span className="text-[#7fd4c1]">＋</span>
                          {L({ chs: '空白轴', en: 'Blank axis' })}
                        </button>

                        <div className="my-1 border-t border-white/10" />
                        <p className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white/30">
                          {L({ chs: '从现有轴复制', en: 'Copy from an axis' })}
                        </p>
                        <div className="max-h-64 overflow-y-auto">
                          {axesState.axes.map((a, i) => (
                            <button
                              key={a.id}
                              type="button"
                              data-copy-axis={a.id}
                              onClick={() => { addAxis(a.id); setAxisSourceOpen(false); }}
                              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <span className="shrink-0 text-white/25">⧉</span>
                              <span className="min-w-0 flex-1 truncate">
                                {a.name || L({ chs: `轴 ${i + 1}`, en: `Axis ${i + 1}` })}
                              </span>
                              <span className="shrink-0 text-[10px] tabular-nums text-white/25">
                                {a.entries.length}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Always shown, at every axis count. Hiding it at one axis made
                    the rule undiscoverable. */}
                <button
                  type="button"
                  onClick={() => setDeletingAxis(true)}
                  data-delete-axis
                  title={L({
                    chs: axesState.axes.length > 1 ? '删除当前轴' : '重置当前轴（最后一个轴不能真正删除）',
                    en: axesState.axes.length > 1 ? 'Delete this axis' : 'Reset this axis (the last one cannot be removed)',
                  })}
                  className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:border-red-400/40 hover:text-red-300"
                >
                  {L({ chs: '删除', en: 'Delete' })}
                </button>

                {entries.length > 0 && (
                  <span className="shrink-0 text-[11px] text-white/30">
                    {entries.length} {L({ chs: '个条目', en: 'entries' })}
                  </span>
                )}

                {/* MERGE, offered only when it can work.
                    The selection lives in `selectedIds`, and this is the one place
                    that acts on it as a group rather than as a copy source. Hidden
                    below two rows because a loop of one is just an indirection, and
                    hidden when the selection already holds a loop because loops do
                    not nest -- offering a button that would refuse is worse than not
                    offering it. */}
                {mergeableCount >= 2 && (
                  <button
                    onClick={() => { const id = mergeIntoLoop(''); setNamingLoop(id); }}
                    data-merge-loop
                    title={L({
                      chs: `把这 ${mergeableCount} 个条目合并为一个循环`,
                      en: `Merge these ${mergeableCount} entries into one loop`,
                    })}
                    className="shrink-0 rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/[0.06] px-2 py-1 text-[11px] text-[#7fd4c1] transition-colors hover:bg-[#7fd4c1]/[0.14]"
                  >
                    {L({ chs: `合并为循环 (${mergeableCount})`, en: `Merge to loop (${mergeableCount})` })}
                  </button>
                )}
              </div>

              <div className="flex shrink-0 gap-2">
                {bulkUndo && (
                  <button onClick={revertBulk} data-bulk-revert
                          title={L({ chs: '恢复统一设置前的数值', en: 'Undo the last bulk apply' })}
                          className="rounded-lg border border-[#e0a45c]/40 bg-[#e0a45c]/[0.08] px-2.5 py-1 text-[11px] text-[#e0a45c] transition-colors hover:bg-[#e0a45c]/[0.16]">
                    {L({ chs: '恢复', en: 'Revert' })}
                  </button>
                )}
                {entries.length > 0 && (
                  <button onClick={() => setBulkOpen(true)} data-bulk-open
                          title={L({ chs: '一次设置所有条目的暴击模式与敌方数值', en: 'Set crit mode and enemy values for every entry at once' })}
                          className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-[#7fd4c1]/50 hover:text-[#7fd4c1]">
                    {L({ chs: '统一设置', en: 'Bulk set' })}
                  </button>
                )}
                {entries.length > 0 && (
                  <button onClick={clearAll}
                          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/40 transition-colors hover:border-white/25 hover:text-white/70">
                    {L({ chs: '清空', en: 'Clear' })}
                  </button>
                )}
                {entries.length > 0 && (
                  <button onClick={toggleAll}
                          className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/40 transition-colors hover:border-white/25 hover:text-white/70">
                    {allCollapsed
                      ? L({ chs: '展开一个', en: 'Expand one' })
                      : L({ chs: '全部收起', en: 'Collapse all' })}
                  </button>
                )}
                <button onClick={addEntry} data-add-entry
                        className="rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/10 px-3 py-1 text-[11px] font-medium text-[#7fd4c1] transition-colors hover:bg-[#7fd4c1]/20">
                  + {L({ chs: '添加条目', en: 'Add entry' })}
                </button>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="flex h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 text-center">
                <p className="text-xs text-white/35">
                  {L({ chs: '伤害轴还是空的', en: 'The axis is empty' })}
                </p>
                <p className="max-w-[320px] text-[11px] leading-relaxed text-white/25">
                  {L({
                    chs: '点右上角「添加条目」新建一张伤害卡片，为它选择角色，再从左侧把增益拖进去',
                    en: 'Click "Add entry" to create a damage card, pick its character, then drag buffs in from the left.',
                  })}
                </p>
                <button onClick={addEntry}
                        className="rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/10 px-3 py-1.5 text-[11px] font-medium text-[#7fd4c1] transition-colors hover:bg-[#7fd4c1]/20">
                  + {L({ chs: '添加第一个条目', en: 'Add the first entry' })}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {entries.map((e, i) => (
                  <EntryGroup
                    key={e.id}
                    index={i}
                    entry={e}
                    team={team}
                    teamScope={teamScope}
                    L={L}
                    // Whether this row is part of the copy/paste selection, and
                    // the click that changes it.
                    selected={selectedIds.has(e.id)}
                    onSelect={selectHandlers.get(e.id)}
                    axis={axis}
                    // The loop actions. An ordinary entry ignores them; a loop row
                    // is the only thing that renders the controls for them.
                    onToggleLoop={toggleLoop}
                    onDissolveLoop={dissolveLoop}
                    onRenameLoop={renameLoop}
                    autoName={namingLoop === e.id}
                    onNamed={clearNaming}
                    onStartRename={setNamingLoop}
                    patchEntry={patchEntry}
                    onRemove={removeEntry}
                    onToggle={toggleEntry}
                    onExpand={expandEntry}
                    onSummary={setEntrySummary}
                    // The entry stores only the fields the user changed, not a whole panel.
                    //
                    // The panel is DERIVED from the team (character + weapon +
                    // artifacts), so storing all of it would freeze every value:
                    // editing an artifact would no longer move the damage below
                    // it, which is the whole point. Storing just the overrides
                    // means an untouched field keeps following the team and a
                    // changed one stays changed.
                    //
                    // `parentId` comes through for a CHILD, whose overrides belong
                    // to the child and not to the entry that contains it.
                    onStatsChange={reportStats}
                  />
                ))}

                {/* THE AXIS FOOTER. Below the rows, because it summarises them --
                    reading "80% is one character" only means something once you
                    have seen the rows it is describing. */}
                <AxisSummary
                  entries={entries}
                  axis={axis}
                  team={withDetail}
                  talentDamage={talentDamageTable}
                  L={L}
                />
              </div>
            )}
          </div>
        </div>

        {/* The axis dialogs. Rendered at the page root, not inside the entry list,
            so they do not sit inside a scrolling container; the component itself
            portals to the body. */}
        <AppDialog
          open={renamingAxis}
          title={L({ chs: '重命名轴', en: 'Rename axis' })}
          body={L({
            chs: '留空则使用默认名称（轴 1、轴 2…）。',
            en: 'Leave it blank to use the default name (Axis 1, Axis 2…).',
          })}
          input={{
            defaultValue: activeAxis.name || '',
            placeholder: L({ chs: '轴名称', en: 'Axis name' }),
            maxLength: 40,
          }}
          confirmLabel={L({ chs: '保存', en: 'Save' })}
          onConfirm={(value) => { renameAxis(activeAxis.id, value); setRenamingAxis(false); }}
          onCancel={() => setRenamingAxis(false)}
        />

        <BulkStatsDialog
          open={bulkOpen}
          entryCount={bulkTargets}
          L={L}
          onCancel={() => setBulkOpen(false)}
          onApply={applyBulk}
        />

        <AppDialog
          open={deletingAxis}
          title={L({ chs: '删除轴', en: 'Delete axis' })}
          tone="danger"
          body={deleteBody}
          confirmLabel={L({ chs: '删除', en: 'Delete' })}
          onConfirm={() => { removeAxis(activeAxis.id); setDeletingAxis(false); }}
          onCancel={() => setDeletingAxis(false)}
        />
      </div>
    </div>
  );
}

/**
 * READ THE DURABLE FILE BEFORE RENDERING.
 *
 * The planner uses the buff library (what a card is worth) and the flags (which
 * sources the pool offers). Both modules cache on first read, so rendering first
 * would freeze them on the CACHE's copy -- and a pool built from a stale cache is
 * exactly the "I marked it and it is still there" report.
 *
 * With no endpoint -- a static host, or opened as a file -- this resolves anyway and
 * the page works from `localStorage` alone.
 */
loadDataFile().then(() => {
  invalidateLibrary();
  invalidateFlags();

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <I18nProvider>
        <TeamProvider>
          <Page />
        </TeamProvider>
      </I18nProvider>
    </React.StrictMode>
  );
});
