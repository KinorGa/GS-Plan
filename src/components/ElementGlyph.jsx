// The element vocabulary, and the two controls that use it.
//
// WHY THIS IS ITS OWN MODULE
//   Both `DamageEntry` (a collapsed row's damage-type mark) and `EntryGroup` (the
//   element picker on a part of a compound row) need to draw an element the same
//   way. `DamageCard` keeps its own `ElementIcon` private, and importing across
//   those two would be circular -- `EntryGroup` renders `DamageEntry`. So the
//   glyph lives here, where both can reach it.
//
// THE ICONS ARE BLACK STENCILS, verified by decoding them: every file in
// `img/icons/` is a single flat colour (1 distinct colour, average rgb(0,0,0)),
// so drawing one untinted is invisible on a near-black panel. The tinting trick
// is the one `game.js` documents: the source is pushed out of a clipping box by a
// flat coloured copy of itself.
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { iconImg, ICON_WHITE, elementOf } from '../game';

/**
 * The damage types a hit can carry, in the order the game lists them.
 *
 * Physical is included and is NOT in `game.js`'s `ELEMENTS` -- it is a damage
 * type, not an element -- so it needs its own glyph and its own label rather than
 * a lookup that would fall through to `unknown`.
 */
export const DAMAGE_TYPE_OPTIONS = [
  ['Pyro', { chs: '火', en: 'Pyro' }],
  ['Hydro', { chs: '水', en: 'Hydro' }],
  ['Cryo', { chs: '冰', en: 'Cryo' }],
  ['Electro', { chs: '雷', en: 'Electro' }],
  ['Anemo', { chs: '风', en: 'Anemo' }],
  ['Geo', { chs: '岩', en: 'Geo' }],
  ['Dendro', { chs: '草', en: 'Dendro' }],
  ['Physical', { chs: '物理', en: 'Physical' }],
];

/** The label for a damage type, or `null` when nothing is set. */
export const damageTypeLabel = (value) =>
  DAMAGE_TYPE_OPTIONS.find(([k]) => k === value)?.[1] || null;

/**
 * A damage type drawn as its tinted silhouette.
 *
 * An UNSET or unknown type draws the neutral blade, which is what the damage card
 * uses for "no element" -- deliberately not an element's mark, because claiming
 * one would state something the data does not.
 */
export function ElementGlyph({ element, size = 16 }) {
  if (element === 'Physical') {
    return (
      <img
        src={iconImg('physical')}
        alt=""
        style={{ width: size, height: size, filter: ICON_WHITE, opacity: 0.85 }}
      />
    );
  }
  const e = element ? elementOf(element) : null;
  if (!e || e.icon === 'unknown') {
    return (
      <img
        src={iconImg('atk_base')}
        alt=""
        style={{ width: size, height: size, filter: ICON_WHITE, opacity: 0.7 }}
      />
    );
  }
  return (
    <span style={{ width: size, height: size, overflow: 'hidden', display: 'inline-block' }}>
      <img
        src={iconImg(e.icon)}
        alt=""
        style={{
          width: size,
          height: size,
          display: 'block',
          filter: `drop-shadow(${e.color} 0px -${size}px 0px)`,
          transform: `translateY(${size}px)`,
        }}
      />
    </span>
  );
}

/**
 * Pick the damage type one part of a compound row carries.
 *
 * AN ICON BUTTON THAT OPENS A PORTALLED GRID, matching how the rest of the app
 * picks an element. It was a native `<select>`, which was wrong for this UI rather
 * than merely plain: the browser paints its option list in the SYSTEM colours, so
 * on this near-black panel it opened as a light-blue dropdown that ignored the
 * theme and showed text where every other element control shows a glyph.
 *
 * PORTALLED for the reason `StatMenu` in the artifact builder documents: the entry
 * sits inside an axis whose ancestors clip, so an `absolute` menu is cut off.
 *
 * An UNSET type is a real state and reads as a dashed amber `未指定` -- the same
 * "needs an answer" colour the card uses for a manual override -- rather than
 * borrowing an element's mark.
 */
