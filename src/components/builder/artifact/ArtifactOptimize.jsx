// The artifact optimiser: one button, one dialog.
//
// WHAT THE BUTTON IS FOR
//   The five slots above answer "what am I wearing". The question this answers is
//   the one you ask NEXT, and the one the row cannot: "of every way the rolls my
//   five pieces could spend, which is best?" That is a search, and it is run by a
//   C++ program (see native/optimize/) because the enumeration is wide.
//
// WHAT THE DIALOG ASKS FOR FIRST: THE SHAPE OF THE BUILD
//   A search is only as honest as its constraints, and the constraints are the
//   artifact rules: four substat lines per piece, at least one roll on every line,
//   nine rolls per piece, and no substat equal to the piece's own main stat. The
//   dialog is therefore five PIECE CARDS -- the same five pieces, with the same
//   artwork, as the editor above it -- rather than a pile of sliders. Every substat
//   on a card sits in one of three states:
//
//     不用 (off)   this piece may not carry it
//     可选 (may)   it may, if the search finds it worth a line
//     必选 (must)  this piece carries it, so one of its four lines is spoken for
//
//   "从配置导入" pins what the build already wears as 必选. That puts the build on
//   screen INSIDE the search space, so the optimum cannot come out worse than what
//   the user has -- without it the search is free to answer with a panel the worn
//   pieces cannot reach, and a "best" that loses to the current build looks like a
//   broken optimiser rather than a different question.
//
// WHAT IT DOES NOT MOVE
//   Main stats, set, weapon, level, talents and teammate buffs stay exactly as
//   configured, because moving a main stat changes which substats the piece may
//   carry at all and would invalidate the merged expression. Only the ROLLS move,
//   and the panel the search starts from therefore has every substat removed.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { artifactIconImg, qualityOf } from '../../../game';
import { useI18n } from '../../../i18n';
import {
  ARTIFACT_LEVEL_MAX, MAIN_STATS, SLOTS, SLOT_LABEL, mainStatValue, pieceIcon,
  statMeta, useArtifacts,
} from '../../../lib/artifact';
import {
  DEFAULT_HIT_SCALE, MAX_ROLLS_PER_LINE, MONO_ORDER, SYMBOL_LABEL, UPGRADES_DEFAULT,
  allowedSubstatsFor, buildProblem, defaultPieces, impliedHits, importPieces, monoFactors,
  parseResult, pieceSpec, scaledRefPanel, stripSubstats,
} from '../../../lib/artifact-optimize';
import { mergedExpression, panelOf, totalAtkOf } from '../../../lib/merged-expression';
import { StatGlyph, StatMenu } from './StatGlyph';

/** Rows per page. The enumeration is ~100k wide; the DOM is not. */
const PAGE = 100;

/** The three states a substat can be in on a piece, and how they cycle. */
const CYCLE = [1, 2, 0];
const STATE_LABEL = {
  0: { chs: '不用', en: 'off' },
  1: { chs: '可选', en: 'may' },
  2: { chs: '必选', en: 'must' },
};

const fmt = (x, d = 0) => Number(x || 0).toLocaleString('en-US', {
  minimumFractionDigits: d, maximumFractionDigits: d,
});
const fmtGain = (g) => (g >= 0 ? '+' : '') + (g * 100).toFixed(2) + '%';

/** Whether the build on screen actually wears any substats. */
const wornSubstats = (build) =>
  SLOTS.some(({ key }) => (build?.[key]?.subStats || []).some((s) => s?.key));

