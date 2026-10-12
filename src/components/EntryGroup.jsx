// One entry on the axis, plus the CHILD entries a compound talent row implies.
//
// WHY THIS WRAPPER EXISTS
//   A talent row can hold more than one number: `59.27%+110.08%` is two hits of
//   different damage types written in one row. The entry the user selected then
//   becomes a PARENT with one child per number, and each child is a full, ordinary
//   damage entry -- its own card, its own stats, its own drop zone.
//
//   `DamageEntry` still renders ONE hit and knows nothing about parents or parts
//   as concepts -- but it does now accept `partIndex`/`element` (which part of a
//   row this is), `stageLocked` (whether it may re-pick the row) and `cardOnly`
//   (draw the source picker and nothing else), because a child and a parent both
//   render through it. Those four props are the whole of what this wrapper added;
//   the invariants it already maintained -- the collapsed row and the card
//   agreeing, the derived panel, the drag handling -- are untouched, which is what
//   keeps the split from breaking them.
//
// CHILDREN NEVER SHARE ANYTHING -- see `docs/MULTI-PART.md`. Each owns its drops
// and its overrides, and the parent owns none. A drop zone on the parent would be
// a lie: it could neither hold a buff nor lend one to the children, whose halves
// meet different resistances.
//
// THE PARENT CAN RE-PICK THE SKILL. It could not before, and that was a trap: the
// only way to change your mind about the skill was to delete the entry and build
// it again, losing both children's drops and overrides. The parent therefore
// mounts a real `DamageCard` while expanded -- the same control a plain entry has
// -- so the stage menu that chooses the row is the ONE implementation of that
// logic. See `parentAsEntry` below for what it deliberately does not get.
import { memo, useState } from 'react';
import { elementOf } from '../game';
import { ElementGlyph, ElementPicker } from './ElementGlyph';
import DamageEntry, { tint } from './DamageEntry';

/**
 * Every note written BELOW a row, so the row can repeat it once it is collapsed.
 *
 * A note on a part is invisible the moment its parent folds up: the parent is what
 * is left on screen, and it names only the skill and the damage. Opening every row
 * to find one was the only way to see them, which is not a way at all on a
 * twenty-five row axis. So the parent shows them, with the position that reaches
 * each one, and clicking opens the ring when there is more to read.
 *
 * ONE LEVEL IS WALKED -- an entry's own note, and its parts' -- because a loop
 * cannot contain a loop and a part cannot contain parts. `kind` only decides how a
 * position is written: a compound row numbers its parts, a loop numbers its
 * members.
 */
function collectNotes(entries, kind) {
  const out = [];
  (entries || []).forEach((e, i) => {
    const label = kind === 'loop' ? `#${i + 1}` : `${i + 1}`;
    if (e.note) out.push({ id: e.id, label, note: e.note });
    (e.children || []).forEach((c) => {
      if (!c.note) return;
      const partLabel = kind === 'loop'
        ? `${label}.${c.partIndex + 1}`
        : `${c.partIndex + 1}`;
      out.push({ id: c.id, label: partLabel, note: c.note });
    });
  });
  return out;
}

/** The summary itself. A button, because clicking it opens the row it describes. */
function ChildNotes({ items, onOpen }) {
  if (!items.length) return null;
  return (
    <button
      type="button"
      data-child-notes={items.length}
      onClick={onOpen}
      title={items.map((n) => `${n.label}  ${n.note}`).join('\n')}
      className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md border border-dashed border-white/10 px-2 py-0.5 text-left text-[11px] leading-snug text-white/45 transition-colors hover:border-white/25 hover:bg-white/[0.05] hover:text-white/70"
    >
      <span className="shrink-0 text-white/30">✎</span>
      <span className="truncate">
        {items.map((n, i) => (
          <span key={n.id}>
            {i > 0 && <span className="text-white/20">{'  ·  '}</span>}
            <span className="text-white/30">{n.label}</span>
            {' '}
            {n.note}
          </span>
        ))}
      </span>
    </button>
  );
}

