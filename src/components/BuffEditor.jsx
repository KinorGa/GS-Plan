// The buff editor: review and fill in what every source in the game grants.
//
// WHY A SEPARATE PAGE
//   Upstream publishes a prose description per source and no stat table (see
//   `lib/buff-library.js`), so every number here is a human's transcription.
//   2060 sources exist; filling them in is a different activity from planning a
//   rotation, and it needs a screen of its own rather than a panel beside the
//   damage axis.
//
// THE ROWS ARE THE PROJECT'S OWN `BuffCard`
//   Not a bespoke list row. This page and the planner's pool are showing the
//   SAME thing -- a source and the buffs it grants -- so they use one component,
//   and a fix to the card fixes both. An earlier version of this page drew its
//   own flat row, which meant two renderings of one concept and two places to
//   keep in step.
//
//   `BuffCard` already carries the editable path (key / value / tag, add,
//   remove), so `editable` plus `onBuffsChange` is the whole integration.
//
// THE DESCRIPTION IS SHOWN ABOVE THE CARD WHEN OPEN
//   The numbers are transcribed FROM the description, so it cannot be hidden
//   behind a tooltip. It sits under the card, which is where the eye already is.

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import {
  buffsFor, libraryStats, loadLibrary, loadSourceIndex, parseLibrary,
  saveLibrary, serialiseLibrary, setBuffs,
} from '../lib/buff-library';
import { loadFlags, saveFlags, withFlag, flagOf, flagCounts } from '../lib/buff-flags';
import { noteChange } from '../lib/data-file';
import BuffCard from './BuffCard';

/** How many rows to render at once. See the note at the list. */
const PAGE = 120;

/** Load the index once, with a retry a user can press. */
function useSourceIndex(lang) {
  const [state, setState] = useState({ index: null, error: null, attempt: 0 });
  useEffect(() => {
    let alive = true;
    loadSourceIndex(lang)
      .then((index) => alive && setState((s) => ({ ...s, index, error: null })))
      .catch((e) => alive && setState((s) => ({ ...s, error: e.message })));
    return () => { alive = false; };
  }, [lang, state.attempt]);
  return { ...state, retry: () => setState((s) => ({ index: null, error: null, attempt: s.attempt + 1 })) };
}

const KIND_LABEL = {
  weapon: { chs: '武器', en: 'Weapon' },
  artifact: { chs: '圣遗物', en: 'Artifact' },
  talent: { chs: '天赋', en: 'Talent' },
  constellation: { chs: '命座', en: 'Constellation' },
};

