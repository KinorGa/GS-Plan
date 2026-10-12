// Right panel: one entry on the damage axis.
//
// The axis starts EMPTY and the user builds it: each "add entry" makes a blank
// damage card, and its character is chosen from the team.
//
// An entry owns a list of DROPPED SOURCES — whole buff cards, not loose items.
// Dragging "Starflash Blade" onto a hit brings the weapon and all three of its
// buffs as one unit, and it renders inside the entry as a real `BuffCard`.
//
// COLLAPSE: a rotation can hold many hits, so an entry folds down to a single
// row. The row reports what the hit actually is — portrait, source and stage
// ("Normal Attack · 1-Hit"), damage type and the damage number. It reads those
// from the card's own `onSummary` callback rather than recomputing them, so the
// row and the card can never disagree.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DamageCard, { defaultStats, reactionByKey } from '../DamageCard';
import BuffCard, { buffKeyOf } from './BuffCard';
import { useI18n } from '../i18n';
import { elementOf } from '../game';
import { buildSources, CHAR_FILE } from '../char-sources';
import { useTalentDamage } from '../lib/use-talent-damage'
import { useFitScale } from '../lib/use-fit-scale';
import { computeDamage } from '../lib/damage';
import { useCatalogue } from '../lib/catalogue';
import { derivePanel } from '../lib/stat-derive';
import { repairOverrides } from '../lib/axes-store';
import {
  DRAG_MIME, KEY_TO_STAT, STAT_META, mergeStats,
  foldDrops, foldZoneDrops, customZoneMultiplier, zoneFactor, zoneFactorLabel,
  buffsToText,
} from './buff-model';
import { readClipboard, writeClipboard, subscribeClipboard, clipboardRowCount } from '../lib/buff-clipboard';
import { ElementPicker } from './ElementGlyph';
import EntryNote from './EntryNote';
import { ElementGlyph } from './ElementGlyph';

const CARD_W = 1320;
const CARD_H = 470;