function EntryGroup({
  entry, index, team, teamScope, L,
  patchEntry, onRemove, onToggle, onExpand, onSummary, onStatsChange,
  selected = false, onSelect,
  // The computed axis. Every figure this row shows comes from here -- see
  // `lib/axis-compute.js` for why nothing is read from a stored value.
  axis,
  // The loop actions. Only a loop row renders controls for them; an ordinary entry
  // receives them and ignores them, because they are threaded through the recursion
  // above so a member of a loop can itself be a loop-free compound row.
  onToggleLoop,
  onDissolveLoop,
  onRenameLoop,
  // True for the one loop that should open its name field on mount, set right after
  // a merge so the loop can be named without a dialog interrupting the action.
  autoName = false,
  onNamed,
  onStartRename,
}) {
  const children = entry.children;

  /**
   * The row the user just asked for, if they asked for one.
   *
   * `onPick` fires the instant a menu row is clicked, and it knows only the source
   * key and stage index -- NOT how many numbers that row holds. The `parts`/`partCount`
   * that decide the split arrive a moment later on the card's report. So the pick is
   * held here until that report lands, and the report is then accepted for the row
   * that was picked rather than for the row the entry currently holds.
   *
   * Without this the picker's own reports were gated on "names the row this entry
   * already has", which is never true for the pick that CHANGES the row -- so the
   * one report that mattered was the one that got dropped, and every pick through
   * this menu was silently discarded. Measured: 技能伤害 selected, then 狂飙突进·二段
   * left the entry on 普通攻击·一段伤害.
   */
  const [pending, setPending] = useState(null);

  /**
   * THE FIGURES ARE NOT TRACKED HERE ANY MORE.
   *
   * This component used to collect each child's number into state and write it onto
   * the child as `figure`, because a card only computes while it is mounted and a
   * collapsed row has no card. That is what made the numbers depend on what the user
   * had expanded: after a load nothing was mounted, so a collapsed row showed
   * nothing, and the axis total grew as rows were opened -- the same file reported
   * 443,081, then 597,979, then 608,978.
   *
   * `axis` now carries every part's figure, computed from the data by
   * `lib/axis-compute.js` before anything renders. So there is nothing to collect,
   * nothing to store on the child, and nothing to keep in step: the row reads the
   * same derivation the summary does.
   */

  // The row the entry holds, for seeding the picker and for the header.
  //
  // `picked` is preferred over `summary`: the pick is written the instant the menu
  // row is clicked, while `summary` only catches up on the card's next report. In
  // that gap `picked` is the newer truth, and the entry's card must already be
  // showing the row the user just chose or it would snap back to the old one.
  const heldKey = entry.picked?.sourceKey ?? entry.summary?.sourceKey ?? null;
  const heldStage = entry.picked?.stageIndex ?? entry.summary?.stageIndex ?? null;
  // `normalattack` is a REAL source key (`char-sources.SKILL_ORDER`). The fallback
  // used to read `'normal'`, which matches no source at all -- `sources.find` then
  // missed and fell through to `sources[0]`, so it looked like it worked while
  // actually depending on the normal attack happening to be listed first.
  const parentKey = heldKey ?? 'normalattack';
  const parentStage = heldStage ?? 0;

  /**
   * A menu row was clicked. Hold the choice until the card reports its parts.
   *
   * `onPick` knows the source key and the stage index but NOT how many numbers the
   * row holds -- `parts`/`partCount` arrive on the card's next report, and those two
   * fields are what actually rebuild the split. So the pick is kept here and the
   * report that matches it is accepted even though it names a row the entry does not
   * hold yet.
   *
   * WITHOUT THIS THE PICK WAS DISCARDED. Reports were gated on "names the row this
   * entry already has", which is never true for the pick that CHANGES the row -- so
   * the one report that mattered was the one dropped, and every selection through
   * this menu was silently thrown away. Measured: 技能伤害 chosen, then
   * 狂飙突进·二段, left the entry on 普通攻击·一段伤害.
   */
  const onPickRow = (k, i) => {
    setPending({ sourceKey: k, stageIndex: i });
    patchEntry(entry.id, { picked: { sourceKey: k, stageIndex: i } });
  };

  /**
   * A report from the entry's card.
   *
   * Accepted when it describes the row the user just picked, or -- with no pick
   * outstanding -- the row already held. Anything else is the card MID-RESOLUTION:
   * its `sources` arrive asynchronously, so its first renders name the fallback
   * normal attack. Accepting THAT was the earlier bug -- the entry collapsed back to
   * a single hit the moment it became a parent, because the picker it had just
   * mounted reported a one-part row. Measured: the axis flickered to the compound
   * row and returned to 一段伤害, with ~4000 reports that never left `normalattack/0`.
   */
  const onCardSummary = (s) => {
    if (!s) return;
    if (pending) {
      if (s.sourceKey !== pending.sourceKey || s.stageIndex !== pending.stageIndex) return;
      setPending(null);
      onSummary(entry.id, s);
      return;
    }
    if (heldKey != null && s.sourceKey !== heldKey) return;
    onSummary(entry.id, s);
  };

  // The element the parent's ring is tinted by: the FIRST part's, which is the
  // talent's own. Falls back to null (neutral) when it is unset.
  const parentElement = children?.[0]?.element ?? entry.summary?.element ?? null;
  // The row's accent, used for the open-state bar and wash. Named once because both
  // need the SAME fallback, and two copies of `|| 'rgb(...)'` is how one of them
  // ends up neutral while the other is tinted.
  const accent = elementOf(parentElement)?.color || 'rgb(220,220,230)';

  /**
   * ONE ROW PER PART: its own element and its own number.
   *
   * A single summed total was tried first and it is the wrong answer here. The two
   * halves of 法尔伽's 二段伤害 are 风 and 冰 -- different damage types meeting
   * different resistances -- so "72" is a number that belongs to neither of them and
   * tells the reader nothing about what the row does. Listing them per part keeps
   * each figure attached to the element it was computed against, which is the thing
   * that makes it mean something.
   *
   * THE NUMBERS COME FROM THE COMPUTED AXIS, not from anything a card reported.
   * Every part's figure used to be cached on the child by whichever card happened
   * to be mounted, so a collapsed row showed nothing after a load and filled in as
   * the user expanded it. `axis` is derived from the data every render, so this row
   * shows the same numbers whether or not its cards exist.
   */
  const computed = axis?.byId?.get(entry.id) || null;
  const partRows = children
    ? children.map((c, i) => {
      // Match by `partIndex`, not by position: `repairChildren` sorts the children
      // by it, but a child rebuilt mid-flight may not be in that order yet.
      const p = computed?.parts?.find((x) => x.partIndex === c.partIndex) || null;
      return {
        id: c.id,
        index: i,
        // The element the computation USED -- which is the child's own unless it
        // is unset, in which case it fell back to the row's.
        element: p?.element ?? c.element ?? null,
        figure: p,
      };
    })
    : [];

  /**
   * A LOOP IS A COLUMN OF ENTRIES, not a row with parts.
   *
   * Checked FIRST, before the compound branch below, because both are recognised by
   * having `children` -- and they mean opposite things. A compound row's children
   * are the parts of ONE talent hit (each with a coefficient, sharing a source); a
   * loop's are independent rows the user grouped so they could be moved and copied
   * together. Rendering a loop through the compound branch would draw seventeen
   * separate rows' worth of content as one row's parts.
   */
  if (entry.kind === 'segment') {
    const kids = children || [];
    const computedLoop = axis?.byId?.get(entry.id) || null;
    return (
      <div
        data-entry-loop={entry.id}
        className={`cv-auto rounded-2xl border transition-colors ${
          entry.expanded ? 'border-white/15 bg-white/[0.035]' : 'border-white/10 bg-white/[0.015]'
        }`}
      >
        {/*
          THE SELECTION GESTURE IS ON THE CONTAINER, not on an inner element.

          It was on the header div, whose middle is the name BUTTON -- so a click
          anywhere natural landed on a `<button>` and the guard skipped the
          selection. The loop could not be selected at all, and Ctrl+C therefore
          copied nothing: the row looked like every other row and silently refused
          to be picked up. Measured: `data-selected` stayed null after a click on the
          row's own centre.

          The guard still applies, so the rename / dissolve / expand / remove buttons
          keep their own presses -- but the name itself is no longer a button, so
          most of the row selects.
        */}
        <div
          data-loop-header={entry.id}
          data-selected={selected ? 'true' : undefined}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if (e.target.closest('button, input, a, [role="button"]')) return;
            if (!onSelect) return;
            onSelect({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          }}
          className={`flex items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors ${
            selected ? 'bg-[#7fd4c1]/[0.06] ring-2 ring-[#7fd4c1]/70' : ''
          }`}
        >
          <span className="shrink-0 rounded bg-[#7fd4c1]/15 px-1.5 py-0.5 text-[10px] tabular-nums text-[#7fd4c1]">
            {index + 1}
          </span>

          {/* The name, editable in place. An unnamed loop still needs a label, so it
              reads as 循环 rather than as an empty space. */}
          {autoName ? (
            <input
              autoFocus
              defaultValue={entry.name || ''}
              placeholder={L({ chs: '循环名称', en: 'Loop name' })}
              onBlur={(ev) => { onRenameLoop?.(entry.id, ev.target.value); onNamed?.(); }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') { ev.currentTarget.blur(); }
                if (ev.key === 'Escape') { ev.currentTarget.value = entry.name || ''; ev.currentTarget.blur(); }
              }}
              className="min-w-0 flex-1 rounded border border-[#7fd4c1]/40 bg-black/40 px-1.5 py-0.5 text-[12px] text-white outline-none"
            />
          ) : (
            // A SPAN, not a button. As a button it swallowed the press and made the
            // loop unselectable from its own centre -- see the note on the container.
            // The chevron is what opens and closes the loop.
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className="min-w-0 shrink truncate text-[12px] font-semibold text-white/90"
                title={L({ chs: '循环（点▾展开）', en: 'Loop (use ▾ to expand)' })}
              >
                {entry.name || L({ chs: '循环', en: 'Loop' })}
              </span>
              {!entry.expanded && (
                <ChildNotes items={collectNotes(kids, 'loop')} onOpen={() => onToggleLoop?.(entry.id)} />
              )}
            </span>
          )}

          {/* The loop's own total, so a collapsed loop still tells you what it is
              worth. A dash rather than 0 when nothing has computed yet -- an
              unknown is not zero damage. */}
          <span className="shrink-0 text-[13px] font-bold tabular-nums text-white">
            {computedLoop
              ? Math.round(computedLoop.total).toLocaleString('en-US')
              : <span className="text-white/25">—</span>}
          </span>

          <span className="shrink-0 text-[10px] text-white/35">
            {kids.length} {L({ chs: '项', en: 'items' })}
          </span>

          <button
            type="button"
            onClick={() => onStartRename?.(entry.id)}
            data-loop-rename={entry.id}
            title={L({ chs: '重命名循环', en: 'Rename this loop' })}
            className="shrink-0 rounded px-1 text-[11px] text-white/30 transition-colors hover:text-white"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => onDissolveLoop?.(entry.id)}
            data-loop-dissolve={entry.id}
            title={L({ chs: '解散循环，条目原地还原', en: 'Dissolve: put the entries back in place' })}
            className="shrink-0 rounded px-1 text-[11px] text-white/30 transition-colors hover:text-white"
          >
            {L({ chs: '解散', en: 'Split' })}
          </button>
          <button
            type="button"
            onClick={() => onToggleLoop?.(entry.id)}
            title={L({ chs: entry.expanded ? '收起' : '展开', en: entry.expanded ? 'Collapse' : 'Expand' })}
            className="shrink-0 rounded px-1.5 py-0.5 text-[16px] leading-none text-white/45 transition-colors hover:text-white"
          >
            {entry.expanded ? '▴' : '▾'}
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry.id)}
            title={L({ chs: '删除整个循环', en: 'Remove this loop and everything in it' })}
            className="shrink-0 rounded px-1 text-[11px] text-white/25 transition-colors hover:text-white/80"
          >
            ✕
          </button>
        </div>

        {entry.expanded && (
          <div data-loop-body={entry.id} className="mt-1.5 flex flex-col gap-3 border-t border-white/15 px-2 pt-3">
            {kids.map((kid, i) => (
              // Each member renders through THIS component, so a member that is
              // itself a compound row still gets its cards and its children.
              //
              // `index={i}` -- the member's position INSIDE the loop. It was `0` for
              // every member, so a loop of seventeen rows numbered all of them "1",
              // which made the axis unreadable the moment a loop was opened.
              <EntryGroup
                key={kid.id}
                index={i}
                entry={kid}
                team={team}
                teamScope={teamScope}
                L={L}
                axis={axis}
                patchEntry={patchEntry}
                onRemove={onRemove}
                onToggle={onToggle}
                onExpand={onExpand}
                onSummary={onSummary}
                onStatsChange={onStatsChange}
                onToggleLoop={onToggleLoop}
                onDissolveLoop={onDissolveLoop}
                onRenameLoop={onRenameLoop}
                onStartRename={onStartRename}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // No children: the ordinary path.
  //
  // NOT "byte for byte what the planner did before" any more -- see the props
  // below, which control this card by the entry's own selection.
  if (!children?.length) {
    return (
      <DamageEntry
        index={index}
        entry={entry}
        team={team}
        // A card dropped on THIS row resolves its formula against its own
        // owner's panel, so the row needs the team's scope map -- without it
        // every $symbol folded to 0 and the row used the unbuffed number.
        teamScope={teamScope}
        drops={entry.drops}
        selected={selected}
        onSelect={onSelect}
        onDropsChange={(next) => patchEntry(entry.id, { drops: next })}
        onCharChange={(charId) => patchEntry(entry.id, { charId })}
        onStatsChange={(overrides) => onStatsChange(entry.id, overrides)}
        // Crit mode and reaction are display preferences, stored on the entry so a
        // collapse/expand round trip cannot lose them.
        onPrefChange={(p) => patchEntry(entry.id, p)}
        // The row's own element, for a single-stage row. Stored on the entry for
        // the same reason `critMode` is: a refresh must not silently revert the hit
        // to the character's element and change the resistance it is read against.
        onElementChange={(el) => patchEntry(entry.id, { element: el })}
        // The row's own note. Stored on the entry, beside its drops and its
        // overrides, so it is saved and copied with them.
        onNoteChange={(note) => patchEntry(entry.id, { note })}
        onToggle={() => onToggle(entry.id)}
        onExpand={() => onExpand(entry.id)}
        onSummary={onCardSummary}
        onRemove={() => onRemove(entry.id)}
        // CONTROLLED BY THE ENTRY'S SELECTION, not left to the card's own defaults.
        //
        // Collapsing a compound entry to a single-part row (picking 技能伤害, say)
        // drops `children`, so the entry lands in THIS branch. An uncontrolled card
        // mounts at `normalattack`/stage 0 and reports that, overwriting the row the
        // user had just chosen -- so leaving a two-part row threw the selection away
        // and snapped back to 普通攻击·一段伤害. Measured; the second half of the
        // same report.
        //
        // `null` while the entry holds no selection yet keeps a brand-new entry's
        // card uncontrolled, which is what lets its very first pick work at all.
        sourceKey={heldKey}
        stageIndex={heldStage}
        onPick={onPickRow}
        // The row's own element choice, so a single-stage row keeps the damage type
        // the user picked across a refresh. `null` leaves it to the character's own
        // element, which is the default.
        element={entry.element || null}
      />
    );
  }

  const setChild = (childId, patch) =>
    patchEntry(entry.id, {
      children: children.map((c) => (c.id === childId ? { ...c, ...patch } : c)),
    });

  /**
   * THE PARENT, RENDERED AS A REAL ENTRY FOR THE PICKER ONLY.
   *
   * Choosing the skill and its row is `DamageCard`'s stage menu, so the parent
   * mounts a real card rather than a second copy of that menu -- a copy is the
   * version that drifts.
   *
   * It keeps NO drops: an empty drop list and a no-op `onDropsChange` are passed,
   * so the row cannot quietly become a place buffs accumulate. See the header note
   * and `docs/MULTI-PART.md`.
   */
  const parentAsEntry = {
    ...entry,
    // Its own summary, so the picker opens on the row the PARENT selected rather
    // than one of the children's.
    summary: entry.summary,
    children: undefined,
  };

  return (
    /**
     * AN OPEN COMPOUND ROW IS A GLASS PANEL, exactly as a single-stage one is.
     *
     * This group and an expanded `DamageEntry` are two components drawing the same
     * shape, so they must agree about what "open" looks like -- otherwise 多段伤害
     * rows and ordinary rows differ only by their content, and on a long axis the
     * open row is the one thing you need to find.
     *
     * The treatment matches `DamageEntry`'s: raised translucent surface, deep
     * shadow, a leading bar in the row's element colour, and a NEUTRAL hairline that
     * is the same width in both states. An earlier version framed the open row in
     * its element colour, which was too loud for a transient state and collided with
     * the selection ring.
     *
     * NO `backdrop-blur`, for the same reason it was dropped from `DamageEntry`: the
     * page is flat, so the filter costs a GPU pass per row and changes no pixels. The
     * gradient below is what makes the surface read as raised.
     *
     * `cv-auto` skips off-screen rows entirely -- a long axis is mostly off screen.
     * See the utility in `index.css` for why that is safe here.
     */
    <div
      data-entry-group={entry.id}
      className={`cv-auto relative overflow-hidden rounded-2xl border p-2 transition-[border-color,background-color,box-shadow] ${
        entry.expanded
          ? 'border-white/15 bg-white/[0.03] shadow-xl shadow-black/40'
          : 'border-white/10'
      }`}
      style={entry.expanded
        ? { backgroundImage: `linear-gradient(180deg, ${tint(accent, 0.08)} 0%, ${tint(accent, 0.025)} 45%, transparent 100%)` }
        : undefined}
    >
      {entry.expanded && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: accent }}
        />
      )}
      {/* THE PARENT HEADER. A summary row: it names the skill and totals its
          children. It carries NO drop zone, because it can neither hold a buff
          nor lend one downwards -- see the header note. */}
      <div
        data-entry-header={entry.id}
        data-selected={selected ? 'true' : undefined}
        // THE SELECTION GESTURE, matching the ordinary row's exactly.
        //
        // A multi-part entry renders through THIS header, not through
        // `DamageEntry`'s collapsed row -- so wiring the selection only into the
        // latter left every compound row unselectable, which is what the report
        // showed: single-stage rows highlighted, 多段伤害 rows did not respond at
        // all. The two rows look alike and must behave alike.
        //
        // `onMouseDown`, and the same button guard: a click that ends after a small
        // drag still fires `click` on a common ancestor, so the press is what
        // selects, and a control inside the header keeps its own press.
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target.closest('button, input, a, [role="button"]')) return;
          if (!onSelect) return;
          onSelect({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        }}
        className={`flex items-center gap-2 rounded-xl px-1 py-1 transition-colors ${
          selected ? 'bg-[#7fd4c1]/[0.06] ring-2 ring-[#7fd4c1]/70' : ''
        }`}
      >
        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
          {index + 1}
        </span>
        {/* THE PORTRAIT, matching every other entry row.
            Without it the parent was the one row on the axis with no character on
            it, so a long rotation could not be scanned by face -- which the
            collapsed row exists for. The ring is tinted by the row's own element,
            the same `boxShadow` the ordinary row uses, and falls back to the
            neutral grey when the first part's element is unset. */}
        <span
          className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/10"
          style={{ boxShadow: `0 0 0 1px ${elementOf(parentElement)?.color || 'rgb(220,220,230)'}44` }}
        >
          {entry.charId && entry.charId !== 'none' && (
            <img
              src={`/img/avatar/${entry.charId}.webp`}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex min-w-0 shrink flex-col leading-tight">
            <span className="block text-[9px] font-bold uppercase tracking-wider text-[#7fd4c1]">
              {L({ chs: '多段伤害', en: 'Multi-part hit' })}
            </span>
            <span className="block truncate text-[12px] font-medium text-white">
              {entry.summary?.stage ? L(entry.summary.stage) : '—'}
            </span>
          </span>
          {!entry.expanded && (
            <ChildNotes items={collectNotes(children, 'part')} onOpen={() => onToggle(entry.id)} />
          )}
        </span>
        {/* EACH PART'S OWN NUMBER, with the element it was computed against.
            A summed total was tried first: the halves of 法尔伽's 二段伤害 are 风
            and 冰, so one figure belongs to neither and says nothing about the row.
            A part with no figure yet shows a dash rather than 0, because an
            unmounted child is unknown, not zero damage. */}
        {partRows.length > 0 && (
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            {partRows.map((r) => (
              <span key={r.id} className="flex items-center gap-1.5">
                <ElementGlyph element={r.element} size={13} />
                <span className="flex flex-col items-end leading-tight">
                  <span className="text-[13px] font-bold tabular-nums text-white">
                    {r.figure
                      ? Math.round(r.figure.perHit).toLocaleString('en-US')
                      : <span className="text-white/25">—</span>}
                  </span>
                  {/* A PART THAT HITS MORE THAN ONCE SAYS SO, exactly as a
                      single-stage row does (`×2 = 90,312` under the per-hit figure).
                      Without it the row UNDERSTATED itself: 苍噬's two `x2` parts
                      read 45,156 and 24,315 while contributing 90,312 and 48,630, so
                      the rows added to 644,715 against a summary of 714,184 -- the
                      same numbers, disagreeing, which is the worst of both. */}
                  {r.figure?.hits > 1 && (
                    <span className="text-[9px] text-white/35">
                      ×{r.figure.hits} = {Math.round(r.figure.total).toLocaleString('en-US')}
                    </span>
                  )}
                </span>
              </span>
            ))}
          </span>
        )}

        <span className="shrink-0 text-[10px] text-white/35">
          {children.length} {L({ chs: '段', en: 'parts' })}
        </span>
        {/* Whether every child has been told what element it carries. A child
            without one reads the wrong resistance, so it is surfaced here rather
            than left for the user to discover in the numbers. */}
        {children.some((c) => !c.element) && (
          <span
            className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-[9px] text-amber-300"
            title={L({ chs: '有分段还没选元素，抗性会按默认算', en: 'a part has no element set; RES will use the default' })}
          >
            {children.filter((c) => !c.element).length} {L({ chs: '未指定', en: 'unset' })}
          </span>
        )}
        {/* NO "换段" BUTTON. One was added here and it was a duplicate: it called
            `onExpand`, which is what the ▾ triangle beside it already does, so the
            header offered two controls for one action and neither said what the
            user would find. The picker is the triangle's payload -- open the row
            and it is there. */}
        <button
          type="button"
          onClick={() => onToggle(entry.id)}
          title={L({ chs: entry.expanded ? '收起' : '展开', en: entry.expanded ? 'Collapse' : 'Expand' })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[16px] leading-none text-white/45 transition-colors hover:text-white"
        >
          {entry.expanded ? '▴' : '▾'}
        </button>
        <button
          type="button"
          onClick={() => onRemove(entry.id)}
          title={L({ chs: '删除该条目及其分段', en: 'Remove this entry and its parts' })}
          className="shrink-0 rounded px-1 text-[11px] text-white/25 transition-colors hover:text-white/80"
        >
          ✕
        </button>
      </div>

      {/* THE PARENT'S PICKER, mounted only while expanded.
          `cardOnly` draws the source column alone -- no collapsed row (the header
          above IS that row), no drop zone and no stat sheet.

          `drops` is simply not passed: the branch renders no drop zone, and
          `DamageEntry` defaults it to empty. The callbacks it cannot reach
          (`onDropsChange`, `onToggle`, `onExpand`, `onRemove`, `onCharChange`,
          `onStatsChange`) are omitted for the same reason -- the branch renders no
          control that could fire them. */}
      {entry.expanded && (
        // THE DIVIDER IS THE OPEN-STATE CUE that does the most work, and it is the
        // one Carbon's accordion relies on: a rule between the header and what the
        // header opened. It is brighter than the hairline border around the row, so
        // it reads as "the panel starts here" rather than as another edge.
        <div data-parent-picker className="mb-1 border-t border-white/15 pt-2">
          <DamageEntry
            cardOnly
            entry={parentAsEntry}
            team={team}
            teamScope={teamScope}
            // SEEDED FROM THE STORED SELECTION. The card's own state starts at the
            // normal attack's first stage, so an unseeded picker displayed a
            // different row from the one on the axis.
            sourceKey={parentKey}
            stageIndex={parentStage}
            onPick={onPickRow}
            onSummary={onCardSummary}
            // THE PARENT'S OWN CRIT MODE, stored on the entry.
            //
            // WITHOUT THIS THE ROW SILENTLY REVERTED TO 期望. The card keeps
            // `critMode` in its own state and falls back to `'avg'` when no prop
            // seeds it, and `cardOnly` was passed no `onPrefChange` -- so a choice
            // made here had nowhere to go. On the next mount (a reload, or an
            // import) the card started at `'avg'` again and reported that back,
            // overwriting whatever had been selected. Measured in an exported file:
            // every single-stage row carried `critMode: "crit"` while every
            // multi-part parent carried `undefined` with `summary.critMode: "avg"`.
            onPrefChange={(p) => patchEntry(entry.id, p)}
          />
        </div>
      )}

      {entry.expanded && (
        <div data-entry-children={entry.id} className="mt-1 flex flex-col gap-2 border-l border-white/10 pl-2">
          {children.map((child, i) => (
            <ChildEntry
              key={child.id}
              child={child}
              index={i}
              total={children.length}
              parent={entry}
              team={team}
              teamScope={teamScope}
              L={L}
              setChild={setChild}
              onStatsChange={onStatsChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One part of a compound row.
 *
 * Renders through the SAME `DamageEntry` as a top-level entry -- that is the point:
 * a child is not a new kind of thing, so it inherits the card, the drag handling,
 * the derived panel and the row/card agreement for free.
 *
 * The `entry` handed down is a plain entry shape with `partIndex` pinned, so
 * `DamageEntry` needs no knowledge of parts at all.
 */
function ChildEntry({ child, index, total, parent, team, teamScope, L, setChild, onStatsChange }) {
  // What the child shows as its identity: which number of the row it is, and the
  // coefficient it uses. Both come from the PARENT's selection, which is why they
  // are read off `parent.summary` rather than stored on the child -- storing them
  // would let a child disagree with the row it belongs to.
  const part = parent.summary?.parts?.[child.partIndex];
  const label = part
    ? `${L({ chs: '第', en: 'Part' })} ${child.partIndex + 1} · ${(part.mult * 100).toFixed(2)}%${part.hits > 1 ? ` ×${part.hits}` : ''}`
    : `${L({ chs: '第', en: 'Part' })} ${child.partIndex + 1}`;

  const entryLike = {
    ...parent,
    id: child.id,
    // The child's own, never the parent's.
    drops: child.drops,
    statOverrides: child.statOverrides,
    // Also the child's: a note says something about THIS half ("swirl
    // carries the aura"), which is not true of its sibling.
    note: child.note || '',
    // ALSO the child's own, NOT inherited through the `...parent` spread above.
    // Crit mode and reaction are per-hit choices: one part of a compound row can be
    // evaluated on a crit while its sibling is not, so spreading the parent's value
    // into every child would tie them together. `undefined` (rather than the
    // parent's) lets the card fall back to its own default until this child is set.
    critMode: child.critMode,
    reactionKey: child.reactionKey,
    // THE PART THIS CHILD IS, carried in the summary so the row recompute and the
    // card both compute part N rather than part 0. Without it every child of a
    // compound row reported the FIRST coefficient -- both showed the same number,
    // which is the bug the split exists to remove.
    summary: parent.summary
      ? { ...parent.summary, partIndex: child.partIndex, element: child.element || parent.summary.element }
      : null,
    children: undefined,
    expanded: child.expanded === true,
  };

  return (
    <div data-entry-child={child.id} data-part-index={child.partIndex}>
      <div className="mb-1 flex items-center gap-2 px-1">
        <span className="shrink-0 text-[10px] tabular-nums text-white/30">{index + 1}/{total}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white/70">{label}</span>
        {/* THE ELEMENT IS THE USER'S, and unset is a real state. The dataset does
            not say what the added half is -- 法尔伽's follows the party's
            elements, which is the player's team -- so guessing would read a
            resistance the hit never met. */}
        <ElementPicker
          value={child.element}
          onChange={(el) => setChild(child.id, { element: el })}
          L={L}
        />      </div>
      <DamageEntry
        index={index}
        entry={entryLike}
        team={team}
        teamScope={teamScope}
        drops={child.drops}
        // WHICH PART, and its element. The card needs both to compute THIS half
        // rather than the row's first coefficient.
        partIndex={child.partIndex}
        element={child.element}
        // THE PARENT'S SELECTION, so each child's card shows the ROW rather than
        // its own default. Without these every child rendered the normal attack's
        // first stage and the two agreed on a number unrelated to the skill.
        sourceKey={parent.summary?.sourceKey}
        stageIndex={parent.summary?.stageIndex}
        // A CHILD MAY NOT RE-PICK THE ROW: the parent owns that. Selecting one
        // number of a row and then changing the row from inside a child would
        // leave the siblings describing parts that no longer exist.
        //
        // `stageLocked` is what enforces it. The no-op `onPick` below is the older
        // mechanism and is kept only as a backstop: on its own it left the menu
        // openable and inert, so a user could click through to a row and watch
        // nothing happen. A locked card still NAMES the row -- that is the part's
        // identity -- but cannot open the menu. The parent is the one that
        // re-picks; see the picker above.
        stageLocked
        onPick={() => {}}
        onDropsChange={(next) => setChild(child.id, { drops: next })}
        // The character is the PARENT's: a part of a skill cannot belong to
        // somebody else.
        onCharChange={(charId) => setChild(child.id, { charId })}
        onStatsChange={(overrides) => onStatsChange(child.id, overrides, parent.id)}
        // A CHILD's own preference, written to the child. Two parts of one row can
        // legitimately be evaluated differently -- one is a crit-fished hit and the
        // other is not -- so this must not be shared with the parent or a sibling.
        onPrefChange={(p) => setChild(child.id, p)}
        onElementChange={(el) => setChild(child.id, { element: el })}
        onNoteChange={(note) => setChild(child.id, { note })}
        onToggle={() => setChild(child.id, { expanded: !child.expanded })}
        onExpand={() => setChild(child.id, { expanded: true })}
        // NOT routed back into state. A child's report describes the CHILD, and
        // storing it overwrote the PARENT's summary -- every child then rebuilt
        // its `entryLike` from that overwritten object and both computed part 0,
        // which is exactly why two children displayed the same number.
        //
        // Nothing needs it any more, in either direction: the child's number comes
        // from the computed axis, and its selection is the parent's plus its own
        // pinned `partIndex`, both already props. The report is still emitted
        // because the card produces it, and dropping it here is the honest way to
        // say the row does not depend on it.
        onSummary={() => {}}
        onRemove={() => setChild(child.id, { removed: true })}
      />
    </div>
  );
}
// MEMOISED because a row is expensive to render and almost always unchanged: the
// side holds every entry on the axis and re-renders on any edit, selection or
// language switch. Its props are kept stable by `planner-main` (see the row
// handlers there) precisely so this comparison can succeed -- without that, the
// inline arrows it used to receive made every row new on every render and this
// wrapper did nothing.
export default memo(EntryGroup);
