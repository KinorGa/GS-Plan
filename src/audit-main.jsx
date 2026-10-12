// The review page for `public/data/talent-damage.json`.
//
// WHY THIS EXISTS
//
// Deciding whether a constellation or passive deals damage of its own is a
// JUDGEMENT, and the generator that drafts it is right most of the time but not
// always -- it cannot tell `造成的伤害提高：防御力的156%` (a buff) from
// `造成相当于生命值上限30%的水元素伤害` (a hit) by rule alone. Rather than encode
// an ever-longer list of exceptions, the draft is REVIEWED here once and the
// result is saved back to the data file.
//
// So this page is the correction step, and it shows EVERY slot the dataset has --
// including the ones the generator is confident are not hits. A curated list is
// only trustworthy if a person can see the decision that was made; an entry that
// is simply absent cannot be audited, and "considered and rejected" would be
// indistinguishable from "never looked at".
//
// This file is PRESENTATION ONLY. Loading, joining and filtering live in
// `lib/use-review-data.js`, so the table below is not buried under four hundred
// lines of data plumbing.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, useI18n } from './i18n';
import { avatarImg, talentIconImg } from './game';
import { DAMAGE_TYPE_OPTIONS, ElementPicker } from './components/ElementGlyph';
import { useReviewData, verdictOf } from './lib/use-review-data';
import './index.css';

/**
 * The facet options.
 *
 * Elements are the CHARACTER's, so only the seven real ones -- `Physical` is a
 * damage type, never a character's element, and `Unknown` (3 unreleased entries)
 * is not a filter anyone wants. Rarity is 5/4 because that is how the game is
 * discussed; the stored `qualityType` spells it `QUALITY_ORANGE`/`_PURPLE`, and
 * its `_SP` variant is still a five-star.
 */
const ELEMENT_FACETS = DAMAGE_TYPE_OPTIONS.filter(([k]) => k !== 'Physical').map(([k, label]) => ({
  value: k,
  label,
}));

const RARITY_FACETS = [
  { value: 5, label: { chs: '五星', en: '5-star' } },
  { value: 4, label: { chs: '四星', en: '4-star' } },
];

const WEAPON_FACETS = [
  ['WEAPON_SWORD_ONE_HAND', { chs: '单手剑', en: 'Sword' }],
  ['WEAPON_CLAYMORE', { chs: '双手剑', en: 'Claymore' }],
  ['WEAPON_POLE', { chs: '长柄武器', en: 'Polearm' }],
  ['WEAPON_BOW', { chs: '弓', en: 'Bow' }],
  ['WEAPON_CATALYST', { chs: '法器', en: 'Catalyst' }],
].map(([value, label]) => ({ value, label }));

const VERDICT_STYLE = {
  on: 'border-[#7fd4c1]/45 bg-[#7fd4c1]/[0.07]',
  review: 'border-amber-400/40 bg-amber-400/[0.05]',
  off: 'border-white/10 bg-white/[0.02]',
  no: 'border-white/[0.06] bg-white/[0.01]',
};

const FILTERS = [
  ['all', { chs: '全部', en: 'All' }],
  ['on', { chs: '已启用', en: 'Enabled' }],
  ['review', { chs: '待人工审', en: 'Needs review' }],
  ['off', { chs: '已判定非伤害', en: 'Ruled out' }],
];