/**
 * `showLabel` off is for a DENSE ROW -- a table of hundreds, where "元素" repeated
 * on every line is noise. The control still shows the glyph and reads correctly;
 * it just stops restating its own column header.
 */
export function ElementPicker({ value, onChange, L, showLabel = true }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const label = damageTypeLabel(value);

  return (
    <span
      className="flex shrink-0 items-center gap-1"
      // The parent row is a drag target in places; a click on this control must
      // not also start whatever the ancestor does with a click.
      onClick={(e) => e.stopPropagation()}
    >
      {showLabel && <span className="text-[10px] text-white/35">{L({ chs: '元素', en: 'Element' })}</span>}
      <button
        ref={anchorRef}
        type="button"
        data-part-element={value || ''}
        onClick={() => setOpen((o) => !o)}
        title={value ? L(label) : L({ chs: '选择这一段是什么元素', en: "Pick this part's element" })}
        className={`flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors ${
          value
            ? 'border-white/[0.14] hover:border-white/25'
            : 'border-dashed border-amber-400/50 bg-amber-400/10 hover:border-amber-300'
        }`}
        style={{
          background: value
            ? 'linear-gradient(180deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.03) 100%)'
            : undefined,
        }}
      >
        {value ? (
          <>
            <ElementGlyph element={value} size={14} />
            <span className="text-[10px] font-medium text-white/85">{L(label)}</span>
          </>
        ) : (
          <span className="text-[10px] font-semibold text-amber-300">
            {L({ chs: '未指定', en: 'not set' })}
          </span>
        )}
        <span className="text-[8px] text-white/30">▾</span>
      </button>

      {open && (
        <ElementMenu
          anchor={anchorRef.current}
          value={value}
          onPick={(k) => { onChange(k); setOpen(false); }}
          onClose={() => setOpen(false)}
          L={L}
        />
      )}
    </span>
  );
}

/**
 * The damage-type grid, portalled to the body.
 *
 * Placement follows `StatMenu`: measured from the trigger's viewport rect, flipped
 * above when there is no room below, and clamped horizontally so a menu on a
 * right-hand row does not run off the edge.
 */
function ElementMenu({ anchor, value, onPick, onClose, L }) {
  const menuRef = useRef(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const MENU_W = 200;
      const MENU_H = 116;
      const below = window.innerHeight - r.bottom;
      setRect({
        left: Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8)),
        top: below < MENU_H && r.top > MENU_H ? r.top - MENU_H - 4 : r.bottom + 4,
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

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
      data-element-menu
      style={{ position: 'fixed', left: rect.left, top: rect.top }}
      className="z-[70] w-[200px] rounded-xl border border-white/10 bg-[#141418] p-2 shadow-2xl shadow-black/80"
    >
      <div className="grid grid-cols-4 gap-1">
        {/* Destructured as `[key, label]`: the entries are PAIRS. Writing this as
            `([k]) =>` read the first CHARACTER of each key, so every option became
            `P`/`H`/`C`..., the lookup fell through to `unknown`, and the whole grid
            drew the same white blade with a one-letter label. */}
        {DAMAGE_TYPE_OPTIONS.map(([k, label]) => {
          const on = k === value;
          return (
            <button
              key={k}
              type="button"
              data-element-option={k}
              title={L(label)}
              aria-label={L(label)}
              aria-pressed={on}
              onClick={() => onPick(k)}
              className="flex h-[42px] flex-col items-center justify-center gap-0.5 rounded-md border transition-colors"
              style={{
                borderColor: on ? '#7fd4c1' : 'rgba(255,255,255,0.10)',
                backgroundColor: on ? 'rgba(127,212,193,0.14)' : 'transparent',
              }}
            >
              <ElementGlyph element={k} size={15} />
              <span className="text-[9px] text-white/60">{L(label)}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPick(null)}
        className="mt-1.5 w-full rounded-md border border-white/10 py-1 text-[10px] text-white/40 transition-colors hover:border-white/30 hover:text-white/80"
      >
        {L({ chs: '清除（未指定）', en: 'Clear (not set)' })}
      </button>
    </div>,
    document.body
  );
}
