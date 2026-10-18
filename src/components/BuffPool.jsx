// Left panel: the team's buff pool, in TWO MODES.
//
// 模板池 (template mode) -- the derived pool. Each entry is ONE source (a normal
// attack, elemental skill, burst, passive talent, unlocked constellation, weapon,
// or artifact set bonus) rendered with the project's own `BuffCard` -- icon-led,
// collapsed, hover or click to expand its n buffs. Dragging a card onto a damage
// entry copies it there, and the copy shares nothing with the pool.
//
// 实例池 (instance mode) -- named instances built FROM those templates. One
// definition (a template snapshot plus the values the user typed) is bound to as
// many axis entries as needed, because the same numbers usually belong on fifty
// rows and typing them fifty times is what this mode exists to remove. Two
// instances of one template are two definitions: the instance is the unit of
// "this buff, at these numbers". See `lib/buff-instances.js` for the store, the
// splice, and why the bindings are DERIVED rather than stored.
//
// THE POOL IS DERIVED, NOT AUTHORED
//   `pool` comes from `lib/buff-sources.js`, which builds one entry per item a
//   unit actually carries. A C0 unit contributes no constellation cards; a unit
//   with no weapon equipped contributes no weapon card. Adding a character to the
//   team in the builder changes what appears here.
//
//   A source's `buffs` array starts EMPTY by design: upstream publishes prose
//   descriptions, not stat tables, so the values are the user's to fill in.
//
// The unit of dragging is the WHOLE CARD, because the unit of meaning is the
// source. A weapon that grants three buffs is one thing you bring to a hit, not
// three independent numbers -- dragging its rows separately would tear apart
// exactly the grouping the card exists to express.
//
// Dragging serialises a JSON snapshot, and the receiving entry re-copies it, so
// a dropped card shares no state with the pool or with any other entry. That is
// the TEMPLATE mode's contract, unchanged. An instance is the opposite deal on
// purpose: it stays linked, so editing its values reaches every entry carrying
// it -- which is the whole point of binding one to fifty rows.

import { useMemo, useState } from 'react';
import BuffCard, { SOURCE_KINDS } from './BuffCard';
import { useI18n } from '../i18n';
import { DRAG_MIME } from './buff-model';
import { elementOf, avatarImg } from '../game';
import { spliceInstance, useInstances } from '../lib/buff-instances';
import { usePoolView } from '../lib/pool-view';

/**
 * WHAT THE SECOND FILTER OFFERS, in the order it offers it.
 *
 * The four the user named -- 天赋 / 命座 / 武器 / 圣遗物 -- and 天赋 folds the three
 * attack rows in with the passives, because to a reader they are all "the character's
 * own kit" and splitting them would be five chips where four were asked for.
 *
 * `SOURCE_KINDS` already carries every label and colour the cards use, so the chips
 * take theirs from there rather than repeating them: a chip that is the same hue as
 * the rail on the cards it selects is read without being read.
 */
const KIND_FILTERS = [
  // `kind` is the SOURCE_KINDS key this chip takes its colour and label from.
  // Without it the chip asked `SOURCE_KINDS[undefined]` and lost its hue.
  { key: 'talent', kind: 'talent', kinds: ['talent', 'normal', 'skill', 'burst'] },
  { key: 'constellation', kind: 'constellation', kinds: ['constellation'] },
  { key: 'weapon', kind: 'weapon', kinds: ['weapon'] },
  { key: 'artifact2', kind: 'artifact2', kinds: ['artifact2'] },
  { key: 'artifact4', kind: 'artifact4', kinds: ['artifact4'] },
];