export default function ArtifactOptimize({ charId, build, optimize }) {
  const [open, setOpen] = useState(false);
  const { L } = useI18n();
  if (!charId || !optimize) return null;

  return (
    <>
      <button
        type="button"
        data-artifact-optimize
        onClick={() => setOpen(true)}
        title={L({ chs: '圣遗物词条优化', en: 'Optimise substats' })}
        className="rounded border border-[#7fd4c1]/30 bg-[#7fd4c1]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#7fd4c1] transition-colors hover:border-[#7fd4c1]/70 hover:bg-[#7fd4c1]/20"
      >
        {L({ chs: '优化', en: 'Optimise' })}
      </button>
      {open && (
        <OptimizeDialog
          charId={charId}
          build={build}
          optimize={optimize}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function OptimizeDialog({ charId, build, optimize, onClose }) {
  const { lang, L } = useI18n();
  // The sets are not decoration: the 2-piece and 4-piece bonuses are part of the
  // merged coefficients, and the CHARTS of them load after the page does. Running
  // before they arrive searches an expression that is missing its set damage and
  // reports a number that quietly disagrees with the rest of the app, so the run is
  // held until they are in.
  const { sets, loading: setsLoading } = useArtifacts(lang);

  // The merged expression and the two panels, computed ONCE. The merge is
  // synchronous and exact, so there is no loading state to model -- if the
  // character's detail file is missing the merge returns null and the dialog says
  // so rather than showing a plausible-looking nothing.
  const expr = useMemo(() => mergedExpression({
    entries: optimize.entries,
    team: optimize.team,
    catalogue: optimize.catalogue,
    talentDamage: optimize.talentDamage,
    charId,
  }), [optimize, charId]);

  /** The panel without substats: the search's starting point. */
  const basePanel = useMemo(
    () => panelOf(optimize.team, optimize.catalogue, charId, stripSubstats(build)),
    [optimize, charId, build]
  );
  /** The panel AS WORN, at full value: the starting point for the comparison. */
  const curPanel = useMemo(
    () => panelOf(optimize.team, optimize.catalogue, charId),
    [optimize, charId]
  );

  const [hitScale, setHitScale] = useState(DEFAULT_HIT_SCALE);
  const [upgrades, setUpgrades] = useState(UPGRADES_DEFAULT);
  // A build that wears substats opens IMPORTED: its lines are on the cards as
  // 必选, so the search starts from something the user can recognise and can only
  // improve on. An empty build opens free.
  const [pieces, setPieces] = useState(() => (
    wornSubstats(build) ? importPieces(build) : defaultPieces(build)
  ));

  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [order, setOrder] = useState('avg');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * A parameter setter that ALSO drops the previous run.
   *
   * A result belongs to the parameters that produced it. Leaving a table on screen
   * after a card changed means the table and the cards describe different searches,
   * and the table is the one that looks authoritative.
   */
  const replace = (next) => { setPieces(next); setResult(null); };
  const patch = (index, piece) =>
    replace(pieces.map((p, i) => (i === index ? piece : p)));

  const cycle = (index, key) => {
    const piece = pieces[index];
    patch(index, {
      ...piece,
      allows: piece.allows.map((a) => (a.key === key ? { ...a, state: CYCLE[a.state] ?? 1 } : a)),
    });
  };

  /**
   * The main stat is EXCLUSIVE: a piece can never carry its own main stat as a
   * substat. So switching one is not a tweak to one cell -- it REBUILDS the pool:
   * the new main stat leaves the list, and the old one comes back as an ordinary
   * substat that the piece is free to roll. A cell the user had pinned keeps its
   * state on the way through.
   */
  const setMain = (index, key) => {
    const piece = pieces[index];
    const previous = new Map(piece.allows.map((a) => [a.key, a.state]));
    patch(index, {
      ...piece,
      mainStat: key,
      allows: allowedSubstatsFor(key).map((k) => ({ key: k, state: previous.get(k) ?? 1 })),
    });
  };

  /** How many upgrades a piece gets decides its roll count; the cells stay put. */
  const setUpgradeCount = (n) => {
    setUpgrades(n);
    replace(pieces.map((p) => pieceSpec({
      slotKey: p.slot, mainStat: p.mainStat, upgrades: n, allows: p.allows,
    })));
  };

  const feasibility = useMemo(() => pieces.map((p) => {
    const usable = p.allows.filter((a) => a.state >= 1).length;
    const must = p.allows.filter((a) => a.state >= 2).length;
    return { usable, must, ok: usable >= p.lines && must <= p.lines };
  }), [pieces]);
  const feasible = feasibility.every((f) => f.ok);

  const run = async () => {
    if (!expr || !basePanel || !feasible || setsLoading) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const problem = buildProblem({
        expr,
        panel: basePanel,
        // The comparison is the CURRENT build under the SAME assumption the search
        // makes about a roll, so the two numbers answer one question. At scale 1 it
        // is the worn panel itself.
        ref: scaledRefPanel(basePanel, curPanel, hitScale),
        pieces,
        hitScale,
      });
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem }),
      });
      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try { message = JSON.parse(text).error || text; } catch { /* plain text */ }
        throw new Error(message);
      }
      setResult(parseResult(text));
      setPage(0);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  // The current build is NOT part of the search: it is a comparison, pinned beside
  // the best row rather than sorted into the table, where 100k rows would bury it.
  const searched = useMemo(
    () => (result ? result.rows.filter((r) => !r.isCurrent) : []),
    [result]
  );
  const sorted = useMemo(
    () => [...searched].sort((a, b) => b[order] - a[order]),
    [searched, order]
  );
  const current = result?.rows.find((r) => r.isCurrent) || null;
  const best = sorted[0] || null;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE));
  const view = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const worn = curPanel ? impliedHits(basePanel, curPanel) : 0;

  return createPortal(
    <div
      data-optimize-dialog
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={L({ chs: '圣遗物词条优化', en: 'Substat optimiser' })}
        className="flex max-h-[92vh] w-full max-w-[1360px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f13]/95 shadow-2xl shadow-black/80 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-bold text-white">
            {L({ chs: '圣遗物词条优化', en: 'Substat optimiser' })}
          </h2>
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/50">
            {charId}
          </span>
          <span className="text-[10px] text-white/35">
            {L({
              chs: '每件 4 条词条 · 每条至少 1 次 · ' + upgrades + ' 次强化',
              en: '4 substats a piece, 1 roll minimum each, ' + upgrades + ' upgrades',
            })}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded px-1 text-[13px] text-white/30 transition-colors hover:text-white/80"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!expr && (
            <p className="py-8 text-center text-[11px] text-white/40">
              {L({
                chs: '读不到这个角色的伤害条目（判定文件未加载或该角色不在轴上）',
                en: 'No damage entries for this character (detail file missing, or the character is not on the axis)',
              })}
            </p>
          )}

          {expr && (
            <>
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-[11px] font-bold text-white/80">
                    {L({ chs: '这件圣遗物能出什么词条', en: 'What each piece may carry' })}
                  </p>
                  <span className="text-[10px] text-white/35">
                    {L({
                      chs: '点一次 = 可选，点两次 = 必选，点三次 = 不用',
                      en: 'click once: may, twice: must, three times: off',
                    })}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      data-optimize-import
                      disabled={!wornSubstats(build)}
                      title={L({
                        chs: '把当前配置的副词条作为“必选”填进五个部位',
                        en: 'Pin the substats this build wears as required',
                      })}
                      onClick={() => replace(importPieces(build, { scale: hitScale, upgrades }))}
                      className="rounded border border-[#7fd4c1]/30 bg-[#7fd4c1]/10 px-2 py-0.5 text-[10px] text-[#7fd4c1] transition-colors hover:border-[#7fd4c1]/70 disabled:opacity-30"
                    >
                      {L({ chs: '从配置导入', en: 'Import build' })}
                    </button>
                    <button
                      type="button"
                      data-optimize-allmay
                      onClick={() => replace(pieces.map((p) => ({
                        ...p,
                        allows: p.allows.map((a) => ({ ...a, state: a.key === p.mainStat ? 0 : 1 })),
                      })))}
                      className="rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/50 transition-colors hover:border-white/30 hover:text-white/80"
                    >
                      {L({ chs: '全部可选', en: 'All optional' })}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {pieces.map((piece, i) => (
                    <PieceCard
                      key={piece.slot}
                      index={i}
                      piece={piece}
                      sets={sets}
                      setId={build?.[piece.slot]?.setId ?? null}
                      info={feasibility[i]}
                      onCycle={cycle}
                      onMainStat={setMain}
                      L={L}
                    />
                  ))}
                </div>
              </section>

              <Controls
                L={L}
                hitScale={hitScale}
                setHitScale={(v) => { setHitScale(v); setResult(null); }}
                upgrades={upgrades}
                setUpgrades={setUpgradeCount}
                worn={worn}
                pieces={pieces}
              />

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  data-optimize-run
                  disabled={running || !feasible || setsLoading}
                  onClick={run}
                  className="rounded-lg border border-[#7fd4c1]/40 bg-[#7fd4c1]/15 px-4 py-1.5 text-[11px] font-bold text-[#7fd4c1] transition-colors hover:border-[#7fd4c1]/80 hover:bg-[#7fd4c1]/25 disabled:opacity-40"
                >
                  {running ? L({ chs: '搜索中…', en: 'Searching…' }) : L({ chs: '开始优化', en: 'Run' })}
                </button>
                {setsLoading && (
                  <span className="text-[10px] text-white/40">
                    {L({ chs: '套装数据加载中…', en: 'Loading set data…' })}
                  </span>
                )}
                {!feasible && (
                  <span className="text-[10px] text-amber-300/90">
                    {L({
                      chs: '有部位凑不出 4 条词条（可选 + 必选 至少要 4，必选不能超过 4）',
                      en: 'A piece cannot fill its 4 lines (may + must must be at least 4, must at most 4)',
                    })}
                  </span>
                )}
                {error && <span className="text-[10px] text-red-300">{error}</span>}
              </div>

              {result && (
                <Results
                  L={L}
                  result={result}
                  best={best}
                  current={current}
                  order={order}
                  setOrder={(v) => { setOrder(v); setPage(0); }}
                  view={view}
                  page={page}
                  pageCount={pageCount}
                  setPage={setPage}
                  hitScale={hitScale}
                />
              )}

              <Expression expr={expr} basePanel={basePanel} curPanel={curPanel} L={L} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ----------------------------------------------------------------- the pieces */

/**
 * One slot, as a card: the artwork, the main stat, and a cell per substat.
 *
 * The cell grid is the point of the whole dialog. A substat is not a slider or a
 * maximum -- it is a question about LINES, and a piece has exactly four of them, so
 * the states are 不用 / 可选 / 必选 and the footer says whether the four lines can
 * still be filled.
 */
function PieceCard({ index, piece, sets, setId, info, onCycle, onMainStat, L }) {
  const set = setId ? sets?.[setId] : null;
  const icon = pieceIcon(sets, setId, piece.slot);
  const rq = qualityOf(set?.qualityType);
  return (
    <div
      data-piece-card={piece.slot}
      className="flex w-[238px] shrink-0 flex-col gap-1.5 rounded-xl border bg-white/[0.02] p-2"
      style={{ borderColor: info.ok ? 'rgba(255,255,255,0.07)' : 'rgba(251,191,36,0.45)' }}
    >
      <div className="flex items-center gap-2">
        <div
          className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border"
          style={{
            borderColor: set ? rq.color + '66' : 'rgba(255,255,255,0.10)',
            background: set
              ? 'radial-gradient(80% 70% at 50% 30%, ' + rq.color + '22 0%, rgba(0,0,0,0.55) 70%)'
              : 'rgba(0,0,0,0.35)',
          }}
        >
          {icon ? (
            <img
              src={artifactIconImg(icon)}
              alt=""
              className="h-full w-full object-contain p-0.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)]"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg text-white/20">+</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] text-white/40">{L(SLOT_LABEL[piece.slot])}</p>
          <MainStatPicker slotKey={piece.slot} piece={piece} onPick={(k) => onMainStat(index, k)} L={L} />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-1">
        {piece.allows.map((a) => (
          <SubstatCell
            key={a.key}
            stat={a.key}
            state={a.state}
            onClick={() => onCycle(index, a.key)}
            L={L}
          />
        ))}
      </div>

      <p className="text-[9px] leading-tight text-white/35">
        {L({
          chs: '可用 ' + info.usable + ' 条 · 必选 ' + info.must + ' 条 · 需要 '
            + piece.lines + ' 条线 · ' + piece.rolls + ' 次掷点',
          en: info.usable + ' usable, ' + info.must + ' required, '
            + piece.lines + ' lines, ' + piece.rolls + ' rolls',
        })}
      </p>
      {!info.ok && (
        <p className="text-[9px] font-bold text-amber-300/90">
          {L({
            chs: info.must > piece.lines ? '必选比线还多' : '可选词条凑不满四条线',
            en: info.must > piece.lines ? 'more required than lines' : 'not enough substats to fill the lines',
          })}
        </p>
      )}
    </div>
  );
}

/** One substat cell, cycling 不用 -> 可选 -> 必选. */
function SubstatCell({ stat, state, onClick, L }) {
  const meta = statMeta(stat);
  const border = state === 2
    ? '#7fd4c1'
    : state === 1 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)';
  return (
    <button
      type="button"
      onClick={onClick}
      data-substat-cell={stat}
      data-state={state}
      title={L(meta) + ' · ' + L(STATE_LABEL[state])}
      aria-label={L(meta)}
      aria-pressed={state > 0}
      className="relative flex h-[30px] items-center justify-center rounded-md border transition-colors"
      style={{
        borderColor: border,
        backgroundColor: state === 2
          ? 'rgba(127,212,193,0.14)'
          : state === 1 ? 'rgba(255,255,255,0.03)' : 'transparent',
        opacity: state === 0 ? 0.32 : 1,
      }}
    >
      <StatGlyph stat={stat} size={15} />
      {state === 2 && (
        <span className="absolute right-[3px] top-[3px] h-[3px] w-[3px] rounded-full bg-[#7fd4c1]" />
      )}
    </button>
  );
}

/**
 * The main stat of one piece, as a picker.
 *
 * The TYPE is what matters here, not the value: the value is derived from the type
 * and the piece's level, and the type is what excludes itself from the substat
 * pool. So the control shows both and only the type is editable.
 */
function MainStatPicker({ slotKey, piece, onPick, L }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const meta = piece.mainStat ? statMeta(piece.mainStat) : null;
  const value = piece.mainStat ? mainStatValue(piece.mainStat, ARTIFACT_LEVEL_MAX) : null;

  return (
    <div className="relative w-full">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-piece-main={slotKey}
        title={L({
          chs: '主词条：这件圣遗物不能把它自己当作副词条',
          en: 'Main stat: a piece can never carry its own main stat as a substat',
        })}
        className="flex w-full items-center gap-1 rounded-md border border-white/[0.12] px-1 py-[2px] transition-colors hover:border-white/30"
      >
        {piece.mainStat ? (
          <>
            <StatGlyph stat={piece.mainStat} size={13} />
            <span className="min-w-0 flex-1 truncate text-left text-[10px] text-white/80">
              {L(meta)}
            </span>
            <span className="shrink-0 text-[10px] font-bold tabular-nums text-white/70">
              {value == null ? '—' : value + (meta?.suffix || '')}
            </span>
          </>
        ) : (
          <span className="flex-1 text-center text-[10px] text-white/25">
            {L({ chs: '+ 主词条', en: '+ main stat' })}
          </span>
        )}
      </button>
      {open && (
        <StatMenu
          anchor={anchorRef.current}
          options={MAIN_STATS[slotKey]}
          value={piece.mainStat}
          // Above the dialog, not above the artifact row: this picker is opened
          // from inside a layer of its own.
          zIndex="z-[90]"
          onPick={(k) => { onPick(k); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- controls */

function Controls({ L, hitScale, setHitScale, upgrades, setUpgrades, worn, pieces }) {
  const rolls = pieces.reduce((s, p) => s + p.rolls, 0);
  return (
    <section className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <p className="mb-2 text-[11px] font-bold text-white/80">
        {L({ chs: '搜索参数', en: 'Search parameters' })}
      </p>
      <div className="flex flex-wrap items-end gap-5">
        <Field
          label={L({ chs: '单次命中系数', en: 'Roll scale' })}
          hint={L({
            chs: '一次强化相当于该词条满档的几成。四档为 0.7/0.8/0.9/1.0，均值 0.85；0.8 是偏保守的一侧。',
            en: 'What one roll is worth against a top-tier roll. The tiers are 0.7/0.8/0.9/1.0, mean 0.85; 0.8 is the cautious side.',
          })}
          value={hitScale}
          set={setHitScale}
          step={0.05}
        />
        <Field
          label={L({ chs: '每件强化次数', en: 'Upgrades per piece' })}
          hint={L({
            chs: '一件 +20 的五星圣遗物有 5 次强化，加上出生时的 4 条词条，共 9 次掷点。',
            en: 'A 5-star +20 piece has 5 upgrades; with the 4 affixes it is born with that is 9 rolls.',
          })}
          value={upgrades}
          set={setUpgrades}
          step={1}
          min={0}
          max={MAX_ROLLS_PER_LINE - 1}
        />
        <p className="text-[10px] leading-relaxed text-white/40">
          {L({ chs: '五件共 ' + rolls + ' 次掷点', en: rolls + ' rolls across the five pieces' })}
          {worn > 0 && (
            ' · ' + L({
              chs: '当前配置约合 ' + worn.toFixed(1) + ' 次满档',
              en: 'the current build is worth about ' + worn.toFixed(1) + ' top-tier rolls',
            })
          )}
        </p>
      </div>
    </section>
  );
}

function Field({ label, hint, value, set, step = 1, min, max }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-white/45">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        title={hint}
        onChange={(e) => set(Number(e.target.value))}
        className="w-[76px] rounded-md border border-white/12 bg-black/30 px-2 py-1 text-right text-[11px] font-bold tabular-nums text-white outline-none transition-colors focus:border-[#7fd4c1]/50"
      />
    </label>
  );
}

/* -------------------------------------------------------------------- results */

const ORDER_LABEL = {
  avg: { chs: '期望', en: 'expected' },
  crit: { chs: '必定暴击', en: 'always crit' },
  never: { chs: '不暴击', en: 'never crit' },
};

function Allocation({ row, L }) {
  const parts = Object.entries(row.hits || {}).filter(([, v]) => v > 0);
  if (!parts.length) return <span className="text-[10px] text-white/25">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map(([key, v]) => (
        <span
          key={key}
          className="flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1 py-0.5 text-[10px] font-bold tabular-nums text-white/75"
          title={L(statMeta(key))}
        >
          <StatGlyph stat={key} size={12} />
          {v}
        </span>
      ))}
    </div>
  );
}

function Results({
  L, result, best, current, order, setOrder, view, page, pageCount, setPage, hitScale,
}) {
  const gain = best && current ? best.avg / current.avg - 1 : 0;
  const stats = result.stats;
  return (
    <section data-optimize-results className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-bold text-white/80">
          {L({ chs: '结果', en: 'Results' })}
        </p>
        <span className="text-[10px] text-white/35">
          {L({
            chs: '共 ' + (result.rows.length - 1) + ' 种分配（按面板去重）',
            en: (result.rows.length - 1) + ' distinct allocations (deduplicated on the panel)',
          })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-[10px] text-white/35">{L({ chs: '排序', en: 'sort' })}</span>
          {Object.entries(ORDER_LABEL).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-optimize-order={key}
              onClick={() => setOrder(key)}
              className="rounded border px-1.5 py-0.5 text-[10px] transition-colors"
              style={{
                borderColor: order === key ? '#7fd4c1' : 'rgba(255,255,255,0.12)',
                color: order === key ? '#7fd4c1' : 'rgba(255,255,255,0.5)',
                backgroundColor: order === key ? 'rgba(127,212,193,0.12)' : 'transparent',
              }}
            >
              {L(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[#7fd4c1]/30 bg-[#7fd4c1]/[0.06] p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold text-[#7fd4c1]">
              {L({ chs: '最优', en: 'Best' })}
            </span>
            <span className="text-[15px] font-bold tabular-nums text-white">{fmt(best?.avg)}</span>
            <span className={'text-[11px] font-bold tabular-nums ' + (gain >= -1e-9 ? 'text-[#7fd4c1]' : 'text-amber-300')}>
              {fmtGain(gain)}
            </span>
            <span className="text-[10px] text-white/35">
              {L({ chs: '相对当前配置', en: 'vs the current build' })}
            </span>
          </div>
          <div className="mt-1.5">
            <Allocation row={best || { hits: {} }} L={L} />
          </div>
        </div>

        <div data-optimize-current className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold text-amber-200">
              {L({ chs: '当前配置', en: 'Current build' })}
            </span>
            <span className="text-[15px] font-bold tabular-nums text-white">{fmt(current?.avg)}</span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-white/45">
            {L({
              chs: 'A=' + fmt(current?.A) + ' · 暴击率=' + fmt(current?.R, 2) + '% · 暴伤=' + fmt(current?.C, 2)
                + '% · 期望=' + fmt(current?.avg) + ' · 暴击=' + fmt(current?.crit) + ' · 不暴击=' + fmt(current?.never),
              en: 'A=' + fmt(current?.A) + ' crit rate=' + fmt(current?.R, 2) + '% crit dmg=' + fmt(current?.C, 2)
                + '% expected=' + fmt(current?.avg) + ' crit=' + fmt(current?.crit) + ' no crit=' + fmt(current?.never),
            })}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/30">
            {hitScale === 1
              ? L({ chs: '系数 1.0：这一行就是你的真实面板', en: 'scale 1: this row is the real panel' })
              : L({
                chs: '当前配置按单次命中系数 ' + hitScale + ' 折算（每次命中只算满档的 ' + hitScale + ' 成）；系数改成 1.0 就是真实面板。',
                en: 'The current build is discounted by the roll scale ' + hitScale + ', the same way every roll in the search is; set the scale to 1 for the real panel.',
              })}
          </p>
          {!current && (
            <p className="mt-1 text-[10px] text-white/35">
              {L({ chs: '当前配置没有副词条可比', en: 'the current build has no substats to compare' })}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px] tabular-nums">
          <thead>
            <tr className="text-white/40">
              {stats.map((key) => (
                <th key={key} className="p-1" title={L(statMeta(key))}>
                  <span className="flex justify-center"><StatGlyph stat={key} size={13} /></span>
                </th>
              ))}
              <th className="p-1 text-right">{L({ chs: '合计', en: 'rolls' })}</th>
              <th className="p-1 text-right">A</th>
              <th className="p-1 text-right">{L({ chs: '暴击率', en: 'CR' })}</th>
              <th className="p-1 text-right">{L({ chs: '暴伤', en: 'CD' })}</th>
              <th className="p-1 text-right">{L({ chs: '期望', en: 'avg' })}</th>
              <th className="p-1 text-right">{L({ chs: '暴击', en: 'crit' })}</th>
              <th className="p-1 text-right">{L({ chs: '不暴击', en: 'never' })}</th>
            </tr>
          </thead>
          <tbody>
            {view.map((row, i) => (
              <tr key={page * PAGE + i} className="border-t border-white/[0.05] hover:bg-white/[0.03]">
                {stats.map((key) => (
                  <td
                    key={key}
                    className={'p-1 text-center ' + (row.hits[key] ? 'text-white/80' : 'text-white/15')}
                  >
                    {row.hits[key] || '·'}
                  </td>
                ))}
                <td className="p-1 text-right text-white/50">{row.total}</td>
                <td className="p-1 text-right text-white/70">{fmt(row.A)}</td>
                <td className="p-1 text-right text-white/70">{fmt(row.R, 2)}</td>
                <td className="p-1 text-right text-white/70">{fmt(row.C, 2)}</td>
                <td className="p-1 text-right font-bold text-white">{fmt(row.avg)}</td>
                <td className="p-1 text-right text-white/55">{fmt(row.crit)}</td>
                <td className="p-1 text-right text-white/55">{fmt(row.never)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/50 disabled:opacity-25"
          >
            {'<'}
          </button>
          <span className="text-[10px] tabular-nums text-white/40">
            {(page + 1) + ' / ' + pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="rounded border border-white/12 px-2 py-0.5 text-[10px] text-white/50 disabled:opacity-25"
          >
            {'>'}
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ the expression */

/**
 * The merged polynomial, shown rather than hidden.
 *
 * The search maximises THIS, so a user who wants to argue with the answer needs to
 * be able to see it: every coefficient the optimiser was handed, in the monomial
 * slot it was handed in.
 */
function Expression({ expr, basePanel, curPanel, L }) {
  return (
    <details open className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <summary className="cursor-pointer text-[11px] font-bold text-white/80">
        {L({ chs: '合并后的伤害表达式', en: 'Merged damage expression' })}
      </summary>
      <p className="mt-2 mb-2 text-[10px] leading-relaxed text-white/45">
        {L({
          chs: '把 ' + expr.entries + ' 个伤害条目（' + expr.parts + ' 段）合并成一个关于面板的多项式：总攻击力 A = 基础攻击 × (1 + 攻击力% / 100) + 固定攻击。搜索只移动副词条的掷点——主词条、套装、武器、天赋与队友增益都保持当前配置。',
          en: 'Merges ' + expr.entries + ' damage entries (' + expr.parts + ' parts) into one polynomial of the panel: total ATK A = base ATK x (1 + ATK% / 100) + flat ATK. The search only moves substat rolls; main stats, sets, weapon, talents and teammate buffs stay as configured.',
        })}
      </p>

      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-white/55">
        <div>
          {L({ chs: '搜索基线（去掉副词条）', en: 'Search baseline (substats removed)' })}
          {': A=' + fmt(basePanel?.atk) + ' , 暴击率=' + fmt(basePanel?.critRate, 2) + '% , 暴伤=' + fmt(basePanel?.critDmg, 2) + '%'}
        </div>
        <div>
          {L({ chs: '当前面板', en: 'Current panel' })}
          {': A=' + fmt(curPanel && totalAtkOf(curPanel)) + ' , 暴击率=' + fmt(curPanel?.critRate, 2) + '% , 暴伤=' + fmt(curPanel?.critDmg, 2) + '%'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1 text-[10px] font-semibold text-white/60">
            {L({ chs: 'f_never（不暴击）', en: 'f_never (never crits)' })}
          </p>
          <Terms coeffs={expr.coeffs.never} L={L} sign="+" />
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold text-white/60">
            {L({ chs: 'f_crit（必定暴击）', en: 'f_crit (always crits)' })}
          </p>
          <Terms coeffs={expr.coeffs.crit} L={L} sign="+" />
        </div>
      </div>

      <div className="mt-2 border-t border-white/[0.06] pt-2">
        <p className="text-[10px] leading-relaxed text-white/50">
          {'f_avg = f_never + Σ min(R + ΔR, 100) / 100 × Δf'}
        </p>
        {expr.coeffs.avgGroups.map((g) => (
          <div key={g.crBuff} className="mt-1.5">
            <p className="text-[10px] font-semibold text-white/60">
              {'ΔR = ' + g.crBuff + ' '}
              {L({ chs: '暴击率加成', en: 'crit-rate buff' })}
            </p>
            <Terms coeffs={g.delta} L={L} sign="Δ" />
          </div>
        ))}
        {expr.warnings.map((w) => (
          <p key={w.code} className="mt-1 text-[10px] text-amber-300/80">
            {w.code}
            {w.keys ? ': ' + w.keys.join(', ') : ''}
            {w.detail ? ' — ' + w.detail : ''}
          </p>
        ))}
      </div>
    </details>
  );
}

/** One symbol as the panel quantity the UI names. */
function monoName(mono, L) {
  if (mono === '1') return L({ chs: '常数项', en: 'constant' });
  return monoFactors(mono).map((s) => L(SYMBOL_LABEL[s] || { chs: s, en: s })).join(' × ');
}

/** A coefficient map, one row per non-zero term, in the program's own order. */
function Terms({ coeffs, L, sign }) {
  return (
    <div>
      {MONO_ORDER.map((mono) => {
        const value = Number(coeffs?.[mono]) || 0;
        if (!value) return null;
        return (
          <div key={mono} className="flex items-baseline gap-2 tabular-nums">
            <span className="text-[10px] text-white/40">{sign}</span>
            <span className="min-w-[150px] text-[10px] text-white/70">{monoName(mono, L)}</span>
            <span className="text-[10px] font-bold text-white">{Number(value.toPrecision(6)).toLocaleString('en-US')}</span>
          </div>
        );
      })}
    </div>
  );
}
