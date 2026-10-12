// The four substat rows of one artifact piece.

import { useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import {
  STAT_HINTS, newSubstat, statMeta, substatOptionsFor, withSubstat,
} from '../../../lib/artifact';
import { StatGlyph, StatMenu } from './StatGlyph';
import SubstatValueControl from './SubstatValue';

/**
 * The substat list for one slot: up to four rows, each filled or empty.
 *
 * The value IS editable, unlike the main stat: these numbers are the user's and
 * cannot be derived, because a substat's value depends on the roll. The field
 * therefore keeps free typing, but offers the LEGAL values for the stat at this
 * piece's rarity through `SubstatValueControl` -- typing a number the game cannot
 * roll would quietly corrupt every total built from it. See `substat-rolls.js`.
 *
 * Only one picker is open at a time; `openIndex` is owned here because the
 * choice is local to this piece.
 *
 * @param {object}   piece        The slot's model.
 * @param {number}   rarity       This piece's rarity in stars (3/4/5).
 * @param {Function} onChange     Called with the patched piece.
 * @param {Function} onOpenChange Notifies the slot so it can close the main-stat
 *                                menu when a substat menu opens.
 */
export default function SubstatsControl({ piece, rarity, onChange, onOpenChange }) {
  const { L } = useI18n();
  const [openIndex, setOpenIndex] = useState(null);

  // One ref per row, because whichever control opened the menu is the thing the
  // menu must be positioned against -- and that is either the filled row's stat
  // button or the empty row's `+`.
  const triggers = useRef([]);

  const setSub = (i, sub) => onChange(withSubstat(piece, i, sub));

  const toggle = (i) => {
    setOpenIndex((cur) => (cur === i ? null : i));
    onOpenChange?.(false);
  };

  // The main stat is excluded: the game will not roll a substat that repeats it.
  const options = substatOptionsFor(piece);

  return (
    <div className="flex w-full flex-col gap-1">
      {Array.from({ length: piece.subStats.length }, (_, i) => {
        const sub = piece.subStats[i];
        const meta = sub ? statMeta(sub.key) : null;
        return (
          <div key={i} className="relative">
            {sub ? (
              <div
                className="flex items-center gap-1 rounded-md border border-white/[0.12] py-[2px] pl-1.5 pr-1"
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
                }}
              >
                <button
                  ref={(el) => { triggers.current[i] = el; }}
                  type="button"
                  title={L({ chs: '更换词条', en: 'Change stat' })}
                  onClick={() => toggle(i)}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <StatGlyph stat={sub.key} size={13} />
                  <span className="min-w-0 flex-1 truncate text-[9px] text-white/70">
                    {L(meta)}
                  </span>
                </button>
                <SubstatValueControl
                  statKey={sub.key}
                  rarity={rarity}
                  value={sub.value}
                  suffix={meta?.suffix}
                  label={L(meta)}
                  onChange={(v) => setSub(i, { ...sub, value: v })}
                />
                <button
                  type="button"
                  title={L({ chs: '清除', en: 'Clear' })}
                  onClick={() => { setSub(i, null); setOpenIndex(null); }}
                  className="shrink-0 rounded px-0.5 text-[9px] leading-none text-white/20 transition-colors hover:text-white/70"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                ref={(el) => { triggers.current[i] = el; }}
                type="button"
                onClick={() => toggle(i)}
                title={L({ chs: '添加副词条', en: 'Add substat' })}
                className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-white/[0.07] px-1.5 py-[3px] transition-colors hover:border-white/25"
              >
                <span className="flex h-[14px] flex-1 items-center justify-center text-[10px] text-white/20">
                  +
                </span>
              </button>
            )}

            {openIndex === i && (
              <StatMenu
                // The ELEMENT that opened it: the filled row's stat button, or
                // the empty row's `+`. Each row has its own, which is why the
                // caller passes the node rather than a ref.
                anchor={triggers.current[i]}
                options={options}
                value={sub?.key}
                onClose={() => setOpenIndex(null)}
                onPick={(k) => { setSub(i, newSubstat(k)); setOpenIndex(null); }}
                onClear={sub ? () => { setSub(i, null); setOpenIndex(null); } : undefined}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
