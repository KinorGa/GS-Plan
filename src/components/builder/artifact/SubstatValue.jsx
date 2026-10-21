// The VALUE field of one substat row: free typing AND a picker of legal values.
//
// A substat's value is whatever the user rolled, so it must stay an editable
// number. But not every number is real -- the game only produces the totals in
// `substat-rolls.js`, and typing a figure the game cannot show silently poisons
// every damage total built from it. So the field keeps the text input and adds a
// caret that opens the list of LEGAL values for this stat at this rarity.
//
// FILTERED BY ROLL COUNT, not merely sectioned. A piece reaches a total by
// rolling the same line `n` times, and `n` is the thing the player is actually
// choosing between -- "is this a four-roll line or a six-roll line?". So the
// picker opens with 1次 .. 6次 across the top and shows ONLY the totals reachable
// with the selected count. (An earlier version listed every count at once in one
// long scroll; that answers no question the user has.)
//
// A total reachable by two counts appears under BOTH counts. That is correct:
// each tab answers "what can an n-roll line read?", they are not a partition.
//
// RARITY IS A PROP, not a constant. The same stat has different tier values at
// 3/4/5 stars, and the piece already knows its rarity through its set, so the
// picker is driven by that rather than assuming 5 stars.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../../i18n';
import {
  DEFAULT_RARITY, SUBSTAT_MAX_ROLLS, findLegal, legalTotals, rollCountsOf,
} from '../../../lib/substat-rolls';
import { useSubstatTable } from '../../../lib/substat-rolls-client';

/** `3` -> `3次`. */
const timesWord = (n) => `${n}次`;

/** The decompositions of `entry` that use EXACTLY `n` rolls: `T1 + T3 + T4`. */
function waysFor(entry, n) {
  return entry.entries
    .filter((w) => w.n === n)
    .map((w) => w.tiers.map((t) => `T${t}`).join(' + '));
}

export default function SubstatValueControl({ statKey, rarity = DEFAULT_RARITY, value, suffix, onChange, label }) {
  const { L } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);
  const [rect, setRect] = useState(null);

  const remoteTable = useSubstatTable(rarity);
  const entries = remoteTable?.stats?.[statKey]?.totals || legalTotals(statKey, rarity) || [];
  const match = findLegal(entries, value);
  // A typed value the game cannot show. Blank input is not "illegal", it is just
  // unfinished, so it does not get flagged.
  const typed = String(value ?? '').trim() !== '';
  const illegal = typed && !match;

  const maxN = remoteTable?.maxRolls ?? SUBSTAT_MAX_ROLLS[rarity] ?? 6;

  /** Every total reachable with EXACTLY `n` rolls, ascending. */
  const byN = useMemo(() => {
    const out = new Map();
    for (let n = 1; n <= maxN; n++) out.set(n, entries.filter((e) => rollCountsOf(e).includes(n)));
    return out;
  }, [entries, maxN]);

  /**
   * Which roll count the picker is showing.
   *
   * Opens on the count the current value came from, so re-opening lands on the
   * line the user is looking at rather than at 1次; falls back to the first count
   * that actually has values.
   */
  const defaultN = match ? rollCountsOf(match)[0] : (byN.get(1)?.length ? 1 : maxN);
  const [nFilter, setNFilter] = useState(defaultN);
  useEffect(() => { if (open) setNFilter(defaultN); /* eslint-disable-next-line */ }, [open]);

  const list = byN.get(nFilter) || [];

  // Placement mirrors StatMenu: measured from the trigger's viewport rect and
  // portalled, because the row lives inside two `overflow` ancestors and a glass
  // card that would otherwise clip or trap a positioned child.
  useEffect(() => {
    if (!open || !anchorRef.current) return;
    const place = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const MENU_W = 188;
      const availBelow = window.innerHeight - r.bottom;
      const availAbove = r.top;
      // Open toward whichever side is roomier, and spend all of that room.
      const flip = availAbove > availBelow;
      setRect({
        left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
        top: flip ? undefined : r.bottom + 4,
        bottom: flip ? window.innerHeight - r.top + 4 : undefined,
        maxHeight: Math.max(180, (flip ? availAbove : availBelow) - 12),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => {
      if (anchorRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={anchorRef} className="relative flex shrink-0 items-center gap-0.5">
      <input
        type="number"
        value={value}
        aria-label={label}
        title={illegal
          ? L({ chs: '该数值不是游戏可出现的合法值', en: 'Not a value the game can roll' })
          : label}
        onChange={(e) => onChange(e.target.value)}
        className="w-[44px] rounded border bg-black/30 px-1 py-[1px] text-right text-[10px] font-bold tabular-nums text-white outline-none transition-colors focus:bg-black/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style={{ borderColor: illegal ? 'rgba(251,191,36,0.55)' : 'rgba(255,255,255,0.08)' }}
      />
      {suffix && <span className="shrink-0 text-[9px] text-white/35">{suffix}</span>}
      <button
        type="button"
        title={L({ chs: '选择合法数值', en: 'Pick a legal value' })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="shrink-0 rounded px-0.5 text-[8px] leading-none text-white/30 transition-colors hover:text-white/80"
      >
        ▾
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          data-substat-values
          style={{ position: 'fixed', left: rect.left, top: rect.top, bottom: rect.bottom, maxHeight: rect.maxHeight }}
          className="z-[70] flex w-[188px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141418] shadow-2xl shadow-black/80"
        >
          {/* The filter: one button per roll count. Sticky, because the value list
              scrolls underneath it. */}
          <div className="flex shrink-0 gap-0.5 border-b border-white/10 p-1">
            {Array.from({ length: maxN }, (_, i) => i + 1).map((n) => {
              const on = n === nFilter;
              const count = byN.get(n)?.length ?? 0;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={!count}
                  title={`${timesWord(n)} · ${count}`}
                  onClick={() => setNFilter(n)}
                  className="flex-1 rounded-md py-1 text-[10px] font-bold tabular-nums transition-colors disabled:opacity-25"
                  style={{
                    backgroundColor: on ? 'rgba(127,212,193,0.18)' : 'transparent',
                    color: on ? '#7fd4c1' : 'rgba(255,255,255,0.55)',
                    boxShadow: on ? 'inset 0 0 0 1px rgba(127,212,193,0.5)' : undefined,
                  }}
                >
                  {timesWord(n)}
                </button>
              );
            })}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.length === 0 ? (
              <p className="px-2 py-1.5 text-[10px] text-white/35">
                {L({ chs: '该次数无合法值', en: 'No legal values' })}
              </p>
            ) : list.map((entry) => {
              const on = entry === match && rollCountsOf(entry).includes(nFilter);
              const ways = waysFor(entry, nFilter);
              return (
                <button
                  key={entry.m}
                  type="button"
                  title={`${ways.join('\n')}\n（${timesWord(nFilter)}）`}
                  onClick={() => { onChange(String(entry.value)); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-[3px] text-left transition-colors hover:bg-white/[0.07]"
                  style={{ backgroundColor: on ? 'rgba(127,212,193,0.16)' : undefined }}
                >
                  <span className="text-[10px] font-bold tabular-nums text-white">
                    {entry.value}{suffix && <span className="font-normal text-white/40">{suffix}</span>}
                  </span>
                  <span className="shrink-0 text-[8px] text-white/25">{ways[0]}</span>
                </button>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-white/10 px-1.5 py-1 text-[9px] text-white/30">
            {L({ chs: 'T1~T4 为四档，0.7/0.8/0.9/1.0 倍', en: 'T1~T4 = 0.7/0.8/0.9/1.0 tiers' })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
