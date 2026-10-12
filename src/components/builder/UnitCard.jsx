// One configured team member.
//
// WHAT IT SHOWS
//   Character (with level), weapon (with refinement), constellations, and the
//   three talent levels. Every choice is made through pictures; the only text
//   is the character's name, which no amount of art can replace when two
//   characters look alike.
//
// IT IS A SELECT TARGET
//   Clicking the card selects it, which is what points the artifact row below at
//   this unit. The card itself carries that handler; every interactive child is
//   wrapped in `stop` so nudging a stepper does not also change the selection.
//
// ITS `value` IS A WHOLE UNIT FROM THE TEAM DOCUMENT
//   `{ id, char: { id, level, constellation, talents }, weapon: { id, refine },
//     artifacts }` -- see `lib/team-model.js`. The card reads and writes a
//   subset, but the shape is the document's, so no translation layer sits
//   between the UI and a save file.
//
// DESIGN NOTES, from reviewing the first version
//   - There is NO empty-slot card. A blank placeholder that cannot be
//     configured is a slot with nothing to say; the add button is the only
//     affordance needed.
//   - Constellations are their OWN six icons, lit on click, the way the game
//     shows them. Six generic dots said "4" but not "which 4", and each
//     constellation has a recognisable emblem.
//   - Refinement is a plain dropdown. Five labelled options do not need a
//     bespoke widget.
//   - Talent levels are a small numeric stepper, not fifteen pips. The pips
//     read as a progress bar and three stacked rows dominated the card.
//   - Character level is present and derived from the character's own
//     attributes table, so the ascension phase shown is the real one.

import { useMemo, useState } from 'react';
import {
  elementOf, weaponOf, qualityOf, nameOf, charImg, iconImg, avatarImg,
  weaponIconImg, talentIconImg, ICON_WHITE,
} from '../../game';
import { useI18n } from '../../i18n';
import {
  useCatalogue, useCharacterDetail, weaponIconName, constellationsOf,
  ascensionPhaseFor, REFINE_OPTIONS, CHAR_LEVEL_MIN, CHAR_LEVEL_MAX,
  CHAR_LEVEL_STEP, TALENT_MIN, TALENT_MAX,
} from '../../lib/catalogue';
import {
  NumberStepper, ConstellationRow, SelectMenu,
} from './controls';
import WeaponPicker from './WeaponPicker';

/* -------------------------------------------------------------------- card */

