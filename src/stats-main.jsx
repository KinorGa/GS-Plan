// The stats page: a character's or a weapon's numbers, one row per level.
//
// WHY THIS EXISTS
//   Everything downstream of the panel -- a damage entry, a `$总攻击力` in a buff
//   formula -- is computed from `base * curve(level) + ascension(phase)`, and that
//   is a formula over a table nobody can see. This page opens the table: pick a
//   character or a weapon and every level it can reach is listed with the numbers
//   the app will actually use.
//
// THE COMPARISON COLUMNS ARE THE POINT
//   Beside the derived value it shows the ROUNDED value the catalogue publishes
//   (a Lv95 Varka's `atk: 392`) and the difference. That is what makes this an
//   audit rather than a viewer: the published tables are an independent source,
//   and a level where the two disagree after rounding is visible instead of
//   buried. Two of Varka's 92 rows are expected to disagree -- they sit exactly on
//   a .5 boundary, where the 4-decimal precision of the downloaded Excel decides
//   the last digit.
//
// This file is PRESENTATION ONLY. Loading and the arithmetic live in
// lib/catalogue.js and lib/stat-tables.js.

import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, useI18n } from './i18n';
import { avatarImg, weaponIconImg } from './game';
import { CHAR_LEVEL_MAX, loadCharacterDetail, useCatalogue, weaponIconName } from './lib/catalogue';
import { charStatsAt, weaponMaxLevel, weaponStatsAt } from './lib/stat-tables';
import './index.css';

/** `1234.5678` -> `1234.57`; integers stay integers so a column reads cleanly. */
const num = (n, digits = 2) => {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
};

/** A percent-style substat keeps its unit; a flat one does not. */
const statText = (name, value) => (name && value ? `${name} ${num(value)}` : '—');

/**
 * The rounded per-level table the catalogue publishes, for the comparison
 * columns. `null` when the character has no detail file.
 */
function usePublishedChar(charId, lang) {
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (!charId) { setDetail(null); return undefined; }
    let alive = true;
    setDetail(null);
    loadCharacterDetail(charId, lang).then((d) => { if (alive) setDetail(d); });
    return () => { alive = false; };
  }, [charId, lang]);
  return detail;
}

/**
 * The audit headline: how many of the levels the published table covers disagree
 * with the derived value after rounding.
 *
 * This is the number a human is here to check. Rounding is compared rather than
 * raw equality because the published table IS rounded -- a derived 392.4743 and a
 * published 392 agree. A non-zero count is not automatically a bug: a value
 * sitting exactly on a .5 boundary can land either side, and the downloaded Excel
 * is itself truncated to four decimals.
 */
function AuditSummary({ charId, lang, stats }) {
  const { L } = useI18n();
  const detail = usePublishedChar(charId, lang);
  const rows = detail?.info?.attributes;
  const result = useMemo(() => {
    if (!rows?.length) return null;
    let checked = 0;
    let differing = 0;
    for (const row of rows) {
      const s = charStatsAt(stats, charId, row.level);
      if (!s) continue;
      for (const k of ['hp', 'atk', 'def']) {
        checked++;
        if (Math.round(s[k]) !== row[k]) differing++;
      }
    }
    return { checked, differing };
  }, [rows, stats, charId]);

  if (!result) return null;
  return (
    <p
      data-stat-audit-summary
      className={`rounded-lg border px-3 py-2 text-xs ${
        result.differing
          ? 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200'
          : 'border-[#7fd4c1]/30 bg-[#7fd4c1]/[0.05] text-[#7fd4c1]'
      }`}
    >
      {result.differing
        ? L({
            chs: `与本地展示表对照：${result.checked} 个数值中有 ${result.differing} 处在四舍五入后不一致（多半是 0.5 边界或解包数据截断）。`,
            en: `Against the published table: ${result.differing} of ${result.checked} values differ after rounding (usually a .5 boundary or the truncated source).`,
          })
        : L({
            chs: `与本地展示表对照：${result.checked} 个数值全部一致。`,
            en: `Against the published table: all ${result.checked} values agree.`,
          })}
    </p>
  );
}

