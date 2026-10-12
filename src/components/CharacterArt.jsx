import { charImg, iconImg, elementOf, weaponOf, nameOf, ICON_WHITE } from '../game';

/**
 * The portrait block used by both the character grid card and the damage card.
 *
 * Extracted from CharacterCard so the two views cannot drift apart: same art,
 * same scrim, same centred name + element/weapon icons, same hover zoom.
 *
 * `children` is rendered under the icons (the damage card uses it for the
 * Lv.90 caption); pass nothing for the plain grid card.
 *
 * Hover effects are driven by a NAMED group (`group/art`) declared on this
 * component's own root box, never by an unnamed ancestor `group`. Tailwind's
 * bare `group-hover:*` matches ANY `.group` ancestor, so on the damage card —
 * where the whole 1320px panel is `group` — mousing anywhere over the stat
 * sheet used to zoom the portrait and lift its caption. The named variant is
 * scoped to this box, so the animation fires only while the pointer is over
 * the art itself.
 */
export default function CharacterArt({
  id,
  char,
  lang,
  name,
  iconSize = 28,
  scrim = 'from-black via-black/25 to-transparent',
  rounded = 'rounded-xl',
  className = '',
  children,
}) {
  // `char` carries the element and weapon type. A caller that forgets a field
  // does not crash: `elementOf` and `weaponOf` both fall back to `unknown`, which
  // renders a grey "?" glyph. That is a SILENT failure -- the planner passed a
  // character object without `weaponType` and every damage card showed a "?"
  // where the weapon should be, with nothing in the console to say why.
  //
  // Both names are surfaced here so the next omission is visible while reading
  // the component rather than only in the rendered output.
  const el = elementOf(char?.element);
  const wq = weaponOf(char?.weaponType);
  const displayName = name || nameOf(char, lang);

  return (
    // `isolate` creates a stacking context and `overflow-hidden` does the
    // clipping. Both matter: a scaled child that gets promoted to its own
    // compositing layer (see will-change below) can otherwise paint outside
    // this box, which made the portrait visibly spill over its column.
    <div
      className={`group/art relative isolate overflow-hidden ${rounded} border border-white/5 bg-[#0a0a0a] ${className}`}
    >
      <img
        src={charImg(id)}
        alt={displayName}
        loading="lazy"
        decoding="async"
        // `scale-[1.0]` and a `group-hover:scale-*` both compile to the
        // `transform` shorthand, and Tailwind emits the base class last, so the
        // hover value never applied. Using the raw CSS `scale` property on both
        // sides avoids that clash. It must be a CLASS (not an inline style),
        // because an inline `scale` would outrank the hover rule.
        // `will-change: transform` keeps the layer on the GPU so the large
        // artwork is not re-rasterised mid-zoom.
        // The `group-hover/art:` variant (not bare `group-hover:`) is what
        // confines the zoom to a pointer that is actually over this box.
        style={{ willChange: 'transform' }}
        className="absolute inset-0 h-full w-full origin-[center_27%] scale-100 object-cover transition-[scale] duration-500 ease-out group-hover/art:[scale:1.1]"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />

      <div className={`absolute inset-0 bg-gradient-to-t ${scrim}`} />

      <div className="absolute inset-0 flex flex-col items-center justify-end p-2 text-center sm:p-3">
        <div className="flex w-full translate-y-2 flex-col items-center transition-transform duration-500 group-hover/art:translate-y-0">
          <h3 className="mb-1 text-base font-bold tracking-tight text-white drop-shadow-lg sm:mb-2 sm:text-[22px]">
            {displayName}
          </h3>

          <div className="mb-2 flex items-center gap-3 sm:mb-3 sm:gap-5">
            {/* The element icon is drawn as a flat silhouette in the element's
                colour: the original wraps the image in a clipping box and uses
                `drop-shadow(<colour> 0 -Npx 0)` to throw a coloured copy up by
                exactly the icon height, hiding the original artwork. */}
            <div style={{ width: iconSize, height: iconSize, overflow: 'hidden', display: 'inline-block' }}>
              <img
                src={iconImg(el.icon)}
                alt={char.element}
                style={{
                  width: iconSize,
                  height: iconSize,
                  filter: `drop-shadow(${el.color} 0px -${iconSize}px 0px)`,
                  transform: `translateY(${iconSize}px)`,
                  display: 'block',
                }}
              />
            </div>
            <img
              src={iconImg(wq.icon)}
              alt={wq.en}
              width={iconSize}
              height={iconSize}
              style={{ width: iconSize, height: iconSize, filter: ICON_WHITE }}
              className="object-contain"
            />
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