export default function UnitCard({ value, onChange, onRemove, selected = false, onSelect }) {
  const { lang, L } = useI18n();
  const { catalogue } = useCatalogue();
  const [openWeapon, setOpenWeapon] = useState(false);
  const char = value.char?.id ? catalogue?.chars?.[value.char.id] : null;
  const weapon = value.weapon?.id ? catalogue?.weapons?.[value.weapon.id] : null;

  // Shared cache: the detail file supplies both the talent icons and the
  // constellations, and two cards showing the same character used to fetch it
  // twice. See `loadCharacterDetail`.
  const detail = useCharacterDetail(value.char?.id, lang);

  const cons = useMemo(() => constellationsOf(detail), [detail]);
  const icons = detail?.skills || {};
  const phase = ascensionPhaseFor(detail, value.char?.level);

  // Nothing to draw without a character. Returning null rather than a
  // placeholder card: an empty slot has no state to show and the add button
  // already covers the affordance.
  if (!value.char?.id || !char) return null;

  const el = elementOf(char.element);
  const wq = weaponOf(char.weaponType);
  const q = qualityOf(char.qualityType);
  const patch = (p) => onChange({ ...value, char: { ...value.char, ...p } });

  return (
    // The CARD is the select target, so a click anywhere that is not another
    // control selects it. Interactive children stop propagation themselves (see
    // `stop`), because a nested button does not stop the event from reaching
    // this handler.
    <div
      data-unit-card
      data-unit-id={value.id}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(e) => {
        // Keyboard parity with the click, restricted to the card itself so
        // arrow keys and Enter inside the steppers keep working.
        if (!onSelect) return;
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
      }}
      aria-pressed={onSelect ? !!selected : undefined}
      // `shrink-0` and `snap-start` are load-bearing, not cosmetic. The card is
      // a flex child of the team's horizontal scroller, and a flex child
      // defaults to `shrink: 1` -- without `shrink-0` every card is squeezed
      // toward zero as more are added, so the row stops scrolling and the cards
      // pile on top of each other instead. (A wrapper div used to carry both;
      // removing the wrapper meant the card had to.)
      //
      // GLASS, not a solid panel with a coloured top strip. The strip was a 2px
      // bar in the rarity colour that fought the artwork for attention and made
      // every card read as a tag rather than a surface. The card now matches the
      // artifact row below it -- translucent over a blur, with a rarity-tinted
      // wash and a hairline highlight -- so the two halves of the panel share
      // one material. Rarity is still legible, from the wash, the stars and the
      // selection ring.
      className="group/card relative w-[368px] shrink-0 snap-start cursor-pointer overflow-hidden rounded-2xl border bg-white/[0.025] backdrop-blur-xl transition-all duration-200"
      style={{
        '--accent': q.color,
        borderColor: selected ? q.color : 'rgba(255,255,255,0.09)',
        boxShadow: selected
          ? `0 0 0 1px ${q.color}, 0 0 24px -6px ${q.color}aa, inset 0 1px 0 rgba(255,255,255,0.10)`
          : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* Rarity wash and a top hairline, both decorative and behind the content.
          The wash replaces the old solid accent strip: it carries the same
          colour, at a strength that tints the surface instead of banding it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(130% 100% at 12% 0%, ${q.color}30 0%, transparent 58%)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />

      {/* The card owns the width (see `w-[368px]` above) and this block fills
          it, so the border and the content cannot drift apart. The fixed width
          exists because the card is sized to its contents rather than to a grid
          cell: an earlier two-column layout was 584px wide with a 470px column
          holding ~250px of controls, leaving a third of every row empty.
          The width is what keeps the header block and the talent block below it
          sharing one right edge.
          `relative` puts the content above the decorative wash above it. */}
      <div className="relative flex w-full gap-2.5 p-2.5">
        {/* ------------------------------------------------------ portrait */}
        {/* Explicit height: without it this column stretched to the tallest
            sibling, so the portrait became a full-height strip and pushed the
            rest of the card out of its border.
            Cropped at 18% because the 2:5 card art puts the face high. */}
        <div className="flex w-[68px] shrink-0 flex-col gap-1.5 self-start">
          <div className="relative h-[84px] w-full overflow-hidden rounded-xl border border-white/10 bg-black">
            <img
              src={charImg(value.char.id)}
              alt={nameOf(char, lang)}
              className="h-full w-full object-cover object-[center_18%]"
              onError={(e) => { e.currentTarget.src = avatarImg(value.char.id); }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 pb-1">
              <ElementGlyph element={char.element} size={14} />
              <img
                src={iconImg(wq.icon)}
                alt=""
                style={{ width: 14, height: 14, filter: ICON_WHITE }}
                className="object-contain"
              />
            </div>
          </div>

          {/* Character level, under the portrait: it describes the character
              rather than the build, so it belongs with the art. The width is
              pinned so the level and the A-phase below it line up.
              Wrapped in `stop`: the stepper's buttons are inside the card, and
              without it every nudge would also toggle the selection. */}
          <span {...stop}>
            <NumberStepper
              value={value.char.level}
              min={CHAR_LEVEL_MIN}
              max={CHAR_LEVEL_MAX}
              step={CHAR_LEVEL_STEP}
              tint={q.color}
              width="w-6"
              onChange={(level) => patch({ level })}
              label={L({ chs: '角色等级', en: 'Character level' })}
            />
          </span>
        </div>

        {/* -------------------------------------------------------- column */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13px] font-bold text-white">{nameOf(char, lang)}</h3>
            <span className="shrink-0 text-[10px] font-bold" style={{ color: q.color }}>
              {q.stars}★
            </span>
            {/* Ascension phase, derived from the level: only meaningful next to
                it, so it is a caption rather than its own control. */}
            <span className="shrink-0 text-[9px] text-white/30">A{phase}</span>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title={L({ chs: '移除', en: 'Remove' })}
                className="ml-auto shrink-0 rounded px-1 text-[11px] text-white/25 transition-colors hover:text-white/80"
              >
                ✕
              </button>
            )}
          </div>

          {/* ------------------------------------------------- weapon row */}
          {/* Full width of the column, so a long weapon name truncates rather
              than dragging the card wider. `stop` so opening the weapon picker
              does not also reselect the card. */}
          <div className="flex w-full items-stretch gap-1.5" {...stop}>
            <button
              type="button"
              onClick={() => setOpenWeapon(true)}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-1.5 py-1 text-left transition-colors hover:border-white/25"
            >
              {weapon ? (
                <img
                  src={weaponIconImg(weaponIconName(weapon.weaponIcon))}
                  alt=""
                  className="h-7 w-4 shrink-0 object-contain"
                />
              ) : (
                <span className="flex h-7 w-4 shrink-0 items-center justify-center text-[11px] text-white/25">
                  ?
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-[11px] font-medium text-white">
                  {weapon ? L({ chs: weapon.chsName, en: weapon.enName }) : L({ chs: '选择武器', en: 'Pick weapon' })}
                </span>
                {weapon?.ascensionStats?.atk != null && (
                  <span className="text-[9px] text-white/35">ATK {weapon.ascensionStats.atk}</span>
                )}
              </span>
            </button>

            {/* Refinement is a property OF the weapon, so it sits on the weapon
                row rather than as a peer of it. */}
            <SelectMenu
              value={value.weapon.refine}
              options={REFINE_OPTIONS}
              tint={q.color}
              onChange={(refine) => onChange({ ...value, weapon: { ...value.weapon, refine } })}
              label={L({ chs: '武器精炼', en: 'Refinement' })}
            />
          </div>

          {/* ------------------------------------------------ constellations */}
          <div {...stop}>
            <ConstellationRow
              icons={cons}
              value={value.char.constellation}
              onChange={(constellation) => patch({ constellation })}
              label={L({ chs: '命之座', en: 'Constellation' })}
            />
          </div>
        </div>
      </div>

      {/* Mounted at the card root, not inside the weapon row: it renders a
          full-screen modal, and nesting it in a 250px flex row made it inherit
          that row's stacking and clipping context. */}
      <WeaponPicker
        open={openWeapon}
        onClose={() => setOpenWeapon(false)}
        weaponType={char.weaponType}
        value={value.weapon.id}
        onPick={(weaponId) => onChange({ ...value, weapon: { ...value.weapon, id: weaponId } })}
      />

      {/* ------------------------------------------------------ talent rows */}
      {/* Same width as the block above (`w-full` inside a fixed-width card), so
          the divider and both sections share one right edge. */}
      <div className="relative flex w-full flex-col gap-1 border-t border-white/5 px-2.5 py-2" {...stop}>
        {TALENT_ROWS.map(({ stateKey, iconField, short }) => {
          const icon = icons[iconField]?.icon;
          return (
            <div key={stateKey} className="flex items-center gap-2">
              {icon ? (
                <img src={talentIconImg(icon)} alt="" className="h-5 w-5 shrink-0 object-contain" />
              ) : (
                // Holds the row's height while the detail file loads.
                <span className="h-5 w-5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-[10px] text-white/45">
                {L(short)}
              </span>
              <NumberStepper
                value={value.char.talents[stateKey]}
                min={TALENT_MIN}
                max={TALENT_MAX}
                tint="#7fd4c1"
                onChange={(v) => patch({ talents: { ...value.char.talents, [stateKey]: v } })}
                label={L({ chs: '天赋等级', en: 'Talent level' })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Props that keep a child's clicks from reaching the card's select handler.
 *
 * A nested button does NOT stop propagation on its own, so without this every
 * nudge of a stepper, every constellation click and every weapon pick would also
 * toggle the selection -- which reads as the artifact row jumping to another
 * character while you are editing.
 */
const stop = { onClick: (e) => e.stopPropagation() };

/**
 * The three talent rows, in the order the game lists them.
 *
 * `iconField` names the key inside the detail file's `skills` object and
 * `stateKey` the field inside the unit's `char.talents`, so the JSX above stays
 * a loop instead of three near-identical blocks.
 */
const TALENT_ROWS = [
  { stateKey: 'normal', iconField: 'normalattack', short: { chs: '普通攻击', en: 'Normal Attack' } },
  { stateKey: 'skill', iconField: 'elementalskill', short: { chs: '元素战技', en: 'Elemental Skill' } },
  { stateKey: 'burst', iconField: 'elementalburst', short: { chs: '元素爆发', en: 'Elemental Burst' } },
];

/* ------------------------------------------------------------ element glyph */

/**
 * The element icon drawn as a flat silhouette in the element's colour.
 *
 * Same clipping trick as CharacterArt: a `drop-shadow` throws a coloured copy
 * of the black stencil up by exactly its own height inside an overflow-hidden
 * box, so only the coloured copy is visible. `ICON_WHITE` cannot be used here
 * because the point is to show WHICH element it is, and white does not.
 */
function ElementGlyph({ element, size = 16 }) {
  const el = elementOf(element);
  return (
    <span style={{ width: size, height: size, overflow: 'hidden', display: 'inline-block' }}>
      <img
        src={iconImg(el.icon)}
        alt={element}
        style={{
          width: size,
          height: size,
          filter: `drop-shadow(${el.color} 0px -${size}px 0px)`,
          transform: `translateY(${size}px)`,
          display: 'block',
        }}
      />
    </span>
  );
}