/** One row of the character table. */
function CharRows({ charId, lang, stats, names }) {
  const detail = usePublishedChar(charId, lang);
  const byLevel = useMemo(() => {
    const m = new Map();
    for (const row of detail?.info?.attributes || []) m.set(row.level, row);
    return m;
  }, [detail]);

  return (
    <>
      {Array.from({ length: CHAR_LEVEL_MAX }, (_, i) => i + 1).map((level) => {
        const s = charStatsAt(stats, charId, level);
        const published = byLevel.get(level);
        if (!s) return null;
        const cells = [
          ['hp', s.hp, published?.hp],
          ['atk', s.atk, published?.atk],
          ['def', s.def, published?.def],
        ];
        const mismatch = cells.some(([, v, p]) => p != null && Math.round(v) !== p);
        return (
          <tr key={level} className="border-t border-white/[0.06]">
            <td className="px-2 py-1 text-right tabular-nums text-white/50">{level}</td>
            {cells.map(([key, v, p]) => (
              <td key={key} className="px-2 py-1 text-right tabular-nums text-white/85">
                {num(v)}
                {p != null && Math.abs(Math.round(v) - p) > 0 && (
                  <span className="ml-1 text-[10px] text-amber-300/80" title={`本地表 ${p}`}>
                    ({p})
                  </span>
                )}
              </td>
            ))}
            <td className="px-2 py-1 text-right tabular-nums text-[#7fd4c1]/80">
              {statText(s.ascensionName, s.ascensionValue)}
            </td>
            <td className="px-2 py-1 text-right text-[10px] text-white/25">
              {mismatch ? '有偏差' : ''}
            </td>
          </tr>
        );
      })}
      {!detail && (
        <tr>
          <td colSpan={6} className="px-2 py-3 text-center text-xs text-white/35">
            {names.loadingLocal}
          </td>
        </tr>
      )}
    </>
  );
}