let uid = 0;
const nextId = () => `s${++uid}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * An element colour at a given alpha.
 *
 * `game.js` stores colours as `rgb(r, g, b)`, and CSS needs the SLASH form
 * `rgb(r g b / a)` to add an alpha to that -- `rgba()` is not a thing you can build
 * from the string without parsing the numbers back out. Converting commas to spaces
 * is what turns one into the other.
 *
 * A malformed input returns `transparent` rather than throwing: this feeds a
 * `backgroundImage`, and one bad colour must not blank a whole row.
 *
 * Exported because `EntryGroup` draws the same open-state panel and must not keep a
 * second copy of this -- two copies is how the two row shapes drift apart.
 */
export function tint(color, alpha) {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(String(color || ''));
  if (!m) return 'transparent';
  return `rgb(${m[1]} ${m[2]} ${m[3]} / ${alpha})`;
}

function DamageEntry({
  entry, team, teamScope, drops, onDropsChange, onCharChange, onRemove,
  onToggle, onExpand, onSummary, onStatsChange, index,
  // Write this row's own note. The store's `patchEntry`/`setChild`, threaded
  // down so the control never has to know how the entry is filed.
  onNoteChange,
  // Whether this row is part of the axis's copy/paste selection, and the click
  // that changes it. Handled on the COLLAPSED row, which is the row a user points
  // at when they are picking entries out of a rotation.
  selected = false,
  onSelect,
  // Store a display preference on the entry. Separate from `onSummary`, which
  // carries the whole selection and decides how many children an entry has.
  onPrefChange,
  // Set only for a CHILD of a compound row: which number of the row this entry
  // is, and the element that half carries. Undefined for an ordinary entry, which
  // is why nothing about the ordinary path changes.
  partIndex,
  element,
  // Store the row's OWN element, for a single-stage row. Kept on the entry (like
  // `critMode`/`reactionKey`) so a refresh does not silently revert the hit to the
  // character's element and change the resistance it is measured against.
  onElementChange,
  // Which hit the card should show, when a parent owns that choice. A child must
  // display the ROW ITS PARENT SELECTED -- its own default would be the normal
  // attack, so an uncontrolled child computed a number unrelated to the skill.
  sourceKey: sourceKeyProp,
  stageIndex: stageIndexProp,
  onPick: onPickProp,
  // Whether this entry may re-pick its own skill/stage.
  //
  // A CHILD of a compound row may not: it is one number of a row its PARENT chose,
  // so re-picking from inside one part would leave its siblings describing numbers
  // that no longer exist. The PARENT may, and its `cardOnly` picker exists for
  // exactly that -- so this is NOT implied by `sourceKey` being controlled. Both
  // are controlled; only the child is locked.
  stageLocked = false,
  // Draw ONLY the source picker: no collapsed row, no drop zone, no stat sheet.
  //
  // For the PARENT of a compound row. `EntryGroup` supplies its own header, and
  // the parent has nothing to hold: it can neither take a buff nor compute damage,
  // so what is left is the one control it exists for -- which skill and stage the
  // entry holds. See the branch note below.
  cardOnly = false,
}) {
  const { lang, L } = useI18n();

  const [over, setOver] = useState(false);
  const [charData, setCharData] = useState(null);
  const [pickOpen, setPickOpen] = useState(false);
  // Briefly true after a successful copy, so the button can confirm it worked.
  const [copied, setCopied] = useState(false);
  // null | 'ok' -- the paste button's transient feedback.
  const [pasteState, setPasteState] = useState(null);
  // How many buff rows are in the in-page stash. Subscribed rather than read once,
  // so 粘贴 enables the moment another row copies something.
  const [stashCount, setStashCount] = useState(() => clipboardRowCount());
  useEffect(() => subscribeClipboard((s) => setStashCount(clipboardRowCount(s))), []);
  const charAnchorRef = useRef(null);

  const boxRef = useRef(null);
  const { catalogue } = useCatalogue();
  // The curated constellation/passive damage table -- see `lib/use-talent-damage`.
  const talentDamage = useTalentDamage();

  const char = team.find((c) => c.id === entry.charId);
  const el = elementOf(char?.element || 'Cryo');

  /**
   * The panel DERIVED from this entry's character, level, weapon and artifacts.
   *
   * The card's own defaults are placeholders for a standalone page; a planner
   * entry has a real team behind it, and until this existed the artifacts had no
   * effect on the damage below them at all -- every entry showed the same
   * hardcoded numbers regardless of who it was or what they wore.
   */
  const derived = useMemo(() => {
    if (!char || !charData) return null;
    const weapon = char.weaponId ? catalogue?.weapons?.[char.weaponId] || null : null;
    return derivePanel({
      charId: char.id,
      detail: charData,
      level: char.level,
      element: char.element,
      weaponId: char.weaponId,
      weapon,
      artifacts: char.artifacts,
      stats: catalogue?.stats,
    });
  }, [char, charData, catalogue]);

  /**
   * The panel the card edits: defaults, then the derived values, then the user's
   * own edits on top.
   *
   * Only the EDITS are stored (`entry.statOverrides`), never the whole panel, so
   * a derived value keeps following the team until the user actually changes it,
   * and a field they changed stays changed when the artifacts move.
   */
  const effectiveStats = useMemo(
    () => ({ ...defaultStats(), ...(derived?.values || {}), ...(entry.statOverrides || {}) }),
    [derived, entry.statOverrides]
  );

  // A per-key edit rebuilds the override set from what is ON SCREEN, so it has to
  // go through the same repair the load path uses. Without this, an old
  // `enemyRes` that is still sitting in the panel is written straight back on the
  // next keystroke of ANY field, and the migration is undone -- the panel then
  // holds one dead key and eight fields still on the standard 10%, which is the
  // silent wrong number the repair exists to prevent.
  const setStatOverride = (key, value) =>
    onStatsChange?.(repairOverrides({ ...(entry.statOverrides || {}), [key]: value }));

  const clearStatOverrides = () => onStatsChange?.({});

  const expanded = entry.expanded === true;
  const toggle = () => onToggle?.();

  // `expanded` because the measured box only exists while the card is mounted --
  // see the note in useFitScale. Without it the effect runs once against a null
  // ref and the card is never scaled, so the 1320px panel is drawn at full size
  // inside a narrower `overflow-hidden` box and its right column is cut off.
  const scale = useFitScale(boxRef, CARD_W, expanded);

  // `char.talents` decides which column of the multiplier table is read -- see
  // `char-sources.multiplierAt`. It is absent on the standalone card page, where
  // the hardcoded `SOURCES` already carry their own numbers.
  /**
   * MEMOISED, and that is a correctness-of-performance matter rather than a nicety.
   *
   * `buildSources` returns a fresh array and the two folds below return fresh objects,
   * so before this the row produced new `sources`/`totals` on EVERY render. Those feed
   * `panelStats` and `liveSummary`, whose identities therefore changed every render --
   * and the reporting effect below uses `liveSummary` as a dependency. So every render
   * of the row wrote the same summary back into the entry, which produced a new axis,
   * which re-rendered the rows, which reported again. Measured on the 法布尼 axis: ONE
   * selection click called `updateEntries` 117 times and recomputed the axis 9 times.
   */
  const sources = useMemo(
    () => (charData
      ? buildSources(charData, char?.element, talentDamage, entry.charId, char?.talents)
      : []),
    [charData, char, talentDamage, entry.charId],
  );
  // `drops` defaults to empty rather than being required. The `cardOnly` branch
  // renders no drop zone and so has no drops to pass, but this line runs BEFORE
  // that branch is chosen -- so a missing array would throw while rendering a
  // picker that has nothing to do with buffs. Defaulting here keeps the prop
  // optional for that caller without a `drops={[]}` that reads like a real value.
  const allBuffs = (drops || []).flatMap((d) => d.buffs);
  /**
   * A dropped card's formula reads its OWN owner's panel, so each drop is folded
   * against the scope of the character the card came from. `teamScope` is keyed
   * by character id, which is what `source.owner.id` holds. A card whose owner is
   * not in the team (a paste from another team) gets NO scope: it refuses, rather
   * than guessing at some other character's panel.
   */
  const scopeOfDrop = useCallback((d) => {
    const ownerId = d?.source?.owner?.id;
    return (ownerId && teamScope?.get(ownerId)) || undefined;
  }, [teamScope]);
  // The SAME per-drop folds the axis uses, so the row, the card and the axis total
  // resolve every formula identically. The label is `buffKeyOf`, so a
  // built-in zone (擢升) reads as a name rather than its internal key. A card whose
  // owner is not on the team folds against no scope -- the honest refusal, since
  // its owner's panel was never loaded.
  const { totals, effective } = useMemo(
    () => foldDrops(drops, scopeOfDrop),
    [drops, scopeOfDrop],
  );
  const summaryChips = Object.entries(totals).map(([stat, value]) => ({
    stat,
    value,
    count: allBuffs.filter((b) => KEY_TO_STAT[b.key] === stat).length,
  }));
  // THE USER'S OWN MULTIPLIER ZONES.
  // A buff key that is not a known stat is the user's own label; same name merges
  // additively, and the whole thing multiplies the hit as ONE extra factor. Per
  // entry, because a dropped buff belongs to this row alone.
  //
  // Kept separate from `totals` on purpose: `totals` is keyed by panel FIELD and
  // is added into the panel, while these must not touch the panel at all -- they
  // are a factor, not a stat.
  const customZones = useMemo(
    () => foldZoneDrops(drops, scopeOfDrop, buffKeyOf),
    [drops, scopeOfDrop],
  );
  const zoneMult = useMemo(() => customZoneMultiplier(customZones), [customZones]);

  /**
   * Copy this entry's buffs into the in-page stash.
   *
   * THE STASH IS THE TRANSPORT, NOT THE OS CLIPBOARD. The text form is still
   * written to the real clipboard on a best-effort basis, because pasting into a
   * chat message or a spreadsheet is a genuine use -- but nothing depends on that
   * succeeding, so a refusal is silent rather than a dead button.
   *
   * DEFINED AFTER `customZones`, deliberately: a `useCallback` evaluates its
   * dependency array EAGERLY, so naming `customZones` above its `const` is a
   * temporal-dead-zone throw during render.
   */
  const copyBuffs = useCallback(() => {
    // CARDS, not a flat buff list: the grouping IS part of what the user sees, so
    // it has to survive the round trip. Flattening produced one card holding every
    // row, which read as a different thing from what was copied.
    writeClipboard(drops);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    // Best effort, and deliberately not awaited: pasting the text into a chat
    // message or a spreadsheet is a real use, but nothing here depends on it.
    try {
      const text = buffsToText(allBuffs, { zones: customZones, L });
      navigator.clipboard?.writeText(text).catch(() => {});
    } catch { /* ignore */ }
  }, [drops, allBuffs, customZones, L]);

  /**
   * Paste the stashed rows into THIS entry.
   *
   * THE STASH IS THE TRANSPORT, NOT THE OS CLIPBOARD.
   *
   * Three earlier attempts failed, all for the same underlying reason -- the paste
   * had no dependable SOURCE or TARGET:
   *
   *   1. `onPaste` on the drop zone. A `div` receives a paste only while IT has
   *      focus, and with buff cards filling the zone almost every visible pixel
   *      belongs to a CHILD. Clicking where a user naturally clicks left focus on
   *      `<body>` and Ctrl+V went nowhere.
   *   2. A `document` listener. That fixed focus and broke the target instead:
   *      every expanded entry attached its own listener, so one Ctrl+V appended a
   *      card to all of them, and `preventDefault()` cannot arbitrate between
   *      document-level listeners.
   *   3. `navigator.clipboard.readText()`. Gated behind the `clipboard-read`
   *      permission, which is refused by default with no prompt a page can show --
   *      so the button silently did nothing in a real browser while every test
   *      passed, because the harness granted that permission up front.
   *
   * Reading from module state removes all three problems at once: it cannot be
   * refused, it is synchronous, and the target is unambiguous because it is the
   * button that was clicked. The copy is also 1:1 BY CONSTRUCTION -- these are the
   * stored rows, not their text form re-parsed -- which matters for a value like
   * 大权 4.4 where the chip displays a derived factor.
   */
  const pasteBuffs = useCallback(() => {
    const cards = readClipboard()?.cards || [];
    const flash = (state) => {
      setPasteState(state);
      setTimeout(() => setPasteState(null), 1600);
    };
    if (!cards.length) {
      flash('empty');
      return;
    }
    onDropsChange([
      ...drops,
      // ONE DROP PER STASHED CARD, with its ORIGINAL source. A paste has to
      // reproduce what was copied: one card reading "粘贴的增益" holding every row
      // was arithmetically identical and still wrong, because the source's name
      // and icon are how the user tells one group from another.
      //
      // A fresh id per card, because ids identify drops within this entry and the
      // stashed ones belong to another.
      ...cards.map((c) => ({
        id: nextId(),
        source: { ...c.source },
        buffs: c.buffs.map((b) => ({ key: b.key, value: b.value, tag: b.tag || '' })),
      })),
    ]);
    flash('ok');
  }, [drops, onDropsChange]);

  /**
   * THE PANEL THE DAMAGE IS COMPUTED FROM: the entry's own panel WITH the dropped
   * cards folded in.
   *
   * WHY THE CARD CANNOT DO THIS ITSELF. `DamageCard` shows each field as its BASE
   * value with the buff contribution displayed beside it (`value={stats[k]}`,
   * `injected={injectedTotals[k]}`), so it must be handed the unmerged panel to
   * display -- and it is also told `injectedBuffs={null}`, with a comment saying
   * "a CONTROLLED host has already done this merge". That was not true. The panel
   * the card was given knows nothing about the drops, so its RESULT ignored every
   * dropped card while the COLLAPSED ROW -- which merges `totals` itself -- counted
   * them. One entry, two numbers, one screen: dropping a buff moved the row and
   * left the card's panel untouched.
   *
   * So the merge happens here, and `panelStats` is what the result is computed
   * from. The card still receives the unmerged `stats` for DISPLAY, which is why
   * both are passed.
   */
  const panelStats = useMemo(
    () => (Object.keys(totals).length ? mergeStats(effectiveStats, totals) : effectiveStats),
    [effectiveStats, totals]
  );

  // Stable so the card's reporting effect does not re-fire every render.
  const handleSummary = useCallback((s) => onSummary?.(s), [onSummary]);

  /*
   * The collapsed row must show a CORRECT number even though the card is
   * unmounted. Keeping only the last reported summary would leave the row stale
   * the moment a buff is dropped while collapsed — the card that computed the
   * old value is gone, so nothing would notice.
   *
   * Instead the row recomputes from the entry's own data (character + drops +
   * stat panel) using the same lib/damage.js the card uses. The card's report is
   * still used for the selection it owns (which source and stage are chosen), so
   * the two only ever disagree if the underlying stats do — which they cannot,
   * since both read the same fold and the same formula.
   *
   * The panel matters as much as the buffs here: `stats` is the entry's own
   * controlled panel (the planner owns it), so a manual edit made while
   * expanded survives collapse AND is reflected in this recompute. Reading a
   * separate field here — or falling back to raw BASE_STATS — is exactly what
   * made the row disagree with the card.
   */
  const liveSummary = useMemo(() => {
    const sel = entry.summary;
    if (!sel || !charData || entry.charId === 'none') return sel || null;

    const src = sources.find((s) => s.key === sel.sourceKey) || sources[0];
    if (!src) return sel;
    const stage = src.stages[Math.min(sel.stageIndex || 0, src.stages.length - 1)];

    // WHICH PART OF THE ROW, and what element it carries.
    //
    // A compound row (`59.27%+110.08%`) is several hits of DIFFERENT damage types
    // in one talent row. Computing from `stage` alone gave every part the FIRST
    // coefficient and the skill's element, so both children of that row showed the
    // same number -- measured, and exactly the bug this split exists to remove.
    //
    // The PINNED part wins over whatever the stored summary says, because the
    // props are the current truth and the summary is the last report. A child
    // reports its `partIndex` from the card, and the stored copy is one render
    // behind on the first paint -- long enough for the row to show the wrong
    // part's number.
    // `sel.partIndex` and `sel.element` are supplied by whoever owns the entry:
    // the card for a plain entry, and the child wrapper for a child. Reading them
    // here is what lets ONE recompute serve both, instead of the row and the card
    // drifting apart again.
    // The PINNED part wins over whatever the stored summary says: the props are
    // the current truth, the summary is the last report.
    const pinnedPart = partIndex != null ? partIndex : sel.partIndex;
    const parts = stage.parts || [{ mult: stage.mult, hits: stage.hits }];
    const part = parts[Math.min(pinnedPart || 0, parts.length - 1)];
    const effective = { mult: part.mult, hits: part.hits, bonus: stage.bonus };
    const usedElement = element || sel.element || src.element;

    // `panelStats` -- the SAME panel the card computes from, so the row and the
    // card cannot disagree. It already has `totals` folded in, so merging here
    // again would count every dropped card twice.
    //
    // This used to be `mergeStats(effectiveStats, totals)`, which produced the
    // RIGHT number for the row while the card produced a different one -- the card
    // was handed the unmerged panel and told to merge nothing. Both now read the
    // one merge.
    const r = computeDamage(panelStats, {
      stage: effective,
      reaction: reactionByKey(entry.reactionKey ?? sel.reactionKey),
      element: usedElement,
      // The entry's own stored choice, NOT `sel.critMode`. The summary is the
      // card's report and is only as fresh as the last render of a mounted card;
      // the row must agree with the card the instant the button is pressed, and it
      // recomputes while the card is unmounted. Reading the summary here is what
      // let the collapsed row keep showing an average after the user had picked a
      // crit -- and, worse, after a collapse it was the ONLY surviving value.
      critMode: entry.critMode || 'avg',
      // The same independent zone the card applies, so the collapsed row and the
      // card cannot disagree about a user-named buff.
      zoneMult,
      // The ROW reads the same attacker level the card does. Omitting it here
      // would restore the exact divergence this recompute exists to prevent: the
      // row on the formula's 90 default while the card used the real level.
      atkLevel: Number(char?.level) || 90,
    });

    return {
      ...sel, sourceKey: src.key, stage, element: usedElement,
      partIndex: pinnedPart,
      perHit: r.perHit, total: r.total, hits: effective.hits || 1,
    };
    // `char` is a dependency because the defence zone reads its level -- without
    // it the row keeps a number computed at the old level after the panel changes.
    // `zoneMult` too: dropping a card that names its own zone must move the row.
  }, [entry.summary, entry.charId, panelStats, charData, sources, partIndex, element, char, zoneMult]);

  const summary = liveSummary;

  /**
   * Report the collapsed row's own recomputed figure.
   *
   * THE MISSING LINK for a parent that totals its parts. `handleSummary` was wired
   * only to the CARD, so a row that never mounted one computed its number and told
   * nobody -- which is why a collapsed multi-part row showed `—` until each child
   * was expanded and its card reported. The whole point of `liveSummary` is that it
   * recomputes from the entry's own data WITHOUT a card, so it is exactly what a
   * parent needs; it simply was not being forwarded.
   *
   * Only while COLLAPSED. When the entry is expanded its card reports the same
   * figure through `handleSummary`, and reporting from both would double every
   * update -- the card's report carries more than the number (the whole selection),
   * so the two are not interchangeable.
   *
   * Guarded on `charData`: `liveSummary` falls back to the STORED summary until the
   * character's data has loaded, and forwarding that back would be reporting the
   * value it was derived from.
   */
  // The last object reported, so a render that produces an equal-but-new summary
  // cannot start the report -> write -> render cycle again. The values themselves are
  // compared inside `setEntrySummary`; this is the cheap identity guard in front of it.
  const lastReported = useRef(null);
  useEffect(() => {
    if (expanded || cardOnly || !charData) return;
    if (!liveSummary || !Number.isFinite(liveSummary.perHit)) return;
    if (lastReported.current === liveSummary) return;
    lastReported.current = liveSummary;
    onSummary?.(liveSummary);
  }, [expanded, cardOnly, charData, liveSummary, onSummary]);

  /**
   * Whether this row is made of several distinct damage parts.
   *
   * A compound row (`59.27%+110.08%`) is rendered as a PARENT plus one child per
   * part, and `EntryGroup` gives every child its own element picker because the
   * halves genuinely differ. So the parent must not also offer one -- and the
   * picker on this component is therefore shown only when there are no parts.
   */
  const hasParts = (summary?.parts?.length || 0) > 1;

  useEffect(() => {
    if (!entry.charId || entry.charId === 'none') {
      setCharData(null);
      return;
    }
    let alive = true;
    fetch(CHAR_FILE(entry.charId, lang))
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setCharData(j))
      .catch(() => alive && setCharData(null));
    return () => { alive = false; };
  }, [entry.charId, lang]);

  /* ------------------------------------------------------------ drop */

  // Expanding swaps the collapsed row for the full card, so the element under
  // the pointer is replaced mid-drag. Doing that on every `dragover` tick means
  // the browser re-resolves the drop target continuously, and a `drop` that
  // lands before React commits goes nowhere. Expanding on `dragenter` instead
  // fires once per pointer entry, keeping the tree stable for the actual drop.
  //
  // No ref guard is needed: `expanded` is the state that matters, and it is
  // already false only while collapsed. A ref here would have to be reset on
  // dragleave, and any missed dragleave (dropping outside the window, a
  // suppressed event) would leave it stuck true and disable the expansion
  // entirely — a bug this code previously had.
  const onDragEnter = (e) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    if (!expanded) {
      // `onExpand` is a prop of this component; `entry` is the plain data object
      // and carries no callbacks, so reading it off `entry` silently did nothing.
      onExpand?.();
    }
  };

  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  // `dragleave` fires when crossing child boundaries too; only clear the hover
  // highlight when the pointer has actually left this entry.
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setOver(false);
  };

  const onDrop = (e) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    setOver(false);
    if (!raw) return;
    e.preventDefault();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    onDropsChange([
      ...drops,
      {
        id: nextId(),
        source: {
          kind: payload.kind,
          icon: payload.icon,
          iconKind: payload.iconKind,
          rank: payload.rank,
          name: payload.name,
          owner: payload.owner,
        },
        buffs: (payload.buffs || []).map((b) => ({ ...b })),
      },
    ]);
  };

  const removeDrop = (id) => onDropsChange(drops.filter((d) => d.id !== id));
  const setDropBuffs = (id, next) =>
    onDropsChange(drops.map((d) => (d.id === id ? { ...d, buffs: next } : d)));

  /* ------------------------------------------------------- collapsed row */

  if (!expanded && !cardOnly) {
    return (
      <div
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-axis-entry
        data-collapsed="true"
        data-selected={selected ? 'true' : undefined}
        // THE SELECTION GESTURE LIVES ON THE ROW ITSELF.
        //
        // `mousedown` rather than `click`: a click that ends after a small drag --
        // which happens constantly while selecting rows -- still fires a `click` on
        // the common ancestor, and the selection would jump somewhere unintended.
        // Selecting on the press is what every list does.
        //
        // The three modifiers are read here and passed up rather than interpreted,
        // because the axis is what knows the order of the rows a Shift-click has to
        // span.
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          // A control inside the row (the collapse triangle, the remove ✕) owns its
          // own press; hijacking it would make those buttons change the selection
          // instead of doing their job.
          if (e.target.closest('button, input, a, [role="button"]')) return;
          if (!onSelect) return;
          onSelect({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        }}
        className={`cv-auto group flex items-center gap-3 rounded-xl border bg-[#0a0a0a] px-2.5 py-2 transition-colors ${
          over ? 'border-[#7fd4c1] bg-white/[0.03]' : 'border-white/10'
        } ${
          // The ring is drawn OUTSIDE the border so the row does not change size
          // when it is selected -- a one-pixel shift on every click would make a
          // multi-select jitter.
          selected ? 'ring-2 ring-[#7fd4c1]/70 bg-[#7fd4c1]/[0.06]' : ''
        }`}
      >
        <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-white/30">
          {index + 1}
        </span>

        {/* Portrait — the fastest way to scan a long rotation. */}
        <span
          className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-white/10"
          style={{ boxShadow: summary ? `0 0 0 1px ${el.color}44` : 'none' }}
        >
          {entry.charId !== 'none' && (
            <img
              src={`/img/avatar/${entry.charId}.webp`}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </span>

        {/* Source · stage: "which attack, which hit" -- then the row's own note.

            The two share the row's flexible middle and are wrapped together,
            because the note must land in the space that was already empty rather
            than push the damage column off the row. The identity column keeps its
            natural width and SHRINKS when long; the note takes what is left. */}
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex min-w-0 shrink flex-col leading-tight">
            <span
              className="truncate text-[9px] font-bold uppercase tracking-wider"
              style={{ color: el.color }}
            >
              {summary ? SOURCE_KIND_LABEL(summary.sourceKey, L) : L({ chs: '未选择角色', en: 'No character' })}
            </span>
            <span className="truncate text-[12px] font-medium text-white">
              {summary ? L(summary.stage) : '—'}
            </span>
          </span>

          <EntryNote value={entry.note} onChange={onNoteChange} L={L} variant="row" />
        </span>

        {/* Damage type: the hit's element as a TINTED glyph.
            It used to be a plain `<img>` of `element.toLowerCase()`, which drew the
            black stencil untinted -- invisible on this near-black row -- and fell
            back to `Cryo` when the element was unknown, so an unset part claimed to
            be Cryo. `ElementGlyph` is the shared tinted silhouette, and an unknown
            element now draws the neutral blade the card uses. */}
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <ElementGlyph element={summary?.element} size={14} />
          <span className="text-[10px] text-white/45">
            {summary ? L(summary.reaction) : '—'}
          </span>
        </span>

        {/* Damage. */}
        <span className="w-[76px] shrink-0 text-right">
          <span className="block text-[15px] font-bold tabular-nums text-white">
            {summary ? Math.round(summary.perHit).toLocaleString('en-US') : '—'}
          </span>
          {summary?.hits > 1 && (
            <span className="block text-[9px] text-white/35">
              ×{summary.hits} = {Math.round(summary.total).toLocaleString('en-US')}
            </span>
          )}
        </span>

        <button
          type="button"
          onClick={toggle}
          title={L({ chs: '展开', en: 'Expand' })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[16px] leading-none text-white/45 transition-colors hover:text-white"
        >
          ▾
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={L({ chs: '删除该条目', en: 'Remove entry' })}
          className="shrink-0 rounded px-1 text-[11px] text-white/20 transition-colors hover:text-white/80"
        >
          ✕
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------- expanded */

  /**
   * THE CARD, shared by the ORDINARY expanded path.
   *
   * Written once so the two ordinary paths (collapsed row's recompute and the
   * expanded card) cannot drift. `cardOnly` does NOT use it: that branch renders
   * `DamageCard` in its `sourceOnly` mode, which takes a different set of props
   * (no stats, no drops, no overrides) because the parent of a compound row owns
   * none of those. The earlier version of this comment claimed one call site for
   * both, which was never true -- and the props the two modes need genuinely
   * differ, so merging them would mean passing a column of dead arguments.
   */
  const card = entry.charId === 'none' ? (
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-white/30">
      {L({ chs: '先在上方选择角色', en: 'Pick a character above first' })}
    </div>
  ) : (
    <DamageCard
      characterId={entry.charId}
      charName={char?.chsName}
      char={char ? {
        chsName: char.chsName,
        enName: char.enName,
        element: char.element,
        weaponType: char.weaponType,
      } : undefined}
      // The character's LEVEL, passed explicitly because the `char` object above is
      // deliberately trimmed to what the portrait needs and does not carry it. It
      // is a term in the defence zone; the card cannot read it off `char`.
      atkLevel={char?.level ?? null}
      sources={sources.length ? sources : undefined}
      // The buffs are NOT handed over a second time: `stats` below is
      // already the effective panel, with `totals` folded in. Passing
      // both would merge every dropped card twice, doubling a +20% ATK
      // buff. The totals go across for DISPLAY, so a field can still show
      // the "+28%" a dropped card contributed beside the number itself.
      injectedBuffs={null}
      injectedTotals={totals}
      onSummary={handleSummary}
      // The DERIVED panel plus the user's own edits, never the raw
      // stored panel: the card must compute from what the team actually
      // provides.
      // The panel to DISPLAY: the entry's own values, unmerged. Each field shows
      // its base number with the buff contribution beside it, so folding the
      // buffs in here would show the total twice.
      stats={effectiveStats}
      // The panel to COMPUTE from: the same values with the dropped cards folded
      // in. Passing one panel for both is what made a dropped buff move the
      // collapsed row and leave the card's result untouched.
      computeStats={panelStats}
      // The user's own multiplier zone, applied as its own factor.
      zoneMult={zoneMult}
      // THE TWO CARD-LOCAL CHOICES THE ENTRY MUST REMEMBER.
      //
      // Collapsing an entry unmounts the card, so `critMode` and `reactionKey` as
      // plain local state were lost every time: pick 必定暴击, collapse, expand,
      // and the number silently fell back to the average.
      //
      // They are stored on the ENTRY, not merged into `summary`. `summary` is the
      // card's report of a whole selection, and the planner rebuilds the split from
      // it -- sending a partial object through that channel would replace a
      // two-part row with one that has a crit mode and no `parts`. Two display
      // preferences do not belong in the document that decides how many children an
      // entry has.
      critMode={entry.critMode ?? null}
      onCritModeChange={(k) => onPrefChange?.({ critMode: k })}
      reactionKey={entry.reactionKey ?? null}
      onReactionChange={(k) => onPrefChange?.({ reactionKey: k })}
      // WHICH PART OF A COMPOUND ROW, forwarded verbatim. Undefined for an
      // ordinary entry, which is what keeps the ordinary path unchanged.
      partIndex={partIndex}
      element={element}
      // WHICH HIT, when a parent owns the choice. A child must show the row
      // its parent selected rather than its own default.
      sourceKey={sourceKeyProp}
      stageIndex={stageIndexProp}
      onPick={onPickProp}
      // WHO MAY RE-PICK THE ROW. A CHILD may not: re-picking from inside one part
      // would leave its siblings describing numbers that no longer exist. The
      // PARENT may -- that is the whole point of its picker.
      stageLocked={stageLocked}
      // BOTH callbacks, and they are not alternatives.
      //
      // `onStatEdit` is per-key and is what records the override; the
      // card prefers it when present. `onStatsChange` is the whole-panel
      // setter the card falls back to -- and omitting it left
      // `setStats` pointing at the card's OWN `useState`, so a controlled
      // card whose panel arrives by prop silently kept edits in local
      // state that the entry never saw. The field displayed the typed
      // number while the entry recomputed the damage from the un-edited
      // panel: two different numbers, one screen.
      onStatsChange={onStatsChange}
      onStatEdit={setStatOverride}
      onStatReset={clearStatOverrides}
      overridden={Object.keys(entry.statOverrides || {})}
    />
  );

  /**
   * `cardOnly`: the SOURCE PICKER and nothing else.
   *
   * For the PARENT of a compound row. `EntryGroup` draws its own header, so the
   * collapsed row here would double it, and the parent must not have a drop zone
   * (it can neither hold a buff nor lend one to its children -- see the header
   * note).
   *
   * It is the SOURCE column alone -- not the whole 1320x470 card. The parent has
   * no stats of its own and folds no buffs, so every other column was inert there;
   * mounting the full card buried the two controls that work (skill, stage) under
   * a page that did not. So there is also NO scaled fixed-size box: the picker
   * sizes to its content, which is what keeps it from reserving 470px of empty
   * panel for a menu and a button.
   *
   * THE PARENT'S PICKER IS NOT DRAGGABLE: no drop handlers are attached to this
   * wrapper, so a buff dropped here lands nowhere rather than silently on a row
   * with no children to affect.
   */
  if (cardOnly) {
    return (
      <div data-axis-entry data-card-only="true">
        <DamageCard
          sourceOnly
          characterId={entry.charId}
          charName={char?.chsName}
          char={char ? {
            chsName: char.chsName,
            enName: char.enName,
            element: char.element,
            weaponType: char.weaponType,
          } : undefined}
          sources={sources.length ? sources : undefined}
          sourceKey={sourceKeyProp}
          stageIndex={stageIndexProp}
          onPick={onPickProp}
          stageLocked={stageLocked}
          onSummary={handleSummary}
        />
      </div>
    );
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-axis-entry
      data-expanded="true"
      /**
       * AN OPEN ROW IS A GLASS PANEL -- and the reason is legibility, not taste.
       *
       * A collapsed row and an expanded one used to be drawn identically, so the
       * only cue was the 11px ▴/▾ glyph at the far right of a 1600px row. The first
       * fix wrapped the open row in a 2px frame in its ELEMENT colour, and that
       * overshot: a saturated border is the loudest thing on screen, spent on a
       * transient state, so the open row competed with the content it was opening
       * and collided with the SELECTION ring, which is already an accent border.
       *
       * The app already has a glass idiom -- a translucent surface plus a deep
       * shadow, used by the unit card, the artifact row and both dialogs -- so the
       * open row adopts it rather than inventing a fourth treatment. Glass also
       * happens to be the right metaphor here: the row is FLOATING ABOVE the stack
       * while it is open, and a translucent raised surface says exactly that.
       *
       * NO `backdrop-blur` HERE. The idiom carries one everywhere else, but this page
       * is a flat `bg-background`: blurring it returns the same pixels, so the filter
       * is invisible while still costing a GPU pass PER ROW, and a long axis is many
       * rows. The row drops it and keeps the tint; the dialogs keep it, because they
       * float over other content.
       *
       * WHY IT NEEDS ITS OWN GRADIENT. The tint gives the glass something to hold: a
       * faint wash of the row's own element colour across the top, fading out, which
       * reads as light hitting the panel and also carries which element this row is.
       *
       * The border stays NEUTRAL and the same width in both states, so nothing
       * shifts when a row opens.
       */
      className={`cv-auto relative flex flex-col gap-2 overflow-hidden rounded-2xl border p-2 pl-3 transition-[border-color,background-color,box-shadow] duration-200 ${
        over
          ? 'border-[#7fd4c1]/60 bg-white/[0.06] shadow-2xl shadow-black/40'
          : 'border-white/15 bg-white/[0.03] shadow-xl shadow-black/40'
      }`}
      style={{
        '--accent': el.color,
        // The wash that makes the glass visible on a flat page, and tints the panel
        // with the row's element. Kept very low: it is a surface, not a signal.
        backgroundImage: `linear-gradient(180deg, ${tint(el.color, 0.08)} 0%, ${tint(el.color, 0.025)} 45%, transparent 100%)`,
      }}
    >
      {/* The leading edge, in the row's own element colour. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: el.color }}
      />
      <div className="flex items-center gap-2 px-1 pt-0.5">
        <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] tabular-nums text-white/40">
          {index + 1}
        </span>

        <div className="relative">
          <button
            ref={charAnchorRef}
            type="button"
            onClick={() => setPickOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white transition-colors hover:border-white/25"
          >
            {char ? (
              <>
                <img
                  src={`/img/avatar/${char.id}.webp`}
                  alt=""
                  className="h-4 w-4 rounded object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <span>{char.chsName}</span>
              </>
            ) : (
              <span className="text-white/50">{L({ chs: '选择角色', en: 'Pick character' })}</span>
            )}
            <svg
              width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white/40"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {pickOpen && (
            // Placed against the VIEWPORT rather than the button, and portalled
            // to the body.
            //
            // As an `absolute` child this opened downward with no room check, so
            // on an entry low on the page it landed off the bottom of the screen:
            // measured at y 864..911 on a 900px viewport, with the last character
            // unreachable. Different from the clipping bugs elsewhere -- nothing
            // cut it, it was simply placed outside the screen.
            <CharPickerMenu
              anchor={charAnchorRef.current}
              team={team}
              current={entry.charId}
              onPick={(id) => { onCharChange(id); setPickOpen(false); }}
              onClose={() => setPickOpen(false)}
            />
          )}
        </div>

        {/* THE HIT'S ELEMENT, for a SINGLE-stage row only.
            A row with several parts already gets one picker per part in
            `EntryGroup` (the parts can be different damage types, which is the
            whole reason it was added there). An ordinary row had none, so a
            法尔伽 元素战技 was locked to 风 -- but a 技能伤害 row can be a swirl
            hit, or the entry can be modelling a teammate's reaction, and there was
            no way to say so. The default stays the character's own element, so a
            row nobody touches is arithmetically identical to before.

            Hidden when `parts` exist, because then this row is the PARENT and each
            child carries its own: two controls for the same thing on one screen is
            how they end up disagreeing. */}
        {!hasParts && (
          <ElementPicker
            value={element || null}
            onChange={(e) => onElementChange?.(e)}
            L={L}
            showLabel={false}
          />
        )}

        <span className="ml-auto shrink-0 text-[10px] text-white/35">
          {drops.length > 0
            ? `${drops.length} ${L({ chs: '张卡', en: 'cards' })} · ${effective} ${L({ chs: '条生效', en: 'applied' })}`
            : L({ chs: '未添加增益', en: 'no buffs' })}
        </span>

        <button
          type="button"
          onClick={toggle}
          title={L({ chs: '收起', en: 'Collapse' })}
          className="shrink-0 rounded px-1.5 py-0.5 text-[16px] leading-none text-white/45 transition-colors hover:text-white"
        >
          ▴
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={L({ chs: '删除该条目', en: 'Remove entry' })}
          className="shrink-0 rounded px-1 text-[11px] leading-none text-white/25 transition-colors hover:text-white/80"
        >
          ✕
        </button>
      </div>

      {/* THE DIVIDER, the same cue the compound row uses: a rule between the header
          and what it opened. Together with the leading colour bar and the raised
          background it is what makes the open row readable, and unlike a coloured
          frame it does not compete with the content or with the selection ring. */}
      <div className="border-t border-white/15" />

      {/* THE ACTION ROW, ALWAYS PRESENT -- outside the drops branch below.
          It used to live inside the chip row, which only rendered once the entry
          HAD buffs, so an empty entry -- exactly the one you want to paste INTO --
          showed no 粘贴 button at all. A control for filling an empty row cannot be
          hidden while the row is empty. */}
      <div className="flex flex-wrap items-center gap-1 px-1">
        {summaryChips.map((s) => {
          const meta = STAT_META[s.stat] || { chs: s.stat, en: s.stat, suffix: '' };
          return (
            <span
              key={s.stat}
              title={s.count > 1 ? `×${s.count}` : undefined}
              className="rounded border border-[#7fd4c1]/30 bg-[#7fd4c1]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#7fd4c1]"
            >
              {L(meta)} +{s.value}{meta.suffix || ''}
            </span>
          );
        })}

        {/* THE USER'S OWN ZONES, drawn differently on purpose.
            A teal chip adds into a panel field; these MULTIPLY the hit, so an
            identical-looking chip would say the wrong thing about how the number
            was reached. Amber, and written as a factor. The label comes from
            `zoneFactorLabel` so a raw zone (大权) reads `×2` while a percentage
            zone (擢升) reads `×1.300` -- and so the chip cannot drift from its own
            tooltip again. */}
        {customZones.map((z) => (
          <span
            key={`zone-${z.name}`}
            title={L({
              chs: `${z.raw ? '直接倍数乘区' : '独立乘区（同名相加）'}：×${zoneFactor(z).toFixed(4)}${z.count > 1 ? `，来自 ${z.count} 张卡` : ''}`,
              en: `${z.raw ? 'Direct multiplier zone' : 'Independent multiplier zone (same name adds)'}: x${zoneFactor(z).toFixed(4)}${z.count > 1 ? `, from ${z.count} cards` : ''}`,
            })}
            className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300"
          >
            {L(z)} ×{zoneFactorLabel(z)}{z.count > 1 ? ` (${z.count})` : ''}
          </span>
        ))}

        {/* `ml-auto` pushes the pair to the right edge rather than tight against
            the last chip, so they do not read as another buff. The labels flip
            briefly: an action with no feedback is indistinguishable from a dead
            button. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-copy-buffs
            onClick={copyBuffs}
            disabled={!allBuffs.length}
            title={allBuffs.length
              ? L({
                chs: `复制这 ${allBuffs.length} 条增益，之后可在别的条目点「粘贴」原样加回来（同时也会写入系统剪贴板，便于贴到别处）`,
                en: `Copy these ${allBuffs.length} buffs, then use Paste on another row to add them back exactly (also written to the system clipboard)`,
              })
              : L({ chs: '本条目还没有增益', en: 'This row has no buffs yet' })}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40 transition-colors hover:border-white/30 hover:text-white/80 disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/40"
          >
            {copied
              ? L({ chs: '已复制', en: 'Copied' })
              : L({ chs: '复制', en: 'Copy' })}
          </button>

          {/* Reads the IN-PAGE stash, so it needs no permission and cannot be
              refused. Disabled until something has been copied, which also tells
              the user the copy took effect. */}
          <button
            type="button"
            data-paste-buffs
            onClick={pasteBuffs}
            disabled={!stashCount}
            title={stashCount
              ? L({
                chs: `粘贴 ${stashCount} 条增益到本条目（原样加回来，之后可继续修改）`,
                en: `Paste ${stashCount} buffs into this row (then edit as usual)`,
              })
              : L({ chs: '还没有复制任何增益：先在别的条目点「复制」', en: 'Nothing copied yet: use Copy on another row first' })}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/40 transition-colors hover:border-white/30 hover:text-white/80 disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:text-white/40"
          >
            {pasteState === 'ok'
              ? L({ chs: '已粘贴', en: 'Pasted' })
              : L({ chs: '粘贴', en: 'Paste' })}
          </button>
        </span>
      </div>

      {/* THE NOTE, on its own line under the action row. It is a sentence, not a
          chip: sharing that row would wrap it mid-word as the chips grew. */}
      <div className="px-1">
        <EntryNote value={entry.note} onChange={onNoteChange} L={L} variant="card" />
      </div>

      <div
        className={`flex flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors ${
          over ? 'border-[#7fd4c1] bg-white/[0.02]' : 'border-white/10'
        }`}
      >
        {drops.length === 0 ? (
          <div className="flex h-[46px] flex-col items-center justify-center gap-0.5 text-[11px] text-white/25">
            <span>
              {over
                ? L({ chs: '松开以添加整张卡', en: 'Release to add the card' })
                : L({ chs: '把左侧整张增益卡拖到这里', en: 'Drop a buff card here' })}
            </span>
            <span className="text-[9px] text-white/20">
              {L({ chs: '或点上方「粘贴」把复制的增益贴进来', en: 'or use Paste above to paste copied buffs' })}
            </span>
          </div>
        ) : (
          <>
            {/* The dropped cards sit on a FOUR-COLUMN GRID, so every card is the
                same width whether the row is full or not.

                Two earlier arrangements were both wrong:
                  - a fixed 248px each left a third of a 1300px panel empty at
                    four cards, while a long source name was still ellipsised;
                  - `flex-[1_1_248px]` fixed that for a FULL row but stretched a
                    partial one, so nine cards laid out 4 + 4 + 1 with the last
                    card alone across the whole panel.

                A grid gives the row's spare space to nobody: `.map` puts four to
                a line at a quarter width each, and a row of one or two keeps that
                same width instead of ballooning. The names and tags get the extra
                room either way, which was the point.

                `minmax(0,1fr)` rather than `1fr`: a grid track defaults to
                `auto` minimum, so a long unbreakable name would push its column
                wider than a quarter and break the alignment between rows. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {drops.map((d) => (
                <div key={d.id} className="relative min-w-0">
                  <BuffCard
                    source={d.source}
                    buffs={d.buffs}
                    editable
                    // The scope of THIS card's owner, so a formula resolves
                    // while it is being edited.
                    scope={scopeOfDrop(d)}
                    onBuffsChange={(next) => setDropBuffs(d.id, next)}
                    className="w-full"
                  />
                  <button
                    type="button"
                    onClick={() => removeDrop(d.id)}
                    title={L({ chs: '移除这张卡', en: 'Remove this card' })}
                    className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-[#1a1a20] text-[10px] text-white/50 transition-colors hover:border-white/40 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {over && (
                <div className="flex h-[68px] w-[248px] items-center justify-center rounded-2xl border border-dashed border-[#7fd4c1] text-[11px] text-white/60">
                  {L({ chs: '松开以添加', en: 'Release to add' })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Fixed-size 1320px panel, rendered at its true width then scaled to the
          column (see useFitScale for why transform, not zoom). Kept mounted
          only while expanded: a collapsed rotation can hold dozens of entries,
          and rendering every full card would be needlessly heavy. */}
      <div ref={boxRef} className="overflow-hidden" style={{ height: CARD_H * scale }}>
        <div
          style={{
            width: CARD_W,
            height: CARD_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {card}
        </div>
      </div>
    </div>
  );
}

// The card's source keys → the short label the collapsed row shows.
// char-sources.js keys sources as `normalattack` / `elementalskill` /
// `elementalburst`, so those are matched first; the `kind` values are accepted
// too, since the standalone damage card labels its own sources that way.
const SOURCE_KIND_LABEL = (key, L) =>
  ({
    normalattack: L({ chs: '普通攻击', en: 'Normal Attack' }),
    elementalskill: L({ chs: '元素战技', en: 'Elemental Skill' }),
    elementalburst: L({ chs: '元素爆发', en: 'Elemental Burst' }),
    normal: L({ chs: '普通攻击', en: 'Normal Attack' }),
    skill: L({ chs: '元素战技', en: 'Elemental Skill' }),
    burst: L({ chs: '元素爆发', en: 'Elemental Burst' }),
    paste: L({ chs: '粘贴的增益', en: 'Pasted buffs' }),
  }[key] || L({ chs: '攻击', en: 'Attack' }));

/* -------------------------------------------------- entry character picker */

/**
 * Pick the entry's character, from the team.
 *
 * A portalled, viewport-aware menu. As an `absolute` child of the entry's header
 * it opened downward with no room check, so an entry low on the page put the
 * list off the bottom of the screen -- measured at y 864..911 on a 900px
 * viewport, with the last member unreachable.
 *
 * The panel is also inside the entry, which has no `overflow` of its own but sits
 * in a column that can scroll; portalling removes it from that question entirely
 * and makes the placement rule the only thing to get right.
 *
 * Flips above the trigger when the list does not fit below, and is clamped to the
 * viewport horizontally and vertically so a long team on a short screen still
 * leaves every row reachable.
 */
function CharPickerMenu({ anchor, team, current, onPick, onClose }) {
  const { L } = useI18n();
  const menuRef = useRef(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!anchor) return;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const W = 180;
      // Measured from the MENU once it exists, not estimated from the row count.
      // An estimate of `team.length * 34 + 10` came out 1px short of the real
      // height and left the panel overhanging the viewport edge.
      const H = menuRef.current?.offsetHeight || Math.min(team.length * 38 + 12, 268);
      const below = window.innerHeight - r.bottom;

      setRect({
        left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
        // Above when it does not fit below AND there is room above; otherwise
        // below, clamped so the bottom edge stays on screen.
        top: below < H && r.top > H
          ? r.top - H - 4
          : Math.min(r.bottom + 4, window.innerHeight - H - 8),
      });
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, team.length]);

  /**
   * Re-place once the menu has been laid out.
   *
   * The first pass runs before the portal exists, so it falls back to an
   * estimate; this corrects it with the real height. Without it the clamp used
   * the estimate and the panel could hang a few pixels past the viewport edge --
   * which is exactly what the earlier measurement caught (780..901 on a 900px
   * screen).
   */
  useEffect(() => {
    if (!rect || !menuRef.current || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = menuRef.current.offsetHeight;
    const below = window.innerHeight - r.bottom;
    const ideal = below < h && r.top > h
      ? r.top - h - 4
      : Math.min(r.bottom + 4, window.innerHeight - h - 8);
    if (Math.abs(ideal - rect.top) > 1) setRect((cur) => ({ ...cur, top: ideal }));
  });

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    const onClick = (e) => {
      if (anchor?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [anchor, onClose]);

  if (!rect) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-char-menu
      style={{ position: 'fixed', left: rect.left, top: rect.top, width: 180 }}
      className="z-[70] max-h-[260px] overflow-y-auto rounded-xl border border-white/10 bg-[#141418] p-1 shadow-2xl shadow-black/80"
    >
      {team.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c.id)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
            c.id === current ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
          }`}
        >
          <img
            src={`/img/avatar/${c.id}.webp`}
            alt=""
            className="h-5 w-5 rounded object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <span className="flex flex-col leading-tight">
            <span>{c.chsName}</span>
            <span className="text-[9px] text-white/35">{c.element}</span>
          </span>
        </button>
      ))}
      {!team.length && (
        <p className="px-2 py-3 text-center text-[10px] text-white/30">
          {L({ chs: '队伍里还没有角色', en: 'No characters in the team' })}
        </p>
      )}
    </div>,
    document.body
  );
}
// MEMOISED for the same reason as `EntryGroup`, and it is the same row when the
// entry is not a compound one -- `EntryGroup` renders straight through to this.
export default memo(DamageEntry);