export default function BuffPool({
  pool,
  className = '',
  /**
   * Instance mode's three inputs, all supplied by the planner:
   *
   *   `axisEntries`  the ACTIVE axis's rows, so the binding panel can list the
   *                  entries an instance can be bound to. The panel is derived
   *                  from these every render, which is what makes a drop deleted
   *                  on the entry side un-tick its box here.
   *   `onPatchDrops` `(entryId, fn)` -- replaces one row's drops wherever it sits.
   *                  The pool never walks the axis itself: a row can be a
   *                  top-level entry, a loop member, or a part of a compound row,
   *                  and only the planner knows how to reach all three.
   *   `bindTargets`  the BINDABLE rows, flattened and labelled by the planner
   *                  (`{ id, label, depth }`). Passed in rather than derived here
   *                  because a compound parent is not itself bindable -- its parts
   *                  are -- and a part's id is an implementation detail of the
   *                  split that the planner owns.
   */
  axisEntries = [],
  onPatchDrops,
  bindTargets = [],
  // The `$` scope of each team member, keyed by character id, so an editable
  // formula-valued buff can be resolved and autocompleted while it is typed. See
  // `lib/buff-formula.js`.
  teamScope = null,
}) {
  const { L } = useI18n();

  /**
   * WHERE THE POOL WAS LEFT, remembered across reloads.
   *
   * The mode, the open binding panel, the picker and the finder used to be four
   * throwaway `useState`s, so a refresh dropped the pool back to 模板 with
   * everything shut -- and a session spent binding one instance to fifty rows had
   * to be re-opened by hand after every reload. They are persisted now, the way an
   * entry's `expanded` flag already is. See `lib/pool-view.js`.
   */
  const [view, patchView] = usePoolView();
  const { mode, bindOpen, picking, needle } = view;
  const setMode = (next) => patchView({ mode: next });
  const setBindOpen = (next) => patchView({ bindOpen: typeof next === 'function' ? next(bindOpen) : next });
  const setPicking = (next) => patchView({ picking: typeof next === 'function' ? next(picking) : next });
  const setNeedle = (next) => patchView({ needle: next });

  // `null` means "everyone", and it is the default for both layers. A filter that
  // started narrow would hide cards the user never asked to hide, which is worse
  // than a long list -- the pool is what you drag FROM, and a missing card reads as
  // "this character has no weapon".
  const [who, setWho] = useState(null);
  const [what, setWhat] = useState(null);

  const { instances, create, update, remove } = useInstances();

  /**
   * The characters that actually have cards, in the order they appear.
   *
   * Derived from the POOL rather than from the team document: the pool already knows
   * which units contributed something (a C0 unit contributes no constellation, a
   * unit with no weapon contributes no weapon card), so offering a character whose
   * cards are all missing would only produce an empty list.
   */
  const owners = useMemo(() => {
    const seen = new Map();
    for (const c of pool) {
      const o = c.owner;
      if (!o?.id || seen.has(o.id)) continue;
      seen.set(o.id, o);
    }
    return [...seen.values()];
  }, [pool]);

  /**
   * Which kind filters would actually show something, so a chip cannot lead nowhere.
   *
   * A character with no weapon equipped contributes no weapon card, and offering the
   * chip anyway would give a filter whose only outcome is an empty column.
   */
  const available = useMemo(() => {
    const present = new Set(pool.map((c) => c.kind));
    return new Set(KIND_FILTERS.filter((f) => f.kinds.some((k) => present.has(k))).map((f) => f.key));
  }, [pool]);

  /** The kinds one chip stands for, or null for "all kinds". */
  const kindsFor = (key) => KIND_FILTERS.find((f) => f.key === key)?.kinds || null;

  /** The template list, filtered. Drives BOTH template mode and the picker. */
  const shown = useMemo(() => {
    const kinds = what ? kindsFor(what) : null;
    return pool.filter((c) => (!who || c.owner?.id === who) && (!kinds || kinds.includes(c.kind)));
  }, [pool, who, what]);

  const filtered = who !== null || what !== null;

  /* ------------------------------------------------------------- instances */

  /**
   * Which entries currently carry each instance.
   *
   * DERIVED FROM THE DROPS, never from a list kept beside the instance. A binding
   * is a drop tagged with `instanceId`, so this is the only place the truth lives
   * -- delete the card on the entry side and the box here un-ticks itself, with
   * nothing to keep in step.
   */
  const boundIds = useMemo(() => {
    const map = new Map();
    for (const t of bindTargets) {
      for (const d of t.drops || []) {
        if (!d?.instanceId) continue;
        if (!map.has(d.instanceId)) map.set(d.instanceId, new Set());
        map.get(d.instanceId).add(t.id);
      }
    }
    return map;
  }, [bindTargets]);

  const boundOf = (instanceId) => boundIds.get(instanceId) || new Set();

  /** Create from a template card and open the picker's result, ready to bind. */
  const createInstance = (template) => {
    const inst = create(template);
    setBindOpen(inst.id);
  };

  /**
   * Bind or unbind ONE entry, which is the checkbox in the panel.
   *
   * `spliceInstance` does the work: binding appends a drop tagged with the
   * instance id, unbinding removes it. The snapshot is the instance AS IT IS, so a
   * row bound today gets today's numbers.
   */
  const setBinding = (inst, entryId, on) => {
    onPatchDrops?.(entryId, (drops) => spliceInstance(
      drops,
      inst.id,
      on,
      on ? { template: inst.template, buffs: inst.buffs } : null,
    ));
  };

  /**
   * A value edit reaches every bound entry, so an instance is a LIVE definition.
   *
   * This is the difference the mode exists for: change 通用伤害加成 30 -> 35 once and
   * fifty rows move together. A copy-then-edit model would leave forty-nine of them
   * at the old number with nothing on screen saying which.
   */
  const updateInstance = (inst, patch) => {
    update(inst.id, patch);
    if (!patch.buffs) return;
    const snapshot = { template: inst.template, buffs: patch.buffs };
    for (const entryId of boundOf(inst.id)) {
      onPatchDrops?.(entryId, (drops) => spliceInstance(drops, inst.id, true, snapshot));
    }
  };

  /**
   * Deleting an instance takes its copies with it.
   *
   * Otherwise the bindings would survive their definition: rows would keep a card
   * tagged with an instance that no longer exists, editable but no longer reachable
   * from anywhere -- which is the state this mode is supposed to make impossible.
   */
  const removeInstance = (inst) => {
    for (const entryId of boundOf(inst.id)) {
      onPatchDrops?.(entryId, (drops) => spliceInstance(drops, inst.id, false, null));
    }
    remove(inst.id);
    setBindOpen((open) => (open === inst.id ? null : open));
  };

  /**
   * The binding list, filtered.
   *
   * THE SEARCH REACHES THE PATH AND THE LABEL, not just the id. Now that a row
   * shows the containers it sits in, "循环A" and "第2段" are things a user will
   * type -- and a filter that could only match `e7-p1` would be answering a
   * question nobody asks, since the id is what you read OFF the row rather than
   * what you search FOR.
   */
  const bindable = bindTargets.filter((t) => {
    const q = needle.trim().toLowerCase();
    if (!q) return true;
    const hay = [
      t.id,
      t.label,
      ...(t.path || []).map((p) => p.name),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex shrink-0 items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
          {L({ chs: '增益池', en: 'Buff Pool' })}
        </h2>
        <span className="text-[10px] tabular-nums text-white/40">
          {mode === 'instance'
            ? L({
              chs: instances.length ? `${instances.length} 个实例` : '尚无实例',
              en: instances.length ? `${instances.length} instances` : 'no instances',
            })
            : shown.length
              ? L({
                chs: filtered
                  ? `${shown.length} / ${pool.length} 个来源 · 整张拖拽`
                  : `${pool.length} 个来源 · 整张拖拽`,
                en: filtered
                  ? `${shown.length} / ${pool.length} sources · drag a card`
                  : `${pool.length} sources · drag a card`,
              })
              : L({ chs: '整张拖拽 → 伤害轴', en: 'drag a card → axis' })}
        </span>
      </div>

      {/*
        THE MODE SWITCH.

        Two modes, because there are two genuinely different things to do with a
        source: use it once (drag a copy in, edit that copy) or define it once and
        use it everywhere (an instance, bound to as many rows as you like). Serving
        both from one list meant the second job had nowhere to live.

        It is a switch rather than a second panel because they are alternatives,
        not companions: template mode is the quick copy, instance mode is the
        managed one, and showing both at once would put fifty dragged sources and
        their fifty instances on screen together.
      */}
      <div className="flex shrink-0 items-center gap-1" data-pool-mode={mode}>
        <ModeTab active={mode === 'template'} onClick={() => setMode('template')} title={L({ chs: '拖拽取用（一次性副本）', en: 'Drag a one-off copy' })}>
          <TemplateGlyph />
          <span>{L({ chs: '模板', en: 'Templates' })}</span>
        </ModeTab>
        <ModeTab
          active={mode === 'instance'}
          onClick={() => setMode('instance')}
          title={L({ chs: '实例：定义一次，绑定到任意条目', en: 'Instances: define once, bind to any entry' })}
        >
          <InstanceGlyph />
          <span>{L({ chs: '实例', en: 'Instances' })}</span>
          {instances.length > 0 && (
            <span className="rounded bg-white/10 px-1 text-[9px] tabular-nums text-white/60">{instances.length}</span>
          )}
        </ModeTab>
      </div>

      {/*
        TWO FILTER LAYERS, AND THEY COMPOSE, IN BOTH MODES.

        By CHARACTER and by KIND, applied together: picking 法尔伽 and 武器 shows that
        character's weapon, not every weapon on the team and not all of 法尔伽's kit.

        ICONS RATHER THAN WORDS, since every kind already has a glyph and a colour on
        the cards themselves (`SOURCE_KINDS`) -- a chip that is the same shape and hue
        as the thing it selects is read without being read. The character layer is
        portraits, which is how the rest of the app identifies a character.

        ONLY THE FIRST LAYER IS DRAWN WHEN THERE IS ONE CHARACTER, because a filter
        with a single option cannot filter anything.

        The same bar serves the instance picker: choosing which template to
        instantiate is the same question as choosing which card to drag.
      */}
      {(owners.length > 1 || available.size > 1) && (mode === 'template' || picking) && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {owners.length > 1 && (
            <div className="flex items-center gap-1" data-pool-filter="owner">
              <OwnerChip active={who === null} onClick={() => setWho(null)} title={L({ chs: '全部角色', en: 'All characters' })}>
                <span className="text-[10px] leading-none">{L({ chs: '全部', en: 'All' })}</span>
              </OwnerChip>
              {owners.map((o) => (
                <OwnerChip
                  key={o.id}
                  active={who === o.id}
                  onClick={() => setWho(who === o.id ? null : o.id)}
                  title={o.name}
                  portrait={o.id}
                  ring={o.element}
                />
              ))}
            </div>
          )}

          {available.size > 1 && (
            <div className="flex items-center gap-1" data-pool-filter="kind">
              <KindChip active={what === null} onClick={() => setWhat(null)} title={L({ chs: '全部类型', en: 'All kinds' })}>
                <span className="text-[10px] leading-none">{L({ chs: '全部', en: 'All' })}</span>
              </KindChip>
              {KIND_FILTERS.filter((k) => available.has(k.key)).map((k) => (
                <KindChip
                  key={k.key}
                  active={what === k.key}
                  onClick={() => setWhat(what === k.key ? null : k.key)}
                  title={SOURCE_KINDS[k.kind]?.chs ? L(SOURCE_KINDS[k.kind]) : k.key}
                  color={SOURCE_KINDS[k.kind]?.color}
                >
                  <KindGlyph k={k.key} />
                </KindChip>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* TEMPLATE MODE -- what the pool has always been.                   */}
      {/* ================================================================ */}
      {mode === 'template' && (
        <>
          {!pool.length && (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] leading-relaxed text-white/25">
              {L({
                chs: '队伍还没有增益来源。先到「配队配置」添加角色并装备武器与圣遗物。',
                en: 'No sources yet. Add characters, weapons and artifacts in the builder first.',
              })}
            </p>
          )}

          {/* Nothing matched the filter -- said plainly, so an empty column reads as
              "these two do not go together" rather than as "the character has nothing". */}
          {pool.length > 0 && !shown.length && (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] leading-relaxed text-white/25">
              {L({
                chs: '这个组合下没有来源。',
                en: 'Nothing matches this combination.',
              })}
            </p>
          )}

          {shown.map((card) => (
            <div
              key={card.id}
              draggable
              onDragStart={(e) => {
                // A JSON snapshot of the whole source plus its buffs: the drop makes
                // its own copy from this, so nothing is shared by reference.
                e.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({
                    kind: card.kind,
                    icon: card.icon,
                    iconKind: card.iconKind,
                    rank: card.rank || '',
                    name: card.name,
                    owner: card.owner,
                    buffs: (card.buffs || []).map((b) => ({
                      key: b.key,
                      value: b.value,
                      tag: b.tag || '',
                    })),
                  })
                );
                e.dataTransfer.setData('text/plain', card.name?.chs || 'buff card');
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={L({ chs: '拖拽整张卡到右侧伤害条目', en: 'Drag this card to a damage entry' })}
              // The source key, so a test (or a future feature) can name the card it is
              // looking at. `libKey` identifies the source rather than the card instance.
              data-pool-source={card.libKey || card.key}
              className="cv-auto cursor-grab active:cursor-grabbing"
            >
              {/* The source IS the card's `source` prop: `buff-sources.js` builds
                  them in that shape, so no wrapper object is needed here. */}
              <BuffCard
                source={card}
                buffs={card.buffs || []}
                scope={teamScope?.get(card.owner?.id) || null}
                className="w-full shrink-0"
              />
            </div>
          ))}
        </>
      )}

      {/* ================================================================ */}
      {/* INSTANCE MODE -- define once, bind to many.                       */}
      {/* ================================================================ */}
      {mode === 'instance' && (
        <>
          {instances.map((inst) => {
            const bound = boundOf(inst.id);
            const open = bindOpen === inst.id;
            return (
              <div key={inst.id} className="flex flex-col gap-1.5" data-pool-instance={inst.id}>
                {/* The definition. `editable` is what makes the values the user's:
                    the same rows the card shows collapsed become inputs while it is
                    open, and every keystroke reaches the bound entries. */}
                <BuffCard
                  source={{ ...inst.template, rank: inst.template?.rank || '' }}
                  buffs={inst.buffs}
                  editable
                  scope={teamScope?.get(inst.template?.owner?.id) || null}
                  onBuffsChange={(next) => updateInstance(inst, { buffs: next })}
                  className="w-full shrink-0"
                />

                {/* THE ROW THAT SAYS WHERE THIS INSTANCE REACHES. */}
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className="shrink-0 rounded border border-white/10 px-1 py-0.5 text-[9px] tabular-nums text-white/40">
                    #{inst.seq}
                  </span>
                  <button
                    type="button"
                    data-bind-toggle
                    onClick={() => setBindOpen(open ? null : inst.id)}
                    title={L({ chs: '查看/修改拥有此实例的条目', en: 'Show the entries carrying this instance' })}
                    aria-pressed={open}
                    className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] leading-none transition-colors ${
                      open
                        ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                        : 'border-white/10 text-white/45 hover:border-white/25 hover:text-white/75'
                    }`}
                  >
                    <LinkGlyph />
                    <span className="tabular-nums">{bound.size}</span>
                    <span className="truncate">{L({ chs: '个条目', en: 'entries' })}</span>
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[10px] text-white/25">
                    {L({ chs: '同一模板可建多个实例', en: 'several instances per template' })}
                  </span>
                  <button
                    type="button"
                    data-remove-instance
                    onClick={() => removeInstance(inst)}
                    title={L({ chs: '删除实例，并从所有条目移除', en: 'Delete this instance and remove it from every entry' })}
                    className="shrink-0 rounded px-1 text-[11px] text-white/25 transition-colors hover:text-red-300"
                  >
                    ✕
                  </button>
                </div>

                {/* THE BINDING PANEL: every entry this instance could reach, with
                    the ones already carrying it ticked. */}
                {open && (
                  <div className="flex flex-col gap-1 rounded-xl border border-[#7fd4c1]/25 bg-[#7fd4c1]/[0.04] p-1.5" data-bind-panel={inst.id}>
                    {bindTargets.length === 0 ? (
                      <p className="px-1 py-2 text-center text-[10px] leading-relaxed text-white/30">
                        {L({
                          chs: '伤害轴还没有条目。先在右侧添加条目，再回来绑定。',
                          en: 'The axis has no entries yet. Add one on the right, then bind it here.',
                        })}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-1">
                          <input
                            value={needle}
                            onChange={(e) => setNeedle(e.target.value)}
                            placeholder={L({ chs: '搜索条目…', en: 'Find an entry…' })}
                            className="h-6 min-w-0 flex-1 rounded-md border border-white/10 bg-[#141418] px-1.5 text-[10px] text-white outline-none placeholder:text-white/25 focus:border-[#7fd4c1]/50"
                          />
                          <button
                            type="button"
                            onClick={() => bindable.forEach((t) => { if (!bound.has(t.id)) setBinding(inst, t.id, true); })}
                            title={L({ chs: '勾选当前列出的全部条目', en: 'Bind every listed entry' })}
                            className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 transition-colors hover:border-white/25 hover:text-white/80"
                          >
                            {L({ chs: '全选', en: 'All' })}
                          </button>
                          <button
                            type="button"
                            onClick={() => bindable.forEach((t) => { if (bound.has(t.id)) setBinding(inst, t.id, false); })}
                            title={L({ chs: '取消当前列出的全部条目', en: 'Unbind every listed entry' })}
                            className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 transition-colors hover:border-white/25 hover:text-white/80"
                          >
                            {L({ chs: '清空', en: 'None' })}
                          </button>
                        </div>

                        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                          {bindable.map((t) => {
                            const on = bound.has(t.id);
                            // The whole address, for the tooltip: the path leads
                            // INTO the id, so the two are written as one string.
                            // A click target this small cannot show everything, and
                            // the path is what got truncated.
                            const address = [...t.path.map((p) => p.name), t.id].join(' › ');
                            return (
                              <label
                                key={t.id}
                                data-bind-entry={t.id}
                                title={`${address} — ${t.label}`}
                                className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 text-[10px] transition-colors hover:bg-white/5 ${
                                  on ? 'text-[#7fd4c1]' : 'text-white/45'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) => setBinding(inst, t.id, e.target.checked)}
                                  className="h-3 w-3 shrink-0 accent-[#7fd4c1]"
                                />
                                {/*
                                  GROUP NAME, THEN ID -- the path leads into the
                                  row, the way a file path leads into a file. It
                                  reads `首轮 › e1` for a plain member of a loop
                                  and `首轮 › 狂狮突进二段伤害 › e3-p1` for a part.

                                  THE SEPARATOR IS BETWEEN ITEMS, never after the
                                  last one. A trailing `›` was emitted here, which
                                  left every row whose parent is the LOOP ITSELF
                                  reading `首轮 ›` and then nothing -- as if a
                                  level had gone missing, when the row simply has
                                  no inner container. A single-stage entry IS one
                                  row; a multi-part entry is a container of rows,
                                  which is why only those grow another level.

                                  Each container keeps the name its own header
                                  uses (a loop's title, a compound row's stage),
                                  so the panel and the axis cannot disagree. A
                                  square marks a loop, a round mark a multi-part
                                  row.
                                */}
                                {t.path.length > 0 && (
                                  <span className="flex min-w-0 shrink items-center gap-1 overflow-hidden text-white/25">
                                    {t.path.map((p, i) => (
                                      <span key={p.id} className="flex min-w-0 items-center gap-1">
                                        {i > 0 && <span className="shrink-0 text-white/20">›</span>}
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 ${p.loop ? 'rounded-[2px] bg-[#7fd4c1]/50' : 'rounded-full bg-white/25'}`}
                                        />
                                        <span className="max-w-[70px] truncate">{p.name}</span>
                                      </span>
                                    ))}
                                    <span className="shrink-0 text-white/20">›</span>
                                  </span>
                                )}
                                <span className={`shrink-0 font-mono tabular-nums ${on ? 'text-[#7fd4c1]/70' : 'text-white/30'}`}>
                                  {t.id}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                              </label>
                            );
                          })}
                          {!bindable.length && (
                            <p className="px-1 py-2 text-center text-[10px] text-white/25">
                              {L({ chs: '没有匹配的条目', en: 'No entry matches' })}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!instances.length && !picking && (
            <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] leading-relaxed text-white/25">
              {L({
                chs: '还没有实例。点下面「新建实例」，从模板里挑一个来源，给它填好数值，再绑定到任意条目。',
                en: 'No instances yet. Use "New instance" below, pick a source, fill in its values, then bind it to any entry.',
              })}
            </p>
          )}

          {/* THE WAY IN. A picker rather than a form: an instance is made FROM a
              template, so the templates are what you choose between -- with the
              same two filters, because picking one is the same question as
              picking a card to drag. */}
          <button
            type="button"
            data-new-instance
            onClick={() => setPicking((p) => !p)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors ${
              picking
                ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                : 'border-dashed border-white/20 text-white/50 hover:border-[#7fd4c1]/50 hover:text-[#7fd4c1]'
            }`}
          >
            {picking
              ? L({ chs: '收起模板列表', en: 'Hide the templates' })
              : `+ ${L({ chs: '新建实例', en: 'New instance' })}`}
          </button>

          {picking && (
            <>
              <p className="px-1 text-[10px] leading-relaxed text-white/30">
                {L({
                  chs: '点模板卡上的「＋实例」创建。同一模板可以建多个，数值各自独立。',
                  en: 'Click a template\'s "+" to create one. The same template can be instantiated repeatedly, each with its own values.',
                })}
              </p>
              {!pool.length && (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/25">
                  {L({ chs: '队伍还没有增益来源。', en: 'The team has no buff sources yet.' })}
                </p>
              )}
              {pool.length > 0 && !shown.length && (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-white/25">
                  {L({ chs: '这个组合下没有来源。', en: 'Nothing matches this combination.' })}
                </p>
              )}
              {shown.map((card) => (
                <div key={card.id} className="relative" data-pool-template={card.libKey || card.key}>
                  {/* THE INSTANTIATE CONTROL GOES IN THE CARD'S OWN CORNER SLOT.
                      It used to be an absolute sibling at `right-2 top-2`, which
                      landed on the card's buff-count chip and chevron -- the button
                      and the chip overlapped into an unreadable pile. Passing it as
                      `cornerAction` lets the card reserve the room for it, which a
                      sibling outside the component cannot do. */}
                  <BuffCard
                    source={card}
                    buffs={card.buffs || []}
                    className="w-full shrink-0"
                    cornerAction={(
                      <button
                        type="button"
                        data-instantiate={card.libKey || card.key}
                        onClick={() => createInstance(card)}
                        title={L({ chs: '用这个模板建一个实例', en: 'Instantiate this template' })}
                        className="flex h-6 items-center gap-1 rounded-md border border-[#7fd4c1]/50 bg-[#0d0d0d] px-1.5 text-[10px] leading-none text-[#7fd4c1] transition-colors hover:bg-[#7fd4c1]/15"
                      >
                        <span className="text-[11px] leading-none">＋</span>
                        <span>{L({ chs: '实例', en: 'Inst' })}</span>
                      </button>
                    )}
                  />
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One side of the mode switch. */
function ModeTab({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium leading-none transition-colors ${
        active
          ? 'border-[#7fd4c1]/50 bg-[#7fd4c1]/10 text-[#7fd4c1]'
          : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
      }`}
    >
      {children}
    </button>
  );
}

/** A square filter button, shared by both layers so they read as one row of controls. */
function Chip({ active, onClick, title, color, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={active && color ? { borderColor: color, backgroundColor: `${color.replace('rgb(', 'rgba(').replace(')', ', 0.16)')}` } : undefined}
      className={`flex h-6 min-w-6 items-center justify-center gap-1 rounded-md border px-1 leading-none transition-colors ${
        active
          ? 'border-white/40 bg-white/15 text-white'
          : 'border-white/10 text-white/40 hover:border-white/25 hover:text-white/70'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A character chip: the portrait, ringed in the unit's element. */
function OwnerChip({ active, onClick, title, portrait, ring, children }) {
  // `ring` is the unit's element KEY ("Anemo"), not a colour, so it goes through
  // `elementOf` -- reading it as an rgb() string left every ring undrawn.
  const ringColor = ring ? elementOf(ring).color : undefined;
  return (
    <Chip
      active={active}
      onClick={onClick}
      title={title}
      className={portrait ? 'p-0.5' : 'px-1.5'}
    >
      {portrait ? (
        <img
          src={avatarImg(portrait)}
          alt=""
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={active && ringColor ? { boxShadow: `0 0 0 1.5px ${ringColor}` } : undefined}
          className="h-5 w-5 rounded object-cover"
        />
      ) : children}
    </Chip>
  );
}

/** A kind chip: the same colour the card's own rail uses. */
function KindChip({ active, onClick, title, color, children }) {
  return (
    <Chip active={active} onClick={onClick} title={title} color={color} className="px-1.5">
      {children}
    </Chip>
  );
}

/**
 * THE KIND GLYPHS, drawn inline.
 *
 * The pool has no per-kind icon FILES -- a weapon chip's glyph would have to be one
 * particular sword, which says less than a silhouette does -- so these are small SVG
 * marks in the kind's own colour, matching the rail colour on the cards below them.
 */
function KindGlyph({ k }) {
  const c = 'currentColor';
  const common = { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (k) {
    // 天赋 -- a spark, the mark the cards already use for a passive.
    case 'talent':
      return (
        <svg {...common}><path d="M8 2v12M2 8h12M3.9 3.9l8.2 8.2M12.1 3.9l-8.2 8.2" /></svg>
      );
    // 命座 -- a six-pointed star, as the constellation cards show.
    case 'constellation':
      return (
        <svg {...common}><path d="M8 2l1.8 4.2L14 8l-4.2 1.8L8 14l-1.8-4.2L2 8l4.2-1.8z" /></svg>
      );
    // 武器 -- a sword.
    case 'weapon':
      return (
        <svg {...common}><path d="M8 14V6M8 2l2.5 4h-5zM5.5 12h5" /></svg>
      );
    // 圣遗物 2 件套 -- a single ring, "one of the two".
    case 'artifact2':
      return (
        <svg {...common}><circle cx="8" cy="8" r="5" /><circle cx="8" cy="8" r="1.6" fill={c} stroke="none" /></svg>
      );
    // 圣遗物 4 件套 -- a ring with four pips, "all of them".
    case 'artifact4':
      return (
        <svg {...common}><circle cx="8" cy="8" r="5" /><circle cx="8" cy="3" r="1.1" fill={c} stroke="none" /><circle cx="13" cy="8" r="1.1" fill={c} stroke="none" /><circle cx="8" cy="13" r="1.1" fill={c} stroke="none" /><circle cx="3" cy="8" r="1.1" fill={c} stroke="none" /></svg>
      );
    default:
      return null;
  }
}

/** 模板 -- a card and its copy, which is what dragging one produces. */
function TemplateGlyph() {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg {...common}>
      <rect x="5.5" y="2.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 13.5h-7a1.5 1.5 0 01-1.5-1.5v-7" />
    </svg>
  );
}

/** 实例 -- one definition linked to many rows, which is what binding does. */
function InstanceGlyph() {
  const common = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg {...common}>
      <circle cx="8" cy="3" r="1.6" />
      <circle cx="3.5" cy="12.5" r="1.6" />
      <circle cx="12.5" cy="12.5" r="1.6" />
      <path d="M7.2 4.4L4.3 11.1M8.8 4.4l2.9 6.7M5.1 12.5h5.8" />
    </svg>
  );
}

/** The binding mark, for the row that says how many entries carry an instance. */
function LinkGlyph() {
  const common = { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <svg {...common}>
      <path d="M6.6 9.4l2.8-2.8" />
      <path d="M9.2 4.6l1.1-1.1a2.3 2.3 0 013.2 3.2l-1.1 1.1" />
      <path d="M6.8 11.4l-1.1 1.1a2.3 2.3 0 01-3.2-3.2l1.1-1.1" />
    </svg>
  );
}
