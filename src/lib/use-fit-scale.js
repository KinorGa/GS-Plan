import { useEffect, useState } from 'react';

/**
 * Track a box's rendered width and return the factor needed to fit a
 * fixed-size element inside it.
 *
 * The damage card is an intrinsically 1320x470 panel. Placing it in a narrow
 * column means it must be scaled down visually — and `transform: scale()` is
 * the only correct tool, because it leaves layout alone. `zoom` would instead
 * re-lay-out the card against the narrow column first, collapsing its four
 * columns on top of each other.
 *
 * The factor is clamped at 1 so the card is never blown up past its real size.
 */
export function useFitScale(ref, intrinsicWidth, active = true) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    // `active` IS LOAD-BEARING, not an optimisation.
    //
    // The measured element is the collapsed entry's box, which only EXISTS while
    // the entry is expanded -- `DamageEntry` returns the collapsed row instead of
    // mounting the card. An effect keyed on `[ref, intrinsicWidth]` alone runs
    // once, at mount, when `ref.current` is still null; the early return below
    // fires, the effect never re-runs, and `scale` stays at its initial 1 for the
    // entire time the card is open. The 1320px panel is then drawn at full size
    // inside a narrower `overflow-hidden` box and the right-hand 伤害类型 column
    // is silently cut off. Measured on the unmodified tree: box 1095, content
    // 1320, heading 224px past the edge.
    //
    // Passing the expanded flag makes the effect re-run when the box appears.
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / intrinsicWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Again after layout has certainly settled: a ResizeObserver only fires on a
    // CHANGE, so a measurement that is already wrong and stays wrong would never
    // be revisited.
    const raf = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref, intrinsicWidth, active]);

  return scale;
}