export default function BuffEditor() {
  const { lang, L } = useI18n();
  const { index, error, retry } = useSourceIndex(lang);

  const [library, setLibrary] = useState(() => loadLibrary());
  const [q, setQ] = useState('');
  const [kind, setKind] = useState(null);
  const [owner, setOwner] = useState(null);
  const [onlyEdited, setOnlyEdited] = useState(false);
  // Which flag state the list is filtered to, or `null` for "show everything".
  //
  // THE DEFAULT IS null, and it must be: a source nobody has marked is far more
  // likely to be an unfilled buff than one to hide, so the list starts complete and
  // the user narrows it deliberately.
  const [flagFilter, setFlagFilter] = useState(null);
  const [flags, setFlags] = useState(() => loadFlags());
  const [shown, setShown] = useState(PAGE);

  /**
   * Save to the cache AND hand the change to the durable file.
   *
   * `saveLibrary` writes `localStorage` synchronously, which is what keeps typing
   * responsive; `noteChange` queues the file write behind a short debounce. Both are
   * needed -- one is the working copy, the other survives a cleared cache.
   */
  const update = (key, buffs) => setLibrary((lib) => {
    const next = saveLibrary(setBuffs(lib, key, buffs));
    noteChange('library', next);
    return next;
  });

  /**
   * Remember whether a source is a buff.
   *
   * The change is applied to the whole set and saved at once, so a page holding
   * thousands of rows does not touch storage per keystroke.
   */
  const setFlag = (key, state) => setFlags((f) => {
    const next = saveFlags(withFlag(f, key, state));
    noteChange('flags', next);
    return next;
  });

  // `index` is null while loading, so every derivation tolerates it.
  const rows = useMemo(() => {
    if (!index) return [];
    const needle = q.trim().toLowerCase();
    return index.filter((s) => {
      if (kind && s.kind !== kind) return false;
      if (owner && s.owner?.id !== owner) return false;
      if (onlyEdited && !buffsFor(library, s.key).length) return false;
      // THE FILTER IS OPT-IN, so `null` shows everything. Only an explicit choice
      // narrows the list -- a default that hid unmarked rows would hide the
      // unfilled buffs along with the non-buffs.
      if (flagFilter && flagOf(flags, s.key) !== flagFilter) return false;
      if (!needle) return true;
      return [s.name?.chs, s.name?.en, s.owner?.name, s.key]
        .filter(Boolean)
        .some((t) => String(t).toLowerCase().includes(needle));
    });
  }, [index, q, kind, owner, onlyEdited, library, flagFilter, flags]);

  /**
   * How many sources are in each flag state, for the filter chips.
   *
   * Counted over the WHOLE index rather than the filtered rows, so a chip's number
   * does not change as another filter narrows the list -- a count that moved while
   * you were reading it would be worse than no count.
   */
  const flagTotal = useMemo(
    () => flagCounts(flags, (index || []).map((s) => s.key)),
    [flags, index]
  );

  /**
   * The rows grouped by SOURCE, with a weapon's five refinements together.
   *
   * The index holds one entry per weapon per refinement -- R1 and R5 grant
   * different numbers, so they are different things to fill in. Listing them as
   * five independent rows would show the same weapon five times in a row and
   * make "which refinement am I editing" depend on reading a small chip.
   *
   * Grouping gives one row per weapon whose editor has R1..R5 tabs, which is how
   * the numbers are actually read off a weapon's description.
   */
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of rows) {
      // Everything but a weapon groups by its own key -- it has one variant.
      const groupKey = s.kind === 'weapon' ? `weapon:${s.id}` : s.key;
      if (!map.has(groupKey)) map.set(groupKey, []);
      map.get(groupKey).push(s);
    }
    // A weapon's variants are sorted R1..R5 so the tabs read in order.
    for (const list of map.values()) {
      if (list.length > 1) list.sort((a, b) => (a.refine || 0) - (b.refine || 0));
    }
    return [...map.values()];
  }, [rows]);

  // A filter change must reset the page window, or switching to a small result
  // set would leave the window past the end and show nothing.
  useEffect(() => { setShown(PAGE); }, [q, kind, owner, onlyEdited, flagFilter]);

  // Only characters that actually have sources, so the dropdown is not 136
  // entries of which 100 lead to a single row.
  const owners = useMemo(() => {
    const map = new Map();
    for (const s of index || []) {
      if (!s.owner) continue;
      if (!map.has(s.owner.id)) map.set(s.owner.id, s.owner);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [index]);

  const stats = libraryStats(library);

  const exportLibrary = () => {
    const blob = new Blob([serialiseLibrary(library)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `buff-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importLibrary = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setLibrary(saveLibrary(parseLibrary(await file.text())));
    } catch (err) {
      alert(`${L({ chs: '导入失败', en: 'Import failed' })}: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-background px-5 py-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-sm font-medium tracking-wide text-muted-foreground">
              {L({ chs: '增益库 · 人工审查与填写', en: 'Buff Library — Review & Edit' })}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground/70">
              {L({
                chs: '官方数据只有文字描述，没有数值表。下面列出全游戏所有可能的增益来源，点开卡片对照描述填写；填好的值会被配队页自动使用。',
                en: 'Upstream publishes descriptions, not stat tables. Every source in the game is listed below — open a card and fill it in; the planner picks the values up automatically.',
              })}
            </p>
          </div>
          {/* 增益库 and 伤害源审核 are siblings -- both are "the game published
              prose, a human entered the numbers" -- so each links to the other
              rather than making you go via the planner to switch between them. */}
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/stats.html"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {L({ chs: '数值来源', en: 'Stat sources' })}
            </a>
            <a
              href="/audit.html"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {L({ chs: '伤害源审核', en: 'Damage sources' })}
            </a>
            <a
              href="/planner.html"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {L({ chs: '返回配队', en: 'Back to planner' })}
            </a>
          </div>
        </div>

        {/* --------------------------------------------------------- toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L({ chs: '搜索名称、角色或 id…', en: 'Search name, owner or id…' })}
            className="w-[240px] rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"
          />

          <div className="flex items-center gap-1">
            <FilterChip active={kind === null} onClick={() => setKind(null)}>
              {L({ chs: '全部', en: 'All' })}
            </FilterChip>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(k)}>
                {L(label)}
              </FilterChip>
            ))}
          </div>

          <select
            value={owner || ''}
            onChange={(e) => setOwner(e.target.value || null)}
            className="cursor-pointer rounded-lg border border-white/10 bg-[#141418] px-2 py-1.5 text-[11px] text-white/80 outline-none"
          >
            <option value="">{L({ chs: '全部角色', en: 'All characters' })}</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>

          <FilterChip active={onlyEdited} onClick={() => setOnlyEdited((v) => !v)}>
            {L({ chs: '只看已填写', en: 'Edited only' })}
          </FilterChip>

          {/*
            IS IT A BUFF AT ALL.

            Most of the index is not: 神里流·冰华 and 天目影打刀 are skill descriptions
            with nothing to fill in, and the generated data cannot tell them from a
            talent nobody has got to yet -- both have zero buffs. So the answer is the
            user's, and this is where they give it.

            THE COUNTS ARE THE POINT of showing these as chips rather than a dropdown:
            "867 buff / 2221 unmarked" is the state of the transcription, and it is the
            number that tells you how much is left.

            `全部` is the default and hides nothing. `不是增益` is a FILTER, not a
            delete -- every row stays in this list whichever chip is active, because a
            mistyped mark must always be findable to undo. Only the POOL excludes them.
          */}
          <div className="flex items-center gap-1">
            <FilterChip active={flagFilter === null} onClick={() => setFlagFilter(null)}>
              {L({ chs: '全部', en: 'All' })}
            </FilterChip>
            <FilterChip active={flagFilter === 'buff'} onClick={() => setFlagFilter('buff')}>
              {L({ chs: '是增益', en: 'Is buff' })} {flagTotal.buff}
            </FilterChip>
            <FilterChip active={flagFilter === 'not-buff'} onClick={() => setFlagFilter('not-buff')}>
              {L({ chs: '不是增益', en: 'Not buff' })} {flagTotal['not-buff']}
            </FilterChip>
            <FilterChip active={flagFilter === 'unmarked'} onClick={() => setFlagFilter('unmarked')}>
              {L({ chs: '未标注', en: 'Unmarked' })} {flagTotal.unmarked}
            </FilterChip>
          </div>

          <span className="ml-auto text-[11px] text-white/35">
            {rows.length} / {index?.length ?? '…'} {L({ chs: '条', en: 'rows' })}
            {' · '}
            {stats.sources} {L({ chs: '个来源已填', en: 'filled' })}
            {' · '}
            {stats.buffs} {L({ chs: '条增益', en: 'buffs' })}
          </span>

          <button
            type="button"
            onClick={exportLibrary}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/30 hover:text-white"
          >
            {L({ chs: '导出', en: 'Export' })}
          </button>
          <button
            type="button"
            onClick={() => document.getElementById('lib-file')?.click()}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-white/55 transition-colors hover:border-white/30 hover:text-white"
          >
            {L({ chs: '导入', en: 'Import' })}
          </button>
          <input
            id="lib-file"
            type="file"
            accept="application/json,.json"
            onChange={importLibrary}
            className="hidden"
          />
        </div>

        {error && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 py-8">
            <p className="text-xs text-red-400">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg border border-white/15 px-3 py-1 text-[11px] text-white/60 hover:border-white/35 hover:text-white"
            >
              {L({ chs: '重试', en: 'Retry' })}
            </button>
          </div>
        )}

        {!index && !error && (
          <p className="py-10 text-center text-xs text-white/35">
            {L({ chs: '正在建立全量索引…', en: 'Building the full index…' })}
          </p>
        )}

        {/* ------------------------------------------------------------ list */}
        {/* Two columns of cards on a wide screen: the card is a fixed 260px, and
            one per row wasted most of a 1200px page. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.slice(0, shown).map((variants) => (
            <EditorCard
              key={variants[0].key}
              variants={variants}
              library={library}
              onChange={update}
              flags={flags}
              setFlag={setFlag}
            />
          ))}
        </div>

        {groups.length > shown && (
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className="self-center rounded-lg border border-white/15 px-4 py-2 text-[11px] text-white/60 transition-colors hover:border-white/35 hover:text-white"
          >
            {L({
              chs: `显示更多（已显示 ${shown} / ${groups.length}）`,
              en: `Show more (${shown} of ${groups.length})`,
            })}
          </button>
        )}

        {index && !rows.length && (
          <p className="py-10 text-center text-xs text-white/30">
            {L({ chs: '没有匹配的来源', en: 'No sources match' })}
          </p>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border px-2 py-1 text-[11px] transition-colors ${
        active ? 'border-white/40 text-white' : 'border-white/10 text-white/40 hover:border-white/25'
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- card */

/**
 * One source, as the project's own `BuffCard` plus its description.
 *
 * The card is the same component the planner's pool renders, so a source looks
 * identical in both places. `className` overrides its default 260px width so it
 * fills the grid cell.
 *
 * `variants` is the source at each of its ranks. Almost every kind has exactly
 * one; a weapon has five (R1..R5), because its passive grants different numbers
 * at each refinement and each is a separate thing to fill in. They share one card
 * with rank tabs rather than five rows, so the page does not show one weapon five
 * times over.
 */
function EditorCard({ variants, library, onChange, flags, setFlag }) {
  const { L } = useI18n();
  const [rank, setRank] = useState(0);

  // A weapon's five variants are R1..R5 in order; anything else has one, so the
  // index is always 0 for it.
  const source = variants[Math.min(rank, variants.length - 1)];
  const buffs = buffsFor(library, source.key);
  const multi = variants.length > 1;

  // "Filled" is a property of the whole source, not the displayed refinement: a
  // weapon with R1 recorded and R4 empty should not read as complete.
  const filledRanks = variants.filter((v) => buffsFor(library, v.key).length).length;
  const empty = filledRanks === 0;

  return (
    <div data-source-card={source.key} data-source-group={variants[0].key} className="flex flex-col gap-1.5">
      {multi && (
        <div data-rank-tabs className="flex items-center gap-1">
          {variants.map((v, i) => {
            const on = i === Math.min(rank, variants.length - 1);
            const has = buffsFor(library, v.key).length > 0;
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setRank(i)}
                aria-pressed={on}
                title={v.key}
                className={`flex-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  on
                    ? 'border-[#7fd4c1]/60 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                    : 'border-white/10 text-white/35 hover:border-white/25'
                }`}
              >
                R{v.refine}
                {/* A dot marks a refinement that already has numbers, so the
                    ones still to do are visible without opening each tab. */}
                {has && <span className="ml-1 text-[8px] text-[#7fd4c1]">●</span>}
              </button>
            );
          })}
        </div>
      )}

      <BuffCard
        source={{
          // The library's `source` shape differs from a unit's in one way: a
          // library entry belongs to the GAME, not to a character, so a weapon
          // has no `owner`. BuffCard tolerates that (it only renders the owner
          // line when present).
          kind: source.kind,
          icon: source.icon,
          iconKind: source.iconKind,
          rank: source.rank,
          name: source.name,
          owner: source.owner,
        }}
        buffs={buffs}
        editable
        onBuffsChange={(next) => onChange(source.key, next)}
        className="w-full"
      />

      {/* The description the numbers are transcribed FROM, so it cannot be
          hidden behind a tooltip. */}
      <details className="group/desc rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] text-white/35 transition-colors hover:text-white/60">
          <span className="flex-1">
            {L(KIND_LABEL[source.kind] || { chs: source.kind, en: source.kind })}
            {source.owner ? ` · ${source.owner.name}` : ''}
          </span>
          {/* The badge is why this page exists: an empty source is one nobody has
              transcribed yet, and that has to be visible without opening it.
              A multi-rank source counts how many of its ranks are done. */}
          <span className={empty ? 'text-white/25' : 'text-[#7fd4c1]'}>
            {multi
              ? `${filledRanks}/${variants.length}`
              : empty ? L({ chs: '未填写', en: 'empty' }) : `${buffs.length} ${L({ chs: '条', en: 'buffs' })}`}
          </span>

          {/*
            IS THIS A BUFF. Two buttons rather than one toggle, so the marked state is
            readable at a glance -- a single control that cycles through three values
            cannot show which one it is on without a label that changes size.

            THEY LIVE ON THIS LINE, which is the library's own chrome, and NOT inside
            `BuffCard`. The card is shared with the pool and the planner, where "is
            this a buff" is not a question anyone is asking; a control added there
            would appear in all three.

            CLICKING THE ACTIVE ONE CLEARS IT, so all three states are reachable
            without a third button: nothing -> buff -> nothing, and nothing ->
            not-buff -> nothing. `stopPropagation` because this row is a `<summary>`
            and a click anywhere else on it opens the description.

            THEY MARK, THEY DO NOT HIDE. Every row stays in this list at every
            setting, which is what makes a mistyped mark recoverable -- see the note
            in `lib/buff-flags.js`. */}
          {(() => {
            const state = flagOf(flags, source.key);
            const btn = 'rounded px-1.5 py-0.5 text-[10px] transition-colors';
            return (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  data-flag="buff"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFlag(source.key, state === 'buff' ? 'unmarked' : 'buff'); }}
                  title={L({ chs: '标记为增益（进入增益池）', en: 'Mark as a buff (shown in the pool)' })}
                  className={`${btn} ${state === 'buff'
                    ? 'bg-[#7fd4c1]/20 text-[#7fd4c1]'
                    : 'text-white/25 hover:text-white/60'}`}
                >
                  ✓ {L({ chs: '是增益', en: 'buff' })}
                </button>
                <button
                  type="button"
                  data-flag="not-buff"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFlag(source.key, state === 'not-buff' ? 'unmarked' : 'not-buff'); }}
                  title={L({ chs: '标记为不是增益（不进入增益池，本页仍会显示）', en: 'Not a buff (kept out of the pool; still listed here)' })}
                  className={`${btn} ${state === 'not-buff'
                    ? 'bg-red-400/20 text-red-300'
                    : 'text-white/25 hover:text-white/60'}`}
                >
                  ✕ {L({ chs: '不是', en: 'not' })}
                </button>
              </span>
            );
          })()}
          <span className="text-white/25 group-open/desc:hidden">▸</span>
        </summary>
        {source.desc ? (
          <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed text-white/45">
            {source.desc}
          </p>
        ) : (
          <p className="mt-1.5 text-[10px] text-white/25">
            {L({ chs: '该来源官方没有描述文本', en: 'No upstream description for this source' })}
          </p>
        )}
        <p className="mt-1 truncate text-[9px] text-white/20" title={source.key}>{source.key}</p>
      </details>
    </div>
  );
}
