// A stat's glyph, and the popover grid used to pick one.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconImg, ICON_WHITE } from '../../../game';
import { useI18n } from '../../../i18n';
import { STAT_ICONS, statMeta } from '../../../lib/artifact';

/**
 * The glyph for a stat.
 *
 * These icons are black stencils, so untinted they are invisible on this card.
 * `ICON_WHITE` flattens them to white, which is what the damage card already
 * does for the same glyphs -- the two views agree as a result.
 *
 * A stat with no glyph renders nothing rather than a broken-image box; the
 * caller lays out around it.
 */
export function StatGlyph({ stat, size = 16 }) {
  const icon = STAT_ICONS[stat];
  if (!icon) return null;
  return (
    <img
      src={iconImg(icon)}
      alt=""
      style={{ width: size, height: size, filter: ICON_WHITE }}
      className="object-contain"
      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
    />
  );
}

/**
 * A grid of stat glyphs, shown as a popover beside the control that opened it.
 *
 * There is no text: a stat is recognised by its mark, and the tooltip and
 * `aria-label` carry the name for anyone who needs it.
 *
 * ANCHORED TO ITS TRIGGER, PORTALLED TO THE BODY. The menu used to be an
 * `absolute` child of the control, which two ancestors then clipped -- measured
 * on the LAST substat row of the Sands:
 *
 *   the five-slot row      overflow-x-auto      cut 77px off an 86px menu
 *   the artifact panel     overflow-hidden      cut 64px
 *
 * so the menu appeared as a sliver below the panel, which is what a user sees as
 * "the dropdown is stuck inside the component". The panel is also glass
 * (`backdrop-filter`), which would trap a `fixed` child even without the
 * overflow.
 *
 * `anchor` is the ELEMENT that opened the menu, not a ref. A substat list has
 * four rows and each needs its own anchor, so the caller already holds the
 * elements; a ref object would only add a layer to unwrap, and a callback ref
 * would be unreadable from in here.
 *
 * @param {HTMLElement} anchor  The control the menu hangs off.
 * @param {string[]} options    Stat keys to offer. The caller has already removed
 *                              the ones the game forbids in that position.
 * @param {string}   value      The current key, drawn as selected.
 * @param {Function} onPick
 * @param {Function} [onClear]  Omitted where "no stat" is not a valid state.
 * @param {Function} [onClose]  Called when the menu should dismiss itself.
 */
export function StatMenu({ anchor, options, value, onPick, onClear, onClose }) {
  const { L } = useI18n();
  const menuRef = useRef(null);
  const [rect, setRect] = useState(null);

  /**
   * Place the menu against the trigger.
   *
   * Measured from the trigger's viewport rect rather than from a CSS offset,
   * because a portalled menu shares no coordinate space with it.
   */
  useEffect(() => {
    if (!anchor) return;

    const place = () => {
      const r = anchor.getBoundingClientRect();
      const MENU_W = 210;
      const MENU_H = 110;   // two rows of 40px buttons plus padding
      const below = window.innerHeight - r.bottom;

      setRect({
        // Clamped so a menu on the rightmost slot does not run off the edge.
        left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
        // Flipped ABOVE the trigger when it would not fit below, which is the
        // common case for the last substat row -- the one nearest the panel's
        // bottom edge, and the case that was reported.
        top: below < MENU_H && r.top > MENU_H ? r.top - MENU_H - 4 : r.bottom + 4,
      });
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  // Dismiss on Escape or a click outside. The menu is no longer a DOM descendant
  // of the trigger, so "inside" is checked against both boxes.
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
      data-stat-menu
      style={{ position: 'fixed', left: rect.left, top: rect.top }}
      className="z-[70] w-max rounded-xl border border-white/10 bg-[#141418] p-2 shadow-2xl shadow-black/80"
    >
      <div className="grid grid-cols-7 gap-1">
        {options.map((k) => {
          const meta = statMeta(k);
          const on = k === value;
          return (
            <button
              key={k}
              type="button"
              title={L(meta)}
              aria-label={L(meta)}
              aria-pressed={on}
              onClick={() => onPick(k)}
              className="flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
              style={{
                borderColor: on ? '#7fd4c1' : 'rgba(255,255,255,0.10)',
                backgroundColor: on ? 'rgba(127,212,193,0.14)' : 'transparent',
              }}
            >
              <StatGlyph stat={k} size={16} />
            </button>
          );
        })}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1.5 w-full rounded-md border border-white/10 py-1 text-[10px] text-white/40 transition-colors hover:border-white/30 hover:text-white/80"
        >
          {L({ chs: '清除', en: 'Clear' })}
        </button>
      )}
    </div>,
    document.body
  );
}