/** One row of facet chips: a label and a set of single-choice toggles. */
function FacetGroup({ label, value, onChange, options, L }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-white/30">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={String(o.value)}
              onClick={() => onChange(on ? '' : o.value)}
              data-facet={`${label}-${o.value}`}
              className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                on
                  ? 'border-[#7fd4c1]/60 bg-[#7fd4c1]/15 text-[#7fd4c1]'
                  : 'border-white/[0.12] text-white/45 hover:border-white/30 hover:text-white'
              }`}
            >
              {L(o.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A navigation link, matching the ones 增益库 already uses. */
function NavLink({ href, children, ...rest }) {
  return (
    <a
      href={href}
      {...rest}
      className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/30 hover:text-white"
    >
      {children}
    </a>
  );
}

/**
 * Where to go from here.
 *
 * `增益库` and this page are siblings -- both are "the game published prose, a
 * human entered the numbers" -- so each links to the other rather than making you
 * go via the planner to switch between them.
 *
 * The planner link is not optional: this page is a full navigation away from it,
 * and the browser's Back button is not an answer, because arriving here from a
 * link does not guarantee a history entry and a reviewer following a bookmark has
 * none at all.
 */
function NavLinks({ L, backAttr = false }) {
  return (
    <>
      <NavLink href="/planner.html" {...(backAttr ? { 'data-back-to-planner': true } : {})}>
        ← {L({ chs: '返回配队', en: 'Back to planner' })}
      </NavLink>
      <NavLink href="/buffs.html">{L({ chs: '增益库', en: 'Buff library' })}</NavLink>
      {/* The third curation page: the stat factors everything else is computed
          from. Linked here so the reviewer can check a number without going back
          to the planner first. See src/stats-main.jsx. */}
      <NavLink href="/stats.html">{L({ chs: '数值来源', en: 'Stat sources' })}</NavLink>
    </>
  );
}

function ReviewPage() {
  const { lang, L, setLang } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [charId, setCharId] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [facetElement, setFacetElement] = useState('');
  const [facetRarity, setFacetRarity] = useState('');
  const [facetWeapon, setFacetWeapon] = useState('');
  const [openId, setOpenId] = useState(null);
  const [dirty, setDirty] = useState(false);

  const { doc, err, names, counts, visible, pickerChars, patch: patchRow } =
    useReviewData({ q, filter, charId, onlyPending, facetElement, facetRarity, facetWeapon });

  const patch = (id, slot, changes) => {
    patchRow(id, slot, changes);
    setDirty(true);
  };

  const hasFacets = Boolean(facetElement || facetRarity || facetWeapon);
  const clearFacets = () => { setFacetElement(''); setFacetRarity(''); setFacetWeapon(''); };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'talent-damage.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setDirty(false);
  };

  // The error and loading branches also carry the way back: a failure is exactly
  // when a dead end is most annoying.
  if (err || !doc) {
    return (
      <div className="flex flex-col items-start gap-3 p-8 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <NavLinks L={L} backAttr />
        </div>
        <p className={err ? 'text-red-300' : 'text-white/50'}>
          {err
            ? `${L({ chs: '读不到 talent-damage.json：', en: 'Could not read talent-damage.json: ' })}${err}`
            : L({ chs: '载入中…', en: 'Loading…' })}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] p-6 text-white">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <NavLinks L={L} backAttr />
        <h1 className="text-lg font-semibold">
          {L({ chs: '天赋 / 命座 伤害源审核', en: 'Talent & constellation damage sources' })}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-300">
              {L({ chs: '有未导出的改动', en: 'unsaved changes' })}
            </span>
          )}
          <button
            onClick={exportJson}
            className="rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/10 px-3 py-1.5 text-[11px] font-medium text-[#7fd4c1] transition-colors hover:bg-[#7fd4c1]/20"
          >
            {L({ chs: '导出 talent-damage.json', en: 'Export talent-damage.json' })}
          </button>
          <button
            onClick={() => setLang(lang === 'chs' ? 'en' : 'chs')}
            className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 transition-colors hover:text-white"
          >
            {lang === 'chs' ? 'EN' : '中文'}
          </button>
        </div>
      </header>

      {/* The counts, as counters rather than a sentence -- they are what tells you
          whether the review is finished. */}
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        {[
          [counts.chars, { chs: '角色', en: 'characters' }, 'text-white/70'],
          [counts.total, { chs: '全部条目（数据集里每一条）', en: 'every slot in the dataset' }, 'text-white/50'],
          [counts.on, { chs: '已启用', en: 'enabled' }, 'text-[#7fd4c1]'],
          [counts.review, { chs: '待人工审', en: 'needs review' }, 'text-amber-300'],
        ].map(([n, label, cls], i) => (
          <span key={i} className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1">
            <b className={`tabular-nums ${cls}`}>{n}</b> <span className="text-white/35">{L(label)}</span>
          </span>
        ))}
      </div>

      <p className="mb-4 max-w-[1000px] text-[11px] leading-relaxed text-white/40">
        {L({
          chs: '这里的判定就是卡片的判定。勾上并填好倍率后导出，用它覆盖 public/data/talent-damage.json 即可生效。倍率填百分数（800 就是 800%）。未勾选的条目不会出现在攻击段菜单里。',
          en: 'This IS what the card reads. Tick a row, set its multiplier, export, and overwrite public/data/talent-damage.json. Enter the multiplier as a percent (800 = 800%). Unticked rows never appear in the stage menu.',
        })}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={L({ chs: '搜索角色 / 名称 / 描述…', en: 'Search character / name / text…' })}
          className="w-[300px] rounded-lg border border-white/15 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white placeholder:text-white/30"
        />
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
              filter === k
                ? 'border-[#7fd4c1]/60 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                : 'border-white/15 text-white/50 hover:text-white'
            }`}
          >
            {L(label)}
          </button>
        ))}
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/50 transition-colors hover:text-white">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-400"
            data-only-pending
          />
          {L({ chs: '只看待审角色', en: 'only characters with reviews' })}
        </label>
        <span className="text-[11px] text-white/35">
          {L({ chs: '显示', en: 'showing' })} <b className="tabular-nums text-white/60">{visible.length}</b>
        </span>
      </div>

      <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FacetGroup label={L({ chs: '元素', en: 'Element' })} value={facetElement} onChange={setFacetElement} options={ELEMENT_FACETS} L={L} />
          <FacetGroup label={L({ chs: '星级', en: 'Rarity' })} value={facetRarity} onChange={setFacetRarity} options={RARITY_FACETS} L={L} />
          <FacetGroup label={L({ chs: '武器', en: 'Weapon' })} value={facetWeapon} onChange={setFacetWeapon} options={WEAPON_FACETS} L={L} />
          {hasFacets && (
            <button
              onClick={clearFacets}
              data-clear-facets
              className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/50 transition-colors hover:text-white"
            >
              {L({ chs: '清除筛选', en: 'clear filters' })}
            </button>
          )}
        </div>
      </div>

      {/* THE CHARACTER RAIL.
          It replaces a native <select> of 138 ids, which was the wrong control
          three ways: it could not be searched, it showed no progress, and it was
          ordered by numeric id -- a value with no meaning to a player. It is a
          strip of portraits ordered by OUTSTANDING WORK, each carrying its pending
          count, so it answers "who still needs me" rather than "who exists". */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/35">
            {L({ chs: '角色（按待审数量排序）', en: 'Characters (most pending first)' })}
          </span>
          <span className="text-[10px] tabular-nums text-white/25">
            {pickerChars.length}/{counts.chars}
          </span>
          {charId && (
            <button
              onClick={() => setCharId('')}
              className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50 hover:text-white"
            >
              {L({ chs: '清除选择', en: 'clear' })}
            </button>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1.5">
          <button
            onClick={() => setCharId('')}
            className={`flex h-[52px] w-[58px] shrink-0 flex-col items-center justify-center rounded-lg border text-[10px] transition-colors ${
              charId === ''
                ? 'border-[#7fd4c1]/60 bg-[#7fd4c1]/10 text-[#7fd4c1]'
                : 'border-white/10 text-white/45 hover:border-white/25'
            }`}
          >
            <span className="text-[13px] font-semibold text-white/80">{counts.chars}</span>
            {L({ chs: '全部', en: 'All' })}
          </button>
          {pickerChars.map((c) => (
            <CharTile key={c.id} c={c} selected={charId === c.id} L={L} onClick={() => setCharId(charId === c.id ? '' : c.id)} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {visible.map((r) => (
          <Row
            key={`${r.id}-${r.slot}`}
            row={r}
            charName={names[r.id] || r.id}
            L={L}
            open={openId === `${r.id}-${r.slot}`}
            onToggleText={() => setOpenId((v) => (v === `${r.id}-${r.slot}` ? null : `${r.id}-${r.slot}`))}
            onPatch={(changes) => patch(r.id, r.slot, changes)}
          />
        ))}
        {!visible.length && (
          <p className="p-6 text-center text-xs text-white/30">{L({ chs: '没有符合条件的条目', en: 'Nothing matches' })}</p>
        )}
      </div>
    </div>
  );
}

/** One portrait in the rail, with its pending count or a finished tick. */
function CharTile({ c, selected, L, onClick }) {
  const pending = c.review > 0;
  return (
    <button
      onClick={onClick}
      data-char-tile={c.id}
      title={`${c.name} · ${L({ chs: `${c.on} 启用 / ${c.review} 待审`, en: `${c.on} on / ${c.review} to review` })}`}
      className={`relative flex h-[52px] w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border transition-colors ${
        selected
          ? 'border-[#7fd4c1]/70 bg-[#7fd4c1]/10'
          : pending
            ? 'border-amber-400/25 hover:border-amber-400/60'
            : 'border-white/[0.07] opacity-50 hover:opacity-90'
      }`}
    >
      <img
        src={avatarImg(c.id)}
        alt=""
        className="h-7 w-7 rounded object-cover"
        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
      />
      {/* The pending count, so the rail reads as a to-do list. A tile with nothing
          left to review is dimmed and ticked instead of badge-less, which is what
          lets the eye skip the finished ones. */}
      {pending ? (
        <span className="absolute right-0.5 top-0.5 rounded bg-amber-400/90 px-1 text-[9px] font-semibold tabular-nums text-black">
          {c.review}
        </span>
      ) : (
        <span className="absolute right-0.5 top-0.5 text-[9px] text-[#7fd4c1]">✓</span>
      )}
      <span className="max-w-full truncate px-0.5 text-[9px] leading-none text-white/60">{c.name}</span>
    </button>
  );
}

/** One talent/constellation row. */
function Row({ row, charName, L, open, onToggleText, onPatch }) {
  const v = verdictOf(row);
  const on = row.damage === true;
  const isConst = row.kind === 'constellation';

  return (
    <div className={`rounded-xl border p-2.5 transition-colors ${VERDICT_STYLE[v]}`} data-talent-row={`${row.id}-${row.slot}`}>
      <div className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onPatch({ damage: e.target.checked })}
          className="h-4 w-4 shrink-0 accent-[#7fd4c1]"
          data-talent-toggle
        />

        {/* The game's own portrait and talent icon, so a row is recognisable at a
            glance instead of being a line of text. A missing image hides itself
            rather than leaving a broken frame. */}
        <img
          src={avatarImg(row.id)}
          alt=""
          className="h-9 w-9 shrink-0 rounded-lg border border-white/10 object-cover"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        />
        {row.icon && (
          <img
            src={talentIconImg(row.icon)}
            alt=""
            className="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-white/[0.03] object-contain p-1"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        )}

        <span className="w-[86px] shrink-0 truncate text-[11px] text-white/60">{charName}</span>

        <span
          className={`w-[64px] shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${
            isConst ? 'bg-amber-400/15 text-amber-300' : 'bg-sky-400/15 text-sky-300'
          }`}
        >
          {isConst ? `C${row.slot.slice(5)}` : `P${row.slot.slice(1)}`}
        </span>

        <span className="min-w-0 flex-1 truncate text-xs text-white/85">{row.name || '—'}</span>

        {/* `showLabel` off: this table has a header's worth of rows, and "元素" on
            every line is noise. */}
        <span className="shrink-0">
          <ElementPicker
            value={row.element || ''}
            onChange={(el) => onPatch({ element: el || null })}
            L={L}
            showLabel={false}
          />
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          <input
            type="number"
            step="0.01"
            value={row.mult == null ? '' : Number((row.mult * 100).toFixed(4))}
            placeholder="%"
            disabled={!on}
            onChange={(e) => {
              const t = e.target.value.trim();
              onPatch({ mult: t === '' ? null : Number(t) / 100 });
            }}
            className="w-[88px] shrink-0 rounded-md border border-white/15 bg-white/[0.03] px-2 py-1 text-right text-[11px] tabular-nums text-white disabled:opacity-25"
            data-talent-mult
          />
          <span className="w-[52px] shrink-0 truncate text-[10px] text-white/35">{row.basis || '—'}</span>
        </div>

        {v === 'review' && (
          <span className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] text-amber-300">
            {L({ chs: '待确认', en: 'review' })}
          </span>
        )}
        {v === 'no' && (
          <span className="w-[46px] shrink-0 text-center text-[9px] text-white/20">{L({ chs: '非候选', en: 'n/a' })}</span>
        )}

        <button
          onClick={onToggleText}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-white/35 transition-colors hover:text-white"
        >
          {open ? '▲' : '▼'}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg bg-black/40 p-2.5">
          {row.reason && (
            <p className="mb-1.5 text-[10px] text-amber-300/70">
              {L({ chs: '判定依据：', en: 'verdict: ' })}{row.reason}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-white/50">
            {row.text || L({ chs: '（无描述）', en: '(no description)' })}
          </p>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <I18nProvider>
    <ReviewPage />
  </I18nProvider>
);
