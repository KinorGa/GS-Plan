// The main-stat control: a glyph, its name, and the value DERIVED from level.

import { useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import {
  ARTIFACT_LEVEL_MAX, MAIN_STATS, formatStat, mainStatValue, statMeta,
} from '../../../lib/artifact';
import { StatGlyph, StatMenu } from './StatGlyph';

/**
 * Main-stat picker for one slot.
 *
 * The TYPE is chosen; the VALUE is derived from that type plus the artifact's
 * level, so it is displayed rather than asked for. Showing an input here would
 * invite a number that contradicts the type -- a flat-HP flower reading 46.6%.
 *
 * @param {object}   piece     The slot's model.
 * @param {Function} onChange  Called with the patched piece.
 * @param {Function} onOpenChange  Lets the slot close the substat menu, since
 *                             only one popover may be open at a time.
 */
export default function MainStatControl({ slotKey, piece, onChange, onOpenChange }) {
  const { L } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);

  // No main stat chosen yet: the row is an EMPTY SLOT, not a stat with a value.
  // It used to always hold the slot's first legal stat, so a new build looked
  // filled in.
  const empty = !piece.mainStat;

  // `?? ARTIFACT_LEVEL_MAX` rather than a bare `piece.level`: a piece that
  // arrived without a level (from an import, or a partially built model) must
  // still show a value, and +20 is the level a finished artifact sits at.
  //
  // An EMPTY slot is the exception -- there is nothing to level, and showing a
  // value for a stat that does not exist is what the prefilled default did.
  const value = empty ? null : mainStatValue(piece.mainStat, piece.level ?? ARTIFACT_LEVEL_MAX);
  const meta = empty ? null : statMeta(piece.mainStat);

  const toggle = () => {
    setOpen((o) => !o);
    onOpenChange?.(false);
  };

  if (empty) {
    return (
      <div className="relative w-full">
        <button
          ref={anchorRef}
          type="button"
          onClick={toggle}
          data-main-stat-empty
          title={L({ chs: '选择主词条', en: 'Pick a main stat' })}
          className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-white/[0.12] px-1.5 py-[3px] transition-colors hover:border-white/25"
        >
          <span className="flex h-[18px] flex-1 items-center justify-center text-[10px] text-white/20">
            +
          </span>
        </button>

        {open && (
          <StatMenu
            anchor={anchorRef.current}
            options={MAIN_STATS[slotKey]}
            value={null}
            onClose={() => setOpen(false)}
            // Choosing a main stat also sets a level, because a stat at +0 has no
            // value and the user would otherwise see a chosen stat reading 0.
            onPick={(k) => { onChange({ ...piece, mainStat: k, level: ARTIFACT_LEVEL_MAX }); setOpen(false); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* The whole control is the anchor: either the name button or the chevron
          opens the menu, so both hang it off the same box. */}
      <div
        ref={anchorRef}
        className="flex w-full items-center gap-1.5 rounded-lg border border-white/[0.14] px-1.5 py-1 transition-colors"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.03) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10)',
        }}
      >
        <button
          type="button"
          onClick={toggle}
          title={L({ chs: '主词条', en: 'Main stat' })}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <StatGlyph stat={piece.mainStat} size={17} />
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white/85">
            {L(meta)}
          </span>
        </button>

        {/* `mainStatValue` returns null for a stat with no curve, and the field
            then reads an em dash rather than a guess. */}
        {value == null ? (
          <span className="shrink-0 text-[11px] font-bold text-white/25">—</span>
        ) : (
          <span className="shrink-0 text-[12px] font-bold tabular-nums text-white">
            {formatStat(value)}
            {meta.suffix && <span className="text-white/45">{meta.suffix}</span>}
          </span>
        )}

        <button
          type="button"
          onClick={toggle}
          title={L({ chs: '更换主词条', en: 'Change main stat' })}
          className="shrink-0 text-[8px] text-white/30"
        >
          ▾
        </button>
      </div>

      {open && (
        <StatMenu
          anchor={anchorRef.current}
          options={MAIN_STATS[slotKey]}
          value={piece.mainStat}
          onClose={() => setOpen(false)}
          onPick={(k) => { onChange({ ...piece, mainStat: k }); setOpen(false); }}
        />
      )}
    </div>
  );
}
