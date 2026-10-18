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
  allowedSubstatsFor, buildProblem, defaultPieces, emMattersIn, feedingSubstatsFor,
  impliedHits, importPieces, monoFactors, parseResult, pieceSpec, scalingBasesOf,
  stripSubstats,
} from '../../../lib/artifact-optimize';
import {
  damageAt, evaluate, evaluateAmp, mergedExpression, panelOf, variablesOf,
} from '../../../lib/merged-expression';
import { SCALING_SYMBOL } from '../../../lib/damage';
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
/** Search cost, in the unit that reads best at its magnitude. */
const fmtMs = (ms) => (ms == null
  ? '-' 
  : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s');

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

  /** Which A/H/D/M symbols this character's merged polynomial actually uses. */
  const scalingSymbols = useMemo(
    () => scalingBasesOf(expr).map((key) => SCALING_SYMBOL[key]),
    [expr]
  );
  const showEm = useMemo(() => emMattersIn(expr), [expr]);

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
  /** How long the search took, measured by the server around the C++ run. */
  const [elapsed, setElapsed] = useState(null);
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
    setElapsed(null);
    try {
      const problem = buildProblem({
        expr,
        panel: basePanel,
        // The BASELINE IS A FACT, NOT AN ASSUMPTION. The current build is the panel
        // the user actually wears, so it must not be discounted by the roll scale:
        // the scale models UNKNOWN candidate rolls, and applying it here would make
        // the comparison row weaker than the build on screen and inflate every gain.
        ref: curPanel ? variablesOf(curPanel) : null,
        pieces,
        hitScale,
      });
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem }),
      });
      const text = await res.text();
      const searchMs = Number(res.headers.get('X-Optimize-Ms'));
      if (!res.ok) {
        let message = text;
        try { message = JSON.parse(text).error || text; } catch { /* plain text */ }
        throw new Error(message);
      }
      setResult(parseResult(text));
      // The server reports spawn-to-close; null if an older server omits it.
      setElapsed(Number.isFinite(searchMs) && searchMs >= 0 ? searchMs : null);
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
  const worn = curPanel
    ? impliedHits(basePanel, curPanel, feedingSubstatsFor(expr))
    : 0;

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
                      onClick={() => replace(importPieces(build, { upgrades }))}
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
                  elapsed={elapsed}
                  showEm={showEm}
                  panelSymbols={scalingSymbols}
                />
              )}

              <Expression
                expr={expr} basePanel={basePanel} curPanel={curPanel} L={L}
                panelSymbols={scalingSymbols}
              />
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
          field="hit-scale"
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
          field="upgrades"
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

