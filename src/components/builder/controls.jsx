// Small, reusable pieces for the team builder.
//
// Everything here is ICON-LED: the brief for this card was that a selected
// character, weapon, constellation, talent level and refinement should be
// readable at a glance from pictures rather than prose, so numbers appear as
// bare digits next to a glyph and labels are confined to tooltips.
//
// The exports are exactly the controls the builder uses:
//
//   NumberStepper      a value flanked by +/- , for a bounded range
//   ConstellationRow   six emblems, lit by clicking
//   SelectMenu         a native dropdown for a short fixed list
//   PickerModal        the shared shell both pickers mount in
//   PickerSearch       the search field inside that shell

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { talentIconImg } from '../../game';

/* ------------------------------------------------------------------ stepper */

/**
 * A compact numeric selector drawn as a value flanked by stepper arrows.
 *
 * Replaces the pip row this card used to draw for talent levels. Fifteen pips
 * per row communicated the number but read as a progress bar, and three of them
 * stacked dominated the card. A bare number with +/- is quieter and still needs
 * no typing.
 *
 * The value is rendered between the arrows rather than in a text input: the
 * range is small and bounded, so an invalid state is impossible without a
 * validation path.
 */
export function NumberStepper({ value, min = 1, max = 9, step = 1, onChange, tint = '#7fd4c1', label, width = 'w-8', disabled = false }) {
  /**
   * Clamp to the range, then snap to the step grid.
   *
   * The grid is anchored at `max`, not at `min`. For the character level
   * (1..90 step 10) anchoring at `min` produced 1, 11, 21 ... 81, 91, so three
   * presses of minus from 90 landed on 61 rather than 60 -- the numbers users
   * actually expect (10, 20 ... 90) are anchored at the top. Anchoring here
   * also keeps `max` always reachable, which anchoring at `min` did not.
   */
  const set = (delta) => {
    const raw = value + delta;
    const snapped = step === 1 ? raw : max - Math.round((max - raw) / step) * step;
    onChange(Math.max(min, Math.min(max, snapped)));
  };

  const btn =
    'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none transition-colors disabled:opacity-25';

  return (
    <div
      // `disabled` greys the whole control and blocks both buttons. Used when
      // there is nothing to step -- a level with no main stat behind it.
      className={`flex items-center gap-0.5 rounded-md border border-white/10 bg-white/[0.03] px-0.5 ${
        disabled ? 'opacity-30' : ''
      }`}
      title={label}
    >
      <button
        type="button"
        aria-label={`${label} -`}
        disabled={disabled || value <= min}
        onClick={() => set(-step)}
        className={`${btn} text-white/45 hover:bg-white/10 hover:text-white`}
      >
        −
      </button>
      <span
        className={`${width} text-center text-[12px] font-bold tabular-nums`}
        style={{ color: disabled ? 'rgba(255,255,255,0.35)' : tint }}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        disabled={disabled || value >= max}
        onClick={() => set(step)}
        className={`${btn} text-white/45 hover:bg-white/10 hover:text-white`}
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------- constellation row */

/**
 * The six constellations, drawn as their OWN icons and lit by clicking.
 *
 * This mirrors how the game presents them, and it is strictly more informative
 * than the six dots it replaces: each constellation has its own emblem, so the
 * row says WHICH ones are unlocked rather than merely how many. A player
 * recognises C1's shape at a glance.
 *
 * Clicking a lit icon at the current level deactivates it, so the row doubles
 * as a decrement control; clicking any icon sets the level to that icon.
 *
 * @param {Array}    icons     `[{ icon, name, description }]` for C1..C6.
 * @param {number}   value     How many are unlocked (0..6).
 * @param {Function} onChange  Called with the new count.
 */
export function ConstellationRow({ icons, value, onChange, label }) {
  const list = (icons || []).slice(0, 6);

  // The detail file has not loaded yet: show six unlit placeholders so the card
  // does not change height the moment it arrives.
  if (!list.length) {
    return (
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.02]" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5" title={label}>
      {list.map((c, i) => {
        const n = i + 1;
        const lit = n <= value;
        return (
          <button
            key={c.icon || n}
            type="button"
            title={c.name || `${label} ${n}`}
            aria-label={c.name || `${label} ${n}`}
            aria-pressed={lit}
            onClick={() => onChange(n === value ? n - 1 : n)}
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border transition duration-200"
            style={{
              borderColor: lit ? '#e8c37a' : 'rgba(255,255,255,0.12)',
              backgroundColor: lit ? 'rgba(232,195,122,0.14)' : 'rgba(255,255,255,0.02)',
              boxShadow: lit ? '0 0 10px rgba(232,195,122,0.35)' : 'none',
            }}
          >
            <img
              src={talentIconImg(c.icon)}
              alt=""
              loading="lazy"
              // Unlit constellations are dimmed and desaturated rather than
              // hidden: the row should still show what is available.
              className="h-full w-full object-contain p-1 transition-[opacity,filter] duration-200"
              style={{
                opacity: lit ? 1 : 0.28,
                filter: lit ? 'none' : 'grayscale(1) brightness(0.9)',
              }}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
          </button>
        );
      })}
      <span
        className="ml-0.5 w-8 shrink-0 text-[12px] font-bold tabular-nums"
        style={{ color: value > 0 ? '#e8c37a' : 'rgba(255,255,255,0.3)' }}
      >
        C{value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- modal shell */

/** A search box for long pickers (139 characters, 257 weapons). */
export function PickerSearch({ value, onChange, placeholder }) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="mb-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"
    />
  );
}

/**
 * The full-screen shell both pickers share.
 *
 * Extracted because the weapon picker used to be a 330px popover while the
 * character picker was an 860px modal, purely because they were written at
 * different times. Picking one of 250 weapons through a six-column popover is
 * the same task as picking one of 139 characters through a grid, so it gets the
 * same surface. Sharing the shell is what stops them drifting again.
 *
 * RENDERED THROUGH A PORTAL, and that is load-bearing rather than tidiness.
 * `position: fixed` covers the viewport only while no ancestor establishes a
 * containing block for it. The team card is glass -- `backdrop-filter: blur()` --
 * and `backdrop-filter` IS such a containing block, so a modal mounted inside the
 * card was laid out against the card's 368x225 box and clipped by its
 * `overflow-hidden`. Measured: the overlay came out 366x223 instead of covering
 * the 1400x900 viewport.
 *
 * A portal moves it to `document.body`, so the shell is a true overlay wherever
 * it is used from. This is why the CHARACTER picker always looked right -- it is
 * mounted by the team panel, which has no glass ancestor -- while the weapon and
 * artifact-set pickers, mounted inside cards, were trapped.
 *
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {string}   props.title      Heading text.
 * @param {number}   props.count      Shown beside the heading.
 * @param {ReactNode} props.controls  Search box, filters; rendered under the head.
 * @param {ReactNode} props.children  The scrollable grid.
 */
export function PickerModal({ open, onClose, title, count, controls, children, maxWidth = 'max-w-[980px]' }) {
  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Sized to FILL the viewport rather than sit inside it. The old
    // `max-h-[86vh]` plus a `mt-[5vh]` offset left roughly one and a half rows
    // of tiles visible on a 900px-tall window, which read as a broken truncated
    // list rather than a scrollable one. The panel now takes the available
    // height minus a small margin, so the grid gets the room.
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`flex max-h-[calc(100vh-2.5rem)] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f13]/95 shadow-2xl shadow-black/80 backdrop-blur-xl`}
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/8 p-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-white">{title}</h2>
            {count != null && <span className="text-[11px] text-white/35">{count}</span>}
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40 transition-colors hover:border-white/30 hover:text-white/80"
            >
              ✕
            </button>
          </div>
          {controls}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* -------------------------------------------------------------- select menu */

/**
 * A compact dropdown for a short, fixed option list (weapon refinement R1-R5).
 *
 * A native `<select>` rather than a custom popover: the list is five short
 * labels, the control is used once per card, and the native element brings
 * keyboard handling, type-ahead and mobile behaviour for free.
 */
export function SelectMenu({ value, options, onChange, label, tint }) {
  return (
    <div className="relative" title={label}>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full cursor-pointer appearance-none rounded-md border border-white/10 bg-white/[0.03] py-1 pl-2 pr-6 text-[11px] font-semibold text-white outline-none transition-colors hover:border-white/25 focus:border-white/35"
        style={{ color: tint || '#fff' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#141418] text-white">
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-white/35">
        ▾
      </span>
    </div>
  );
}