/** One row of the weapon table. */
function WeaponRows({ weaponId, stats, ascensionStats, names }) {
  const maxLevel = weaponMaxLevel(stats, weaponId) ?? 90;
  return (
    <>
      {Array.from({ length: maxLevel }, (_, i) => i + 1).map((level) => {
        const s = weaponStatsAt(stats, weaponId, level);
        if (!s) return null;
        const published = level === maxLevel ? ascensionStats?.atk : undefined;
        return (
          <tr key={level} className="border-t border-white/[0.06]">
            <td className="px-2 py-1 text-right tabular-nums text-white/50">{level}</td>
            <td className="px-2 py-1 text-right tabular-nums text-white/85">
              {num(s.atk)}
              {published != null && Math.abs(Math.round(s.atk) - published) > 0 && (
                <span className="ml-1 text-[10px] text-amber-300/80" title={`本地表 ${published}`}>
                  ({published})
                </span>
              )}
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-[#7fd4c1]/80">
              {statText(s.subName, s.subValue)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Page() {
  const { lang, L } = useI18n();
  const { catalogue, error } = useCatalogue();
  const [mode, setMode] = useState('char');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);

  const stats = catalogue?.stats || null;

  const list = useMemo(() => {
    if (!catalogue) return [];
    const needle = q.trim().toLowerCase();
    const src =
      mode === 'char'
        ? Object.entries(catalogue.chars).map(([id, c]) => ({
            id, name: c.chsName, en: c.enName, icon: avatarImg(id), element: c.element,
          }))
        : Object.entries(catalogue.weapons).map(([id, w]) => ({
            // `weaponIconName` inserts the `Gacha_` infix the mirror's files
            // use; `weaponlist.json` stores the game's own `UI_EquipIcon_*`.
            // Passing the catalogue name straight through drew a broken image.
            id, name: w.chsName, en: w.enName, icon: weaponIconImg(weaponIconName(w.weaponIcon)),
          }));
    const hit = needle
      ? src.filter((x) => `${x.name} ${x.en} ${x.id}`.toLowerCase().includes(needle))
      : src;
    return hit.slice(0, 200);
  }, [catalogue, mode, q]);

  // Reset the selection when the list changes underneath it, so the table never
  // shows a weapon while the picker is in character mode.
  useEffect(() => { setSelected(null); }, [mode]);

  const current = selected || (list[0]?.id ?? null);

  const factors = useMemo(() => {
    if (!stats || current == null) return null;
    if (mode === 'char') {
      const c = stats.chars?.[String(current)] ?? stats.chars?.[String(current).split('_')[0]];
      if (!c) return { fallback: true };
      const phases = stats.charPromote?.[c.promote] || [];
      return {
        rows: [
          ['基础值 (Lv1)', `HP ${c.base.hp}`, `ATK ${c.base.atk}`, `DEF ${c.base.def}`],
          ['成长曲线', c.curve.hp, c.curve.atk, c.curve.def],
          ['突破表 id', c.promote],
          ['突破阶数', `${phases.length} 阶`],
        ],
      };
    }
    const w = stats.weapons?.[String(current)];
    if (!w) return { fallback: true };
    return {
      rows: [
        ['主属性', w.main.prop, `初值 ${w.main.base}`, w.main.curve],
        ['副属性', w.sub ? w.sub.prop : '无', w.sub ? `初值 ${w.sub.base}` : '', w.sub ? w.sub.curve : ''],
        ['突破表 id', w.promote],
        ['封顶等级', `Lv${w.maxLevel}`],
      ],
    };
  }, [stats, current, mode]);

  const t = {
    title: L({ chs: '数值来源与审核', en: 'Stat derivation & audit' }),
    lead: L({
      chs: '这里的数值由公式 base × 成长曲线(等级) + 突破值(阶) 计算，与游戏配置表一致；右侧对照列是本地数据集里四舍五入后的展示值。',
      en: 'Each value is computed as base × curve(level) + ascension bonus. The parenthesised number is the rounded one the local dataset publishes, shown for comparison.',
    }),
    char: L({ chs: '角色', en: 'Characters' }),
    weapon: L({ chs: '武器', en: 'Weapons' }),
    search: L({ chs: '搜索名称或 id…', en: 'Search name or id…' }),
    level: L({ chs: '等级', en: 'Lv' }),
    hp: L({ chs: '生命', en: 'HP' }),
    atk: L({ chs: '攻击', en: 'ATK' }),
    def: L({ chs: '防御', en: 'DEF' }),
    asc: L({ chs: '突破属性', en: 'Ascension' }),
    check: L({ chs: '对照', en: 'Check' }),
    base: L({ chs: '白值', en: 'Base ATK' }),
    sub: L({ chs: '副属性', en: 'Secondary' }),
    noStats: L({ chs: '未加载 stats-compact.json，无法按公式计算。', en: 'stats-compact.json is not loaded, so no formula is available.' }),
    fallback: L({ chs: '该角色没有配置表因子（新增或非 Excel 角色），下面用的是本地四舍五入表。', en: 'This entry has no config-table factors; the rounded local table is used instead.' }),
    loadingLocal: L({ chs: '载入本地对照表…', en: 'Loading the published table…' }),
    back: L({ chs: '返回配队', en: 'Back to planner' }),
    buffs: L({ chs: '增益库', en: 'Buff library' }),
    audit: L({ chs: '伤害源审核', en: 'Damage sources' }),
  };

  const NavLink = ({ href, children }) => (
    <a
      href={href}
      className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/30 hover:text-white"
    >
      {children}
    </a>
  );

  if (error) {
    return <div className="p-8 text-sm text-red-300">{String(error)}</div>;
  }

  return (
    <div className="mx-auto max-w-[1200px] p-6 text-white">
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <NavLink href="/planner.html">← {t.back}</NavLink>
        <NavLink href="/buffs.html">{t.buffs}</NavLink>
        <NavLink href="/audit.html">{t.audit}</NavLink>
        <h1 className="text-lg font-semibold">{t.title}</h1>
      </header>
      <p className="mb-4 max-w-3xl text-xs leading-relaxed text-white/45">{t.lead}</p>

      {!stats ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
          {t.noStats}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
          {/* ------------------------------------------------------- picker */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              {['char', 'weapon'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                    mode === m
                      ? 'border-[#7fd4c1]/60 bg-[#7fd4c1]/12 text-[#7fd4c1]'
                      : 'border-white/12 text-white/50 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {m === 'char' ? t.char : t.weapon}
                </button>
              ))}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.search}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"
            />
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-white/[0.08]">
              {list.map((x) => (
                <button
                  key={x.id}
                  onClick={() => setSelected(x.id)}
                  data-stat-entry={x.id}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                    current === x.id ? 'bg-white/[0.08] text-white' : 'text-white/60 hover:bg-white/[0.04]'
                  }`}
                >
                  {x.icon && <img src={x.icon} alt="" className="h-6 w-6 shrink-0 object-contain" />}
                  <span className="truncate">{x.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ------------------------------------------------------ factors */}
          <div className="flex min-w-0 flex-col gap-3">
            {factors?.fallback && (
              <p className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
                {t.fallback}
              </p>
            )}
            {factors?.rows && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3" data-stat-factors>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-white/35">
                  {L({ chs: '计算因子（来自游戏配置表）', en: 'Factors (from the game config tables)' })}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                  {factors.rows.map((row, i) => (
                    <div key={i} className="flex flex-col">
                      <dt className="text-white/35">{row[0]}</dt>
                      <dd className="truncate font-mono text-white/75">{row.slice(1).filter(Boolean).join(' · ')}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {mode === 'char' && current != null && (
              <AuditSummary charId={current} lang={lang} stats={stats} />
            )}
            <div className="overflow-hidden rounded-lg border border-white/[0.08]">
              <table className="w-full text-xs" data-stat-table>
                <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-2 py-1.5 text-right">{t.level}</th>
                    {mode === 'char' ? (
                      <>
                        <th className="px-2 py-1.5 text-right">{t.hp}</th>
                        <th className="px-2 py-1.5 text-right">{t.atk}</th>
                        <th className="px-2 py-1.5 text-right">{t.def}</th>
                        <th className="px-2 py-1.5 text-right">{t.asc}</th>
                        <th className="px-2 py-1.5 text-right">{t.check}</th>
                      </>
                    ) : (
                      <>
                        <th className="px-2 py-1.5 text-right">{t.base}</th>
                        <th className="px-2 py-1.5 text-right">{t.sub}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {current != null && mode === 'char' && (
                    <CharRows charId={current} lang={lang} stats={stats} names={t} />
                  )}
                  {current != null && mode === 'weapon' && (
                    <WeaponRows
                      weaponId={current}
                      stats={stats}
                      ascensionStats={catalogue?.weapons?.[current]?.ascensionStats}
                      names={t}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <Page />
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