function Field({ label, hint, value, set, step = 1, min, max, field }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-white/45">{label}</span>
      <input
        data-field={field}
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
  L, result, best, current, order, setOrder, view, page, pageCount, setPage, elapsed,
  showEm, panelSymbols,
}) {
  // The headline must follow the SORT, not always the average. A crit-maximising
  // allocation deliberately trades average damage for crit damage, so showing its
  // `avg` while the table is ordered by `crit` makes the best crit build look
  // WORSE than the current one (observed: -1.56% when its crit was really +19.3%).
  const metric = ORDER_LABEL[order] ? order : 'avg';
  const bestVal = best ? best[metric] : null;
  const curVal = current ? current[metric] : null;
  const gain = best && current && curVal ? bestVal / curVal - 1 : 0;
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
        <span data-optimize-time className="text-[10px] text-white/45">
          {L({ chs: '优化耗时', en: 'search took' }) + ' ' + fmtMs(elapsed)}
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
            <span data-optimize-best={metric} className="text-[15px] font-bold tabular-nums text-white">{fmt(bestVal)}</span>
            <span className="text-[9px] text-white/35">{L(ORDER_LABEL[metric])}</span>
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
            <span data-optimize-current-value={metric} className="text-[15px] font-bold tabular-nums text-white">{fmt(curVal)}</span>
            <span className="text-[9px] text-white/35">{L(ORDER_LABEL[metric])}</span>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-white/45">
            {L({
              chs: panelSymbols.map((s) => s + '=' + fmt(current?.[s])).join(' · ')
                + ' · 暴击率=' + fmt(current?.R, 2) + '% · 暴伤=' + fmt(current?.C, 2) + '%'
                + (showEm ? ' · 精通=' + fmt(current?.E) : '')
                + ' · 期望=' + fmt(current?.avg) + ' · 暴击=' + fmt(current?.crit) + ' · 不暴击=' + fmt(current?.never),
              en: panelSymbols.map((s) => s + '=' + fmt(current?.[s])).join(' · ')
                + ' crit rate=' + fmt(current?.R, 2) + '% crit dmg=' + fmt(current?.C, 2) + '%'
                + (showEm ? ' EM=' + fmt(current?.E) : '')
                + ' expected=' + fmt(current?.avg) + ' crit=' + fmt(current?.crit) + ' no crit=' + fmt(current?.never),
            })}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/30">
            {L({
              chs: '这一行始终是你穿戴的真实面板，不随单次命中系数变化；该系数只用于模拟搜索里的候选词条。',
              en: 'This row is always the panel you actually wear and does not move with the roll scale; the scale only models the candidate rolls.',
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
              {panelSymbols.map((sym) => (
                <th key={sym} className="p-1 text-right">{sym}</th>
              ))}
              <th className="p-1 text-right">{L({ chs: '暴击率', en: 'CR' })}</th>
              <th className="p-1 text-right">{L({ chs: '暴伤', en: 'CD' })}</th>
              {showEm && <th className="p-1 text-right">{L({ chs: '精通', en: 'EM' })}</th>}
              <th className={'p-1 text-right ' + (metric === 'avg' ? 'font-bold text-white' : 'text-white/50')}>{L({ chs: '期望', en: 'avg' })}</th>
              <th className={'p-1 text-right ' + (metric === 'crit' ? 'font-bold text-white' : 'text-white/50')}>{L({ chs: '暴击', en: 'crit' })}</th>
              <th className={'p-1 text-right ' + (metric === 'never' ? 'font-bold text-white' : 'text-white/50')}>{L({ chs: '不暴击', en: 'never' })}</th>
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
                {panelSymbols.map((sym) => (
                  <td key={sym} className="p-1 text-right text-white/70">{fmt(row[sym])}</td>
                ))}
                <td className="p-1 text-right text-white/70">{fmt(row.R, 2)}</td>
                <td className="p-1 text-right text-white/70">{fmt(row.C, 2)}</td>
                {showEm && <td className="p-1 text-right text-white/70">{fmt(row.E)}</td>}
                <td className={'p-1 text-right ' + (metric === 'avg' ? 'font-bold text-white' : 'text-white/55')}>{fmt(row.avg)}</td>
                <td className={'p-1 text-right ' + (metric === 'crit' ? 'font-bold text-white' : 'text-white/55')}>{fmt(row.crit)}</td>
                <td className={'p-1 text-right ' + (metric === 'never' ? 'font-bold text-white' : 'text-white/55')}>{fmt(row.never)}</td>
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
 *
 * SHOWN AS A FORMULA, NOT A COLUMN OF TEXT. The panel used to be two naked lists of
 * "name   number", which hid the three things a reader needs: which symbols are
 * variables, what the terms are made of, and which of them a substat roll can move.
 * So: a legend of the panel's quantities drawn with their glyphs (teal = movable,
 * dim = fixed this run), the terms grouped by degree the way the polynomial is
 * built, and a colour that says whether a term survives a change of allocation.
 */

/** The panel quantity each symbol stands for, as a stat key that HAS a glyph. */
const SYMBOL_STAT = {
  A: 'atk', H: 'hp', D: 'def', M: 'em',
  U: 'anemoDmg', P: 'pyroDmg', C: 'critDmg', R: 'critRate', E: 'em',
};

/**
 * What a substat roll can actually move.
 *
 * ATK% and flat ATK feed A; CRIT DMG and CRIT Rate are rolled directly. Anemo /
 * Pyro / generic DMG bonus is NOT in the substat pool -- no piece can roll it -- so
 * those columns are constant during a search, and every term built only from them
 * is the same number for every candidate. That is the difference the colour marks.
 */
const BASE_MOVABLE = new Set(['A', 'C', 'R']);

const fmtCoef = (x) => Number(Number(x).toPrecision(6)).toLocaleString('en-US');

/** The used scaling values of a panel, as `A=...`, `H=...`, ... */
const panelText = (panel, symbols) => {
  if (!panel) return '-';
  const values = variablesOf(panel);
  return symbols.map((sym) => sym + '=' + fmt(values[sym])).join(' , ');
};

/** One panel quantity: its glyph, its name, and whether the search can move it. */
function Var({ sym, L, size = 12, movableSet = BASE_MOVABLE }) {
  const movable = movableSet.has(sym);
  return (
    <span className={'inline-flex items-center gap-1 ' + (movable ? 'text-[#7fd4c1]' : 'text-white/35')}>
      {SYMBOL_STAT[sym]
        ? <StatGlyph stat={SYMBOL_STAT[sym]} size={size} />
        : null}
      <span className="text-[10px]">{L(SYMBOL_LABEL[sym])}</span>
    </span>
  );
}

/** One monomial: its factors as chips, then the coefficient the program was handed. */
function TermRow({ mono, value, L, movableSet = BASE_MOVABLE }) {
  const factors = monoFactors(mono);
  const hot = factors.some((s) => movableSet.has(s));
  return (
    <div className="flex items-baseline gap-2 py-[1px] tabular-nums">
      <span className="text-[10px] leading-none text-white/20">+</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1">
        {factors.length === 0
          ? <span className="text-[10px] text-white/45">{L({ chs: '常数项', en: 'constant' })}</span>
          : factors.map((s, k) => (
            <span key={s} className="inline-flex items-center gap-1">
              {k > 0 && <span className="text-[10px] text-white/25">x</span>}
              <Var sym={s} L={L} movableSet={movableSet} />
            </span>
          ))}
      </span>
      <span className={'text-[10px] font-bold ' + (hot ? 'text-white' : 'text-white/45')}>
        {fmtCoef(value)}
      </span>
    </div>
  );
}

/** 0 when the term can change with the allocation, 1 when it cannot. */
const movedFirst = (mono, movableSet) => (
  monoFactors(mono).some((s) => movableSet.has(s)) ? 0 : 1
);

/** The degrees a monomial can have, in the order the polynomial grows. */
const DEGREES = [
  { n: 0, label: { chs: '常数', en: 'constant' } },
  { n: 1, label: { chs: '一项', en: 'one factor' } },
  { n: 2, label: { chs: '两项相乘', en: 'two factors' } },
  { n: 3, label: { chs: '三项相乘', en: 'three factors' } },
];

/** A coefficient map as a card: terms grouped by degree, in the program's order. */
function CoeffList({ title, sub, coeffs, L, accent, movableSet = BASE_MOVABLE }) {
  const rows = MONO_ORDER.filter((m) => Number(coeffs?.[m]) || 0);
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2">
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className={'text-[11px] font-bold ' + (accent || 'text-white/85')}>{title}</span>
        {sub && <span className="text-[9px] text-white/35">{sub}</span>}
      </p>
      {DEGREES.map(({ n, label }) => {
        // Movable terms first: within one degree, the ones built from A / C / R are
        // the only ones that can differ between two allocations, so they lead.
        const group = rows
          .filter((m) => monoFactors(m).length === n)
          .sort((a, b) => movedFirst(a, movableSet) - movedFirst(b, movableSet));
        if (!group.length) return null;
        return (
          <div key={n} className="mb-1 last:mb-0">
            <p className="text-[9px] tracking-wide text-white/25">{L(label)}</p>
            {group.map((m) => (
              <TermRow key={m} mono={m} value={coeffs[m]} L={L} movableSet={movableSet} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Expression({ expr, basePanel, curPanel, L, panelSymbols }) {
  const never = expr.coeffs.never || {};
  const crit = expr.coeffs.crit || {};
  const ampNever = expr.coeffs.ampNever || [];
  const ampCrit = expr.coeffs.ampCrit || [];
  const emMatters = emMattersIn(expr);
  const movableSet = new Set(['C', 'R', ...panelSymbols, ...(emMatters ? ['E'] : [])]);
  // The panel's own variables AT THE WORN BUILD, so the master formula can be
  // shown as ARITHMETIC and not just as symbols: the weights and the per-group
  // contributions are what turn the abstract Sigma into something checkable.
  const cv = curPanel ? variablesOf(curPanel) : null;
  const R = cv ? cv.R : 0;
  const at = cv ? damageAt(expr, cv) : null;
  const neverVal = at?.never ?? null;
  const critVal = at?.crit ?? null;
  const groupVals = expr.coeffs.avgGroups.map((g) => {
    const mu = Math.min(R + g.crBuff, 100) / 100;
    const baseDelta = cv ? evaluate(g.delta, cv) : null;
    const ampDelta = cv ? evaluateAmp(g.amp, cv) : null;
    const df = cv ? baseDelta + ampDelta : null;
    return { ...g, mu, df, contrib: cv ? mu * df : null };
  });
  const avgVal = at?.avg ?? null;
  return (
    <details open className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
      <summary className="cursor-pointer text-[11px] font-bold text-white/80">
        {L({ chs: '合并后的伤害表达式', en: 'Merged damage expression' })}
        <span className="ml-2 font-normal text-white/35">
          {L({
            chs: expr.entries + ' 个伤害条目 · ' + expr.parts + ' 段 → 一个关于面板的多项式',
            en: expr.entries + ' entries · ' + expr.parts + ' parts → one polynomial of the panel',
          })}
        </span>
      </summary>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.06] bg-white/[0.015] px-2 py-1.5">
        <span className="text-[9px] text-white/30">{L({ chs: '面板变量', en: 'panel' })}</span>
        {[...panelSymbols, 'U', 'P', 'G', 'C', 'R', ...(emMatters ? ['E'] : [])].map((s) => (
          <Var key={s} sym={s} L={L} size={13} movableSet={movableSet} />
        ))}
        <span className="ml-auto text-[9px] text-white/30">
          {L({
            chs: panelSymbols.map((s) => s + ' = ' + {
              A: '基础攻击 x (1 + 攻击力% / 100) + 固定攻击',
              H: '基础生命 x (1 + 生命值% / 100) + 固定生命',
              D: '基础防御 x (1 + 防御力% / 100) + 固定防御',
              M: '元素精通',
            }[s]).join('；'),
            en: panelSymbols.map((s) => s + ' = ' + {
              A: 'base ATK x (1 + ATK% / 100) + flat ATK',
              H: 'base HP x (1 + HP% / 100) + flat HP',
              D: 'base DEF x (1 + DEF% / 100) + flat DEF',
              M: 'Elemental Mastery',
            }[s]).join('; '),
          })}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-white/45">
        <span className="text-[#7fd4c1]">■</span>{' '}
        {L({
          chs: '亮色的会被副词条推动（' + panelSymbols.map((s) => ({ A: '攻击力', H: '生命值', D: '防御力', M: '元素精通' }[s])).join('、')
            + '、暴击率、暴伤'
            + (emMatters ? '、元素精通' : '')
            + '）；风伤 / 火伤 / 增伤不在副词条池里，本次搜索中是常数——只由它们组成的项对所有候选都一样，不决定谁更优。',
          en: 'Teal quantities are what a substat roll moves (' + panelSymbols.map((s) => ({ A: 'ATK', H: 'HP', D: 'DEF', M: 'EM' }[s])).join(', ')
            + ', CRIT Rate, CRIT DMG'
            + (emMatters ? ', EM' : '')
            + '). Anemo / Pyro / generic DMG bonus is not in the substat pool, so it is constant here and a term built only from those is the same for every candidate.',
        })}
      </p>

      <p className="mt-2 mb-1 flex flex-wrap items-baseline gap-x-2 text-[10px] text-white/45">
        <span className="text-white/70">{'D = Σ 系数 x 单项式'}</span>
        {DEGREES.map(({ n, label }) => {
          const c = MONO_ORDER.filter((m) => monoFactors(m).length === n
            && ((Number(never[m]) || 0) || (Number(crit[m]) || 0))).length;
          return c ? (
            <span key={n} className="rounded border border-white/[0.08] px-1.5 py-[1px] text-white/55">
              {L(label) + ' ' + c}
            </span>
          ) : null;
        })}
      </p>

      {/* ---- THE WHOLE FORMULA FIRST, THEN ITS PARTS ----
          The panel only reads in this order. A reader needs the SHAPE
          (expected = a base + weighted crit increments) before any coefficient
          list means anything, and `f_never` on its own says nothing about why a
          term with no crit rate, no crit dmg is even there. So the master formula
          and what each symbol IS come first, with the numbers filled in at the
          panel currently on screen; only then do f_never / f_crit / the groups. */}
      <div className="mt-2 rounded-lg border border-white/[0.12] bg-white/[0.04] p-2.5">
        <p className="text-[11px] font-bold text-white/85">
          {L({ chs: '总式：期望伤害', en: 'The whole formula: expected damage' })}
        </p>
        <p className="mt-1 text-[13px] font-bold tabular-nums text-[#7fd4c1]">
          {'f_avg = f_never + Σ min(R + ΔR, 100) / 100 x Δf'}
        </p>
        {expr.hasAmp && (
          <p className="mt-1 rounded border border-[#7fd4c1]/15 bg-[#7fd4c1]/[0.05] px-2 py-1 text-[9px] leading-relaxed text-white/55">
            {L({
              chs: '蒸发 / 融化项：反应系数随精通变化，单项写为 em(E + B) x (多项式)，其中 em = 1 + 2.78(E + B) / (E + B + 1400)。B 是该行自带的精通增益。上面的 f_never、f_crit、Δf 已经包含这部分。',
              en: 'Vaporize / Melt terms: the reaction factor varies with EM, so a term is em(E + B) x polynomial, where em = 1 + 2.78(E + B) / (E + B + 1400) and B is the row\'s own EM buff. f_never, f_crit and Δf above already include it.',
            })}
          </p>
        )}
        {expr.hasTransformative && (
          <p className="mt-1 rounded border border-amber-300/15 bg-amber-300/[0.05] px-2 py-1 text-[9px] leading-relaxed text-white/55">
            {L({
              chs: '剧变反应项：超载 / 超导 / 扩散 / 感电 / 燃烧 / 绽放的伤害是额外一段，防御区恒为 1，不暴击、不吃增伤。单项写为常数 + 权重 × T(E + B)，其中 T = 16(E + B) / (E + B + 2000)，B 是该行自带的精通增益。',
              en: 'Transformative reactions: Overloaded / Superconduct / Swirl / Electro-Charged / Burning / Bloom add a separate hit with DEF zone = 1; it cannot crit and ignores DMG bonus. A term is constant + weight x T(E + B), where T = 16(E + B) / (E + B + 2000) and B is the row EM buff.',
            })}
          </p>
        )}
        <ul className="mt-1.5 grid grid-cols-1 gap-y-0.5 text-[9px] leading-snug text-white/50 sm:grid-cols-2 sm:gap-x-4">
          <li>
            <span className="font-semibold text-white/70">{'f_never'}</span>
            {L({
              chs: '：每条目取「不暴击」（暴击因子 = 1）后的总和 —— 不含暴击率、不含暴伤。就是下面的第一个表。',
              en: ': every entry with crit factor = 1 (no crit) -- no CRIT Rate, no CRIT DMG. The first table below.',
            })}
          </li>
          <li>
            <span className="font-semibold text-white/70">{'f_crit'}</span>
            {L({
              chs: '：同一批条目取「必定暴击」（暴击因子 = 1 + 暴伤 / 100）后的总和，是 Δf 的参照。',
              en: ': the same entries with crit factor = 1 + CRIT DMG / 100; the reference Δf is measured against.',
            })}
          </li>
          <li>
            <span className="font-semibold text-white/70">{'Δf = f_crit - f_never'}</span>
            {L({
              chs: '：暴击带来的增量，按每行的暴击率增益 ΔR 分组，各给一个 Δf。',
              en: ': the crit increment, grouped by each row CRIT Rate buff ΔR; one Δf per group.',
            })}
          </li>
          <li>
            <span className="font-semibold text-white/70">{'min(R + ΔR, 100) / 100'}</span>
            {L({
              chs: '：该组真正吃到暴击的权重（暴击率），超过 100% 被截断。',
              en: ': the weight (CRIT Rate) that group crits at, clamped at 100%.',
            })}
          </li>
        </ul>
        {avgVal != null && (
          <p className="mt-2 border-t border-white/[0.08] pt-1.5 text-[9px] leading-relaxed tabular-nums text-white/50">
            {L({ chs: '以当前面板代入：', en: 'at the current panel: ' })}
            {'f_avg = ' + fmtCoef(neverVal)}
            {groupVals.map((g) => ' + (' + g.mu.toFixed(4) + ' x ' + fmtCoef(g.df) + ')').join('')}
            {' = ' + fmtCoef(avgVal)}
          </p>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3">
        <CoeffList
          title={L({ chs: '子项 f_never（不暴击）', en: 'part f_never (never crits)' })}
          sub={L({ chs: '总式第一项：暴击因子 = 1', en: 'first term: crit factor = 1' })}
          coeffs={never} L={L} movableSet={movableSet}
        />
        <CoeffList
          title={L({ chs: '子项 f_crit（必定暴击）', en: 'part f_crit (always crits)' })}
          sub={L({ chs: 'Δf 的参照：暴击因子 = 1 + 暴伤 / 100', en: 'the Δf reference: crit factor = 1 + CRIT DMG / 100' })
            + (critVal != null ? ' · ' + fmtCoef(critVal) : '')}
          coeffs={crit} L={L} movableSet={movableSet}
        />
      </div>

      {expr.hasAmp && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-[10px] font-bold text-white/70">
              {L({ chs: '反应子项：不暴击', en: 'Reaction part: never crits' })}
            </p>
            {ampNever.map((g) => (
              <div key={'n' + g.emBuff} className="mb-1">
                <CoeffList
                  title={'em(E + ' + g.emBuff + ') x P_never'}
                  sub={L({ chs: '行上精通增益 B = ' + g.emBuff, en: 'row EM buff B = ' + g.emBuff })}
                  coeffs={g.coeffs} L={L} movableSet={movableSet}
                />
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-bold text-white/70">
              {L({ chs: '反应子项：必定暴击', en: 'Reaction part: always crits' })}
            </p>
            {ampCrit.map((g) => (
              <div key={'c' + g.emBuff} className="mb-1">
                <CoeffList
                  title={'em(E + ' + g.emBuff + ') x P_crit'}
                  sub={L({ chs: '行上精通增益 B = ' + g.emBuff, en: 'row EM buff B = ' + g.emBuff })}
                  coeffs={g.coeffs} L={L} movableSet={movableSet}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-white/[0.06] pt-2">
        <p className="text-[10px] leading-relaxed text-white/50">
          <span className="font-semibold text-white/70">{L({ chs: '总式 Σ 后面的每一项：Δf 分组', en: 'each Σ term in the formula above: the Δf groups' })}</span>
          {L({
            chs: '。每行的暴击率增益不同、100% 封顶的拐点也不同（R = 100 - ΔR），所以不能并成一项，按 ΔR 分组；每组的 Δf = 该组行上的 f_crit - f_never。',
            en: '. Each row caps at a different CRIT Rate (R = 100 - ΔR), so they cannot merge into one; they are grouped by ΔR, and each group Δf = f_crit - f_never over that group of rows.',
          })}
        </p>
        {groupVals.map((g) => (
          <details key={g.crBuff} className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.015] p-2">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 text-[10px] text-white/60">
              <span>{'ΔR = +' + g.crBuff + '% '}
                {L({ chs: '行上暴击率', en: 'row CRIT Rate buff' })}</span>
              <span className="tabular-nums text-white/40">
                {'权重 min(R + ΔR, 100) / 100 = ' + g.mu.toFixed(4)}
              </span>
              {g.contrib != null && (
                <span className="tabular-nums text-white/40">
                  {'贡献 = ' + fmtCoef(g.contrib)}
                </span>
              )}
              <span className="ml-auto text-white/30">
                {MONO_ORDER.filter((m) => Number(g.delta?.[m]) || 0).length + ' ' + L({ chs: '项', en: 'terms' })}
              </span>
            </summary>
            <div className="mt-1">
              <CoeffList
                title={'Δf'} sub={'ΔR = +' + g.crBuff + '%'} coeffs={g.delta}
                L={L} movableSet={movableSet}
              />
              {g.amp?.map((a) => (
                <div key={'a' + a.emBuff} className="mt-1 rounded-lg border border-white/[0.05] p-2">
                  <CoeffList
                    title={'em(E + ' + a.emBuff + ') x ΔP'}
                    sub={L({ chs: 'ΔR = +' + g.crBuff + '%，行上精通增益 B = ' + a.emBuff, en: 'ΔR = +' + g.crBuff + '%, row EM buff B = ' + a.emBuff })}
                    coeffs={a.coeffs} L={L} movableSet={movableSet}
                  />
                </div>
              ))}
            </div>
          </details>
        ))}
        {expr.warnings.map((w) => (
          <p key={w.code} className="mt-1 text-[10px] text-amber-300/80">
            {w.code}
            {w.keys ? ': ' + w.keys.join(', ') : ''}
            {w.detail ? ' — ' + w.detail : ''}
          </p>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-white/45">
        <div>
          {L({ chs: '搜索基线（去掉副词条）', en: 'Search baseline (substats removed)' })}
          {': ' + panelText(basePanel, panelSymbols) + ' , 暴击率=' + fmt(basePanel?.critRate, 2) + '% , 暴伤=' + fmt(basePanel?.critDmg, 2) + '%'}
        </div>
        <div>
          {L({ chs: '当前面板', en: 'Current panel' })}
          {': ' + panelText(curPanel, panelSymbols) + ' , 暴击率=' + fmt(curPanel?.critRate, 2) + '% , 暴伤=' + fmt(curPanel?.critDmg, 2) + '%'}
        </div>
      </div>
    </details>
  );
}
