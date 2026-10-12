// Buff card: a compact, icon-led card that presents ONE source
// (weapon / constellation / talent / normal attack / skill / burst / artifact
// set) together with every buff that source grants.
//
// Design contract — the unit of a card is the SOURCE, never a single stat:
//
//   source  ── the thing granting the buffs (1 per card)
//     └── buffs[]  ── 1..n rows, each one stat change
//                      { key, value, tag }
//
// A weapon with three separate effects is still ONE card with three rows.
//
// Collapsed, the card shows only the icon and where the buffs come from, so a
// character with twenty buffs stays readable as a dense grid. Hovering (or
// clicking, for touch and keyboard) expands it to reveal every buff row; an
// optional editor lets each value be edited in place.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { iconImg, talentImg, skillImg, itemImg, weaponIconImg, artifactIconImg, isStencilIcon } from '../game';
import { useI18n } from '../i18n';
import { weaponIconName } from '../lib/catalogue';
import { DAMAGE_TYPES, KEY_SUFFIX, TYPE_ZH } from '../lib/elements';
import { isFormula, resolve, partialAt, matchesFor } from '../lib/buff-formula';

/* ------------------------------------------------------------- icon specs */

/**
 * Where a source's icon file lives. Each source kind maps to one loader so the
 * card can be handed a bare icon name.
 *
 * THE WEAPON LOADER RENAMES ITS INPUT. `weaponlist.json` says
 * `UI_EquipIcon_Sword_Blunt` but the file on disk is
 * `UI_Gacha_EquipIcon_Sword_Blunt` -- a `Gacha_` infix the mirror inserts.
 *
 * This card used to pass the catalogue name straight to `weaponIconImg`, so
 * EVERY weapon in the pool and in the library editor requested a file that does
 * not exist and rendered no icon at all. The old demo fixture hid it by storing
 * already-renamed names; switching the pool to real catalogue ids exposed it.
 *
 * The rename lives in `lib/catalogue.js` as `weaponIconName`, and is applied
 * HERE rather than at each call site: a caller holding a catalogue entry has no
 * reason to know about the mirror's filename quirk.
 */
const ICON_LOADERS = {
  talent: talentImg,
  skill: skillImg,
  item: itemImg,
  icon: iconImg,
  // Real per-item artwork, used in preference to the generic glyphs: a weapon
  // shows its own art and an artifact set shows its emblem, rather than every
  // claymore sharing one sword-type icon and every set sharing one element rune.
  weapon: (name) => weaponIconImg(weaponIconName(name)),
  artifact: artifactIconImg,
};

// Internal: the card is the only thing that needs to resolve a source to its
// icon URL. Kept unexported so the module's public surface is the two tables
// (SOURCE_KINDS, BUFF_KEYS) plus the component itself.
const iconFor = (source) => {
  const load = ICON_LOADERS[source.iconKind] || iconImg;
  return load(source.icon);
};

/*
 * Recolour an icon only when it is a single-colour stencil.
 *
 * Element and stat stencils are black (see game.js), so drawing one untinted on
 * this card's near-black background renders nothing — the artifact cards looked
 * like they had no icon for exactly this reason.
 *
 * Real artwork must be left ALONE. The check therefore runs against the
 * resolved URL (which encodes the directory), not the icon name: an earlier
 * version tested the name against a fixed list, so the newly added weapon and
 * artifact art was not recognised and got flattened to white.
 */
const iconStyleFor = (source) => {
  const src = iconFor(source);
  return isStencilIcon(src) ? { filter: 'brightness(0) invert(1)', opacity: 0.92 } : undefined;
};

/* ------------------------------------------------------------------ icons */

/* How a source's own artwork is fitted into its tile.
 *
 * WEAPONS ARE CONTAINED, like everything else, and the tile is what changes.
 * Three earlier attempts tried to make weapon art FILL the tile by scaling it
 * past the tile and clipping the overflow. All three were wrong, and the reason
 * is in the data -- measured across all 257 weapons:
 *
 *   content aspect ratio   0.21 .. 1.27      (a six-fold spread)
 *   content height/canvas  23% .. 100%
 *
 * A one-handed sword's art is 0.27 (a narrow blade); a catalyst's is 0.89 (near
 * square). No single scale factor fits both: filling the width with a blade
 * overflows the height six times over and clips the tip, while the same factor
 * leaves a catalyst half empty. Cropping the transparent margins does not help
 * either -- a crop does not change the aspect ratio, only the padding.
 *
 * So the art is CONTAINED -- drawn whole, at the largest size its own shape
 * allows -- and the TILE is made tall enough that "largest size" is a usable
 * one. That is the same treatment `WeaponPicker` uses, for the same reason.
 *
 * The transparent margins are why the tile must be generous rather than tight:
 * `contain` fits the CANVAS, and a weapon canvas is 512x1024 with the art in a
 * band across the middle. Sizing the tile around the canvas keeps the art itself
 * a reasonable size.
 */

/* -------------------------------------------------------------- source map */

// What each source kind is called, and the accent colour that tints the card.
// The accent is what lets a player tell a constellation from a weapon set at a
// glance without reading the label.
export const SOURCE_KINDS = {
  weapon: { chs: '武器', en: 'Weapon', color: 'rgb(255, 177, 63)' },
  constellation: { chs: '命之座', en: 'Constellation', color: 'rgb(255, 213, 128)' },
  talent: { chs: '固有天赋', en: 'Passive Talent', color: 'rgb(153, 255, 136)' },
  normal: { chs: '普通攻击', en: 'Normal Attack', color: 'rgb(200, 200, 210)' },
  skill: { chs: '元素战技', en: 'Elemental Skill', color: 'rgb(128, 192, 255)' },
  burst: { chs: '元素爆发', en: 'Elemental Burst', color: 'rgb(255, 172, 255)' },
  artifact2: { chs: '圣遗物 2 件套', en: 'Artifact 2-Pc', color: 'rgb(255, 230, 153)' },
  artifact4: { chs: '圣遗物 4 件套', en: 'Artifact 4-Pc', color: 'rgb(255, 230, 153)' },
  other: { chs: '其他', en: 'Other', color: 'rgb(180, 180, 190)' },
};

export const sourceKindOf = (kind) => SOURCE_KINDS[kind] || SOURCE_KINDS.other;

/* ---------------------------------------------------------------- buff key */

// The stat a buff modifies. `suffix` decides how the value reads, and `sign`
// whether a leading + is meaningful (a flat ATK bonus reads "+120", whereas a
// multiplier like CRIT DMG reads "+32%").
//
// Add your own by passing `buffKeys` to the card, or just use a key not listed
// here — unknown keys fall back to the raw key text with a % suffix.
export const BUFF_KEYS = {
  /**
   * FLAT IS LABELLED 固定, AND PERCENT IS LABELLED 加成.
   *
   * `atk` and `atkPct` were BOTH labelled plain 攻击力, differing only by a `%`
   * suffix, so a flat `攻击力 827.55` and a `攻击力 +18%` looked like the same
   * stat at two magnitudes. They are not: a flat addition sits OUTSIDE the
   * percentage in the formula (`base * (1 + pct) + flat`), while the percentage
   * multiplies the base. Two different quantity kinds sharing one name is how a
   * flat buff came to be added to the base it should not touch.
   *
   * The panel already separates them this way -- 固定攻击力 beside 攻击力加成, see
   * DamageCard's stat rows -- so the buff vocabulary now says the same thing the
   * panel it feeds says.
   */
  atk: { chs: '固定攻击力', en: 'Flat ATK', suffix: '', sign: true },
  atkPct: { chs: '攻击力加成', en: 'ATK%', suffix: '%', sign: true },
  hp: { chs: '固定生命值', en: 'Flat HP', suffix: '', sign: true },
  hpPct: { chs: '生命值加成', en: 'HP%', suffix: '%', sign: true },
  def: { chs: '固定防御力', en: 'Flat DEF', suffix: '', sign: true },
  defPct: { chs: '防御力加成', en: 'DEF%', suffix: '%', sign: true },
  em: { chs: '元素精通', en: 'Elemental Mastery', suffix: '', sign: true },
  critRate: { chs: '暴击率', en: 'CRIT Rate', suffix: '%', sign: true },
  critDmg: { chs: '暴击伤害', en: 'CRIT DMG', suffix: '%', sign: true },
  er: { chs: '元素充能效率', en: 'Energy Recharge', suffix: '%', sign: true },
  // Per-element DMG bonus, so a buff can name the element it actually boosts.
  //
  // Without these the only option was the generic 伤害加成, and the panel's single
  // element field showed a fixed flame whatever the character's element was. With
  // them the key says which element, the panel has a field for each, and nothing
  // has to guess.
  pyroDmg: { chs: '火元素伤害', en: 'Pyro DMG', suffix: '%', sign: true },
  hydroDmg: { chs: '水元素伤害', en: 'Hydro DMG', suffix: '%', sign: true },
  cryoDmg: { chs: '冰元素伤害', en: 'Cryo DMG', suffix: '%', sign: true },
  electroDmg: { chs: '雷元素伤害', en: 'Electro DMG', suffix: '%', sign: true },
  anemoDmg: { chs: '风元素伤害', en: 'Anemo DMG', suffix: '%', sign: true },
  geoDmg: { chs: '岩元素伤害', en: 'Geo DMG', suffix: '%', sign: true },
  dendroDmg: { chs: '草元素伤害', en: 'Dendro DMG', suffix: '%', sign: true },
  physBonus: { chs: '物理伤害', en: 'Physical DMG', suffix: '%', sign: true },
  dmgBonus: { chs: '通用伤害加成', en: 'All DMG Bonus', suffix: '%', sign: true },
  healBonus: { chs: '治疗加成', en: 'Healing Bonus', suffix: '%', sign: true },
  shieldStrength: { chs: '护盾强效', en: 'Shield Strength', suffix: '%', sign: true },
  resShred: { chs: '全抗性降低', en: 'All RES Shred', suffix: '%', sign: true },
  // Resistance reduction aimed at ONE damage type. A boss is not equally
  // resistant to everything, and in-game shreds name their element ("decreases
  // Cryo RES by 40%"), so a single generic field could not record the buff that
  // actually matters.
  //
  // The generic `resShred` above is KEPT rather than replaced: several shreds
  // add together and some are genuinely element-less (钟离's shield lowers every
  // resistance), and it still feeds the formula alongside the hit's own field.
  ...Object.fromEntries(DAMAGE_TYPES.map((t) => [
    `resShred${KEY_SUFFIX[t]}`,
    { chs: `${TYPE_ZH[t]}抗性降低`, en: `${KEY_SUFFIX[t]} RES Shred`, suffix: '%', sign: true },
  ])),
  defShred: { chs: '防御降低', en: 'DEF Shred', suffix: '%', sign: true },
  defIgnore: { chs: '无视防御', en: 'DEF Ignore', suffix: '%', sign: true },
  normalDmg: { chs: '普攻伤害', en: 'Normal ATK DMG', suffix: '%', sign: true },
  chargedDmg: { chs: '重击伤害', en: 'Charged ATK DMG', suffix: '%', sign: true },
  plungeDmg: { chs: '下落攻击伤害', en: 'Plunge DMG', suffix: '%', sign: true },
  skillDmg: { chs: '元素战技伤害', en: 'Skill DMG', suffix: '%', sign: true },
  burstDmg: { chs: '元素爆发伤害', en: 'Burst DMG', suffix: '%', sign: true },
  reactionBonus: { chs: '反应伤害提升', en: 'Reaction DMG', suffix: '%', sign: true },
  speed: { chs: '攻击速度', en: 'ATK SPD', suffix: '%', sign: true },
  cdReduction: { chs: '冷却缩减', en: 'CD Reduction', suffix: '%', sign: true },
  staminaCost: { chs: '体力消耗降低', en: 'Stamina Cost', suffix: '%', sign: false },
  // PRESENT HERE, DELIBERATELY ABSENT FROM `KEY_TO_STAT`.
  // That absence is half the mechanism: `foldBuffs` skips a key it cannot map, so
  // neither of these adds into the DMG bracket. The other half is explicit, in
  // `buff-model.js` -- `NEUTRAL_KEYS` keeps a damage-neutral stat out of the zones,
  // and `RAW_MULT_KEYS` says which zones are a direct factor.
  //
  // 大权 carries NO `%` SUFFIX because its value IS the multiplier: 2 means twice
  // the damage. A `%` there would promise "+2%" while the arithmetic did "×2".
  aPower: { chs: '大权', en: 'Authority', suffix: '', sign: false },
  // 擢升 is a percentage zone -- `1 + v/100` -- and sums with any other
  // percentage zone, so 擢升 30 + 潮涌 20 gives one factor of 1.50.
  ascension: { chs: '擢升', en: 'Ascension', suffix: '%', sign: true },
};

export const buffKeyOf = (key) =>
  BUFF_KEYS[key] || { chs: key, en: key, suffix: '%', sign: true };

// Format one buff value: "+32%" / "-10%" / "120". A value already carrying a
// percent suffix ("12%") is left alone so hand-written data still displays
// correctly.
//
// The test is for a TRAILING `%`, not for any letter: `/[a-zA-Z%]/` also
// matched numeric strings like "1e3", which were then echoed verbatim while
// `numericValue` (buff-model.js) parsed them as 1000 — so the card displayed one
// thing and the damage formula used another.
export function formatBuffValue(value, def) {
  if (value === '' || value == null) return '—';
  const s = String(value).trim();
  if (s === '—') return s;
  if (/%$/.test(s)) return s;
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  const sign = def.sign && n > 0 ? '+' : '';
  return `${sign}${n}${def.suffix}`;
}

/* --------------------------------------------------------------- component */

/**
 * A single buff source and every buff it grants.
 *
 * @param {object}   source            The granting thing (see SOURCE_KINDS).
 * @param {string}   source.kind       weapon | constellation | talent | normal |
 *                                     skill | burst | artifact2 | artifact4
 * @param {string}   source.icon       Icon file name.
 * @param {string}   [source.iconKind] Which folder the icon lives in
 *                                     (talent | skill | item | icon).
 * @param {object}   source.name       { chs, en } display name.
 * @param {string}   [source.rank]     e.g. 'C2', 'R5' — shown as a chip.
 * @param {object}   [source.owner]    { id, name } the character it belongs to.
 * @param {Array}    buffs             [{ key, value, tag }]
 * @param {boolean}  [editable]        Allow editing values in the expanded view.
 * @param {Function} [onBuffsChange]   Called with the next buffs array.
 * @param {Function} [onSourceChange]  Called with the next source object.
 */
export default function BuffCard({
  source,
  buffs = [],
  editable = false,
  onBuffsChange,
  onSourceChange,
  // The OWNER character's `$` scope, so a formula-valued buff can be resolved
  // while editing (`=$总攻击力*0.15`) and autocompleted. Optional: a page with no
  // team behind it (the library editor) passes none, and a formula then shows as
  // unresolved rather than as a wrong number.
  scope = null,
  // A control rendered in the card's TOP-RIGHT corner -- the pool's "+ 实例"
  // button is the only caller today.
  //
  // WHY IT IS A SLOT AND NOT AN OVERLAY THE CALLER POSITIONS. It was one, at
  // `right-2 top-2`, and it landed exactly on the buff-count chip and the
  // chevron that already live there -- measured: the chip spans y 22-44 and the
  // chevron 47-59 of an 82px head, so no corner of the right edge is free.
  // Rendering it HERE lets the head RESERVE the width it needs, which an
  // absolute sibling outside this component cannot do.
  //
  // It sits inside the card's root (not the head button), so hovering it keeps
  // the card open and it is not a button nested in a button.
  cornerAction = null,
  className = '',
}) {
  const { L } = useI18n();
  const kind = sourceKindOf(source.kind);

  // Expanded state. Hover is the primary affordance, but the card is also
  // pinned open by click so it can be used on touch devices and so an open
  // editor does not vanish the moment the pointer leaves.
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [iconMissing, setIconMissing] = useState(false);
  const open = pinned || hovered;

  const rootRef = useRef(null);

  // A new icon deserves a fresh attempt, even if the previous one 404'd.
  useEffect(() => setIconMissing(false), [source.icon, source.iconKind]);

  // Close a pinned card on Escape or on a click outside it.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e) => e.key === 'Escape' && setPinned(false);
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [pinned]);

  const updateBuff = (i, patch) => {
    const next = buffs.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    onBuffsChange?.(next);
  };

  return (
    <div
      ref={rootRef}
      data-buff-card
      style={{ '--accent': kind.color }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group/buff relative flex w-[260px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-lg shadow-black/40 transition-[border-color,box-shadow] duration-300 hover:border-[color:var(--accent)]/40 ${className}`}
    >
      {/* Accent rail down the left edge: the quickest way to tell a weapon
          card from a constellation card in a dense grid. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: kind.color, opacity: open ? 1 : 0.55 }}
      />

      {/* ---------------------------------------------------- collapsed head */}
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 pl-4 pr-3 py-3 text-left"
      >
        {/* Icon-led: the art is the largest element in the collapsed state.
            A missing icon file degrades to the kind's initial rather than
            leaving a broken-image glyph in a dense grid.

            WHY A TALL TILE FOR WEAPONS. A weapon canvas is 512x1024 with the art
            in a band across the middle, roughly 61% of the canvas height for a
            sword and 83% for a polearm. `contain` fits the CANVAS, so the art
            comes out proportional to the tile: measured, a 64x128 tile draws a
            sword at 22x79px where a square 64x64 draws it at 12x39px.

            The tile is therefore tall rather than square, which is what makes
            the blade a usable size. It is NOT scaled past the tile and clipped:
            that was tried three times and always cut the tip off, because weapon
            art ranges from aspect 0.21 (a polearm) to 1.27 (a catalyst) and no
            single scale factor fits both ends.

            A catalyst is the one type that stays small (23% of the canvas, art
            of 28x30px at this tile size). That is a property of the ASSET -- its
            content is a small square on a tall canvas -- and no tile shape
            changes the percentage; a bigger tile only enlarges its transparent
            margins. Noted here so it is not mistaken for a layout bug.

            `p-0` for weapons: their canvas already carries generous margins, and
            padding on top of that only shrinks the art further. */}
        <span
          className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] ${
            source.iconKind === 'weapon' ? 'h-[128px] w-[64px] p-0' : 'h-14 w-14 p-1.5'
          }`}
          style={{ boxShadow: open ? `0 0 0 1px ${kind.color}55` : 'none' }}
        >
          {iconMissing ? (
            <span className="text-lg font-bold" style={{ color: kind.color }}>
              {L(kind).slice(0, 1)}
            </span>
          ) : (
            <img
              src={iconFor(source)}
              alt=""
              onError={() => setIconMissing(true)}
              // `contain` for every kind. The weapon art diverges so widely in
              // shape (aspect 0.21 to 1.27) that no per-kind scaling rule can
              // hold; the tile's shape is what makes the blade big enough.
              className="h-full w-full object-contain"
              style={iconStyleFor(source)}
            />
          )}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: kind.color }}
          >
            {L(kind)}
            {source.rank && <span className="ml-1 text-white/35">{source.rank}</span>}
          </span>
          <span className="truncate text-sm font-semibold text-white">{L(source.name)}</span>
          {/* The owner is what makes a wall of buff cards navigable. */}
          {source.owner && (
            <span className="mt-0.5 truncate text-[10px] text-white/40">
              {source.owner.name}
            </span>
          )}
        </span>

        {/* Buff count stays visible when collapsed — it is the card's "value".
            When there is exactly one buff, its formatted reading is shown
            INSTEAD of the count: "1 buff" says nothing, whereas "暴击伤害 +32%"
            is the thing you are scanning a list of 2000 cards for. */}
        {/* THE CORNER ACTION TAKES THE TOP-RIGHT, so the chip and the chevron
            move DOWN under it -- which is the reading order on a card with a
            control up there. `pt` is the button's height plus its `top-2` offset,
            so the chip clears it without growing the card more than the shift
            actually needs. */}
        <span className={`flex shrink-0 flex-col items-end gap-1 ${
          cornerAction ? 'pt-[22px]' : ''
        }`}>
          <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] tabular-nums text-white/50">
            {buffs.length === 1
              ? `${L(buffKeyOf(buffs[0].key))} ${formatBuffValue(buffs[0].value, buffKeyOf(buffs[0].key))}`
              : `${buffs.length} buff${buffs.length === 1 ? '' : 's'}`}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-white/30 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {/* The corner action, over the width the head reserved above. */}
      {cornerAction && (
        <div className="absolute right-2 top-2 z-10">{cornerAction}</div>
      )}

      {/* ------------------------------------------------------ expanded rows */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-1.5 border-t border-white/5 px-3 py-3">
            {buffs.length === 0 && (
              <p className="px-1 py-2 text-center text-[11px] text-white/30">
                {L({ chs: '没有增益条目', en: 'No buffs' })}
              </p>
            )}

            {buffs.map((buff, i) => (
              <BuffRow
                key={`${buff.key}-${i}`}
                buff={buff}
                L={L}
                scope={scope}
                // EDITABLE ONLY WHILE OPEN. The editor page passes `editable`
                // permanently, which meant its collapsed cards showed input
                // boxes and never the formatted reading -- so a page whose whole
                // purpose is reviewing values could not show you a value. Closed
                // cards now read exactly like the planner's pool.
                editable={editable && open}
                accent={kind.color}
                onChange={(patch) => updateBuff(i, patch)}
                onRemove={
                  editable && onBuffsChange
                    ? () => onBuffsChange(buffs.filter((_, idx) => idx !== i))
                    : null
                }
              />
            ))}

            {editable && onBuffsChange && (
              <button
                type="button"
                onClick={() => onBuffsChange([...buffs, { key: 'atkPct', value: 0, tag: '' }])}
                className="mt-0.5 rounded-lg border border-dashed border-white/15 px-2 py-1.5 text-[11px] text-white/40 transition-colors hover:border-white/30 hover:text-white/70"
              >
                + {L({ chs: '添加增益', en: 'Add buff' })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- key picker */

/**
 * Choose which stat a buff moves.
 *
 * THE KEY WAS A FREE-TEXT FIELD, which made two things impossible:
 *   - you could not tell whether what you typed was a real key. `atkPct` and
 *     `atkpercent` both "work" -- `buffKeyOf` falls back to echoing the raw text
 *     -- so a typo produced a buff the damage formula silently ignored.
 *   - you had to remember the exact spelling. There are 24 keys with Chinese and
 *     English labels, and the label is what a player reads.
 *
 * A dropdown over `BUFF_KEYS` fixes both: the LABEL is what is shown and
 * searched, the key is what is stored, and anything not in the table is called
 * out rather than accepted quietly.
 *
 * THE LABEL CARRIES THE SUFFIX, because two keys share a name: `atk` and `atkPct`
 * are both called 攻击力 and differ only in whether the value is flat or a
 * percentage. Listed bare they are indistinguishable, which is the same problem
 * the text field had.
 *
 * RENDERED THROUGH A PORTAL. The card has `overflow-hidden` twice over -- on its
 * root, and on the expanding rows wrapper that drives the open animation -- so a
 * popover anchored inside it was clipped to the row it came from and showed one
 * option out of twenty-five. A portal puts the list in `document.body`, outside
 * every clipping ancestor.
 *
 * An unknown key is still permitted: `buffKeyOf` is documented to tolerate one,
 * and a new stat should not require a code change to record. It is just marked,
 * so "I typed something wrong" and "this is deliberately new" look different.
 */
function BuffKeyPicker({ value, onChange, L }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rect, setRect] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const known = BUFF_KEYS[value];
  const def = buffKeyOf(value);

  /**
   * Where to put the list: under the trigger, flipped up when there is no room
   * below, and clamped to the viewport so a long list cannot run off an edge.
   */
  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const LIST_H = 260;
    const below = window.innerHeight - r.bottom;
    setRect({
      left: Math.min(r.left, window.innerWidth - 232),
      top: below < LIST_H && r.top > LIST_H ? r.top - LIST_H - 4 : r.bottom + 4,
      width: 220,
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => {
      // Both the trigger and the portalled list are "inside" this control, even
      // though they are not siblings in the DOM.
      if (triggerRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // The list is positioned from the trigger's viewport rect, so it has to
    // follow when the page moves under it.
    const onScroll = () => place();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const needle = q.trim().toLowerCase();
  const options = Object.entries(BUFF_KEYS).filter(([k, meta]) => {
    if (!needle) return true;
    // Match the LABEL as well as the key: someone looking for 暴击 should find
    // critRate without knowing it is called that.
    return k.toLowerCase().includes(needle)
      || meta.chs.toLowerCase().includes(needle)
      || meta.en.toLowerCase().includes(needle);
  });

  /**
   * The typed text, offered as a CUSTOM MULTIPLIER ZONE when it names no stat.
   *
   * TRIMMED, AND EXACTLY what the user typed. That exactness is the whole point:
   * `foldCustomZones` merges by exact name, so "大权" typed in two places is one
   * zone and "大权 " with a trailing space would be a second one. Trimming here
   * means the accidental case cannot arise from the input side.
   *
   * Not offered when it matches a known key (it would duplicate the row above) or
   * when the field is empty.
   */
  const typed = q.trim();
  const customCandidate = typed && !BUFF_KEYS[typed] ? typed : null;

  return (
    // 88px, not 104: measured against the row, a 104px key left the TAG at 41px
    // in a 254px row, which is not enough to read a word. The label is at most
    // four characters plus a `%`, and it truncates rather than wrapping, so the
    // honest split gives the free-text field the room.
    <span className="relative w-[88px] shrink-0">
      <button
        ref={triggerRef}
        type="button"
        data-buff-key={value || ''}
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
          setQ('');
        }}
        title={known
          ? `${value} — ${L(known)}`
          : L({ chs: `未知词条：${value || '(空)'}`, en: `Unknown stat: ${value || '(empty)'}` })}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-semibold outline-none transition-colors hover:bg-white/5 ${
          known ? 'text-white' : 'text-amber-300'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{value ? keyLabelFor(value, L) : L({ chs: '选词条', en: 'stat' })}</span>
        {/* An unknown key is FLAGGED rather than silently accepted: a typo used to
            produce a buff the damage formula ignored, with nothing to show for it. */}
        {value && !known && <span className="shrink-0 text-[9px]">?</span>}
        <span className="shrink-0 text-[8px] text-white/30">▾</span>
      </button>

      {open && rect && createPortal(
        <div
          ref={listRef}
          data-buff-key-menu
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width }}
          className="z-[70] rounded-xl border border-white/10 bg-[#141418] p-1 shadow-2xl shadow-black/80"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={L({ chs: '搜索词条…', en: 'Search stats…' })}
            className="mb-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white outline-none placeholder:text-white/30 focus:border-white/25"
          />
          <div className="max-h-[220px] overflow-y-auto">
            {options.map(([k, meta]) => (
              <button
                key={k}
                type="button"
                data-buff-key-option={k}
                onClick={() => { onChange(k); setOpen(false); }}
                title={k}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                  k === value ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
                }`}
              >
                {/* The suffix is part of the LABEL here: `atk` and `atkPct` are
                    both called 攻击力, so without it the two rows are identical. */}
                <span className="flex-1 truncate">{keyLabelFor(k, L)}</span>
                <span className="shrink-0 text-[9px] text-white/25">{k}</span>
              </button>
            ))}

            {/* USE WHAT WAS TYPED AS AN INDEPENDENT MULTIPLIER ZONE.
                A name that matches no stat is not a typo to be rejected -- the user
                is declaring a zone of their own ("大权", "潮涌"). Offered FIRST when
                nothing matches, because that is the case where the list is empty and
                the input is the only thing on screen; offered LAST otherwise, so it
                never displaces a real stat the user was searching for. */}
            {customCandidate && (
              <button
                type="button"
                data-buff-key-custom={customCandidate}
                onClick={() => { onChange(customCandidate); setOpen(false); }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
                  options.length ? 'mt-1 border-t border-white/10 pt-1.5' : ''
                } ${customCandidate === value ? 'bg-amber-400/10 text-amber-200' : 'text-amber-300/90 hover:bg-amber-400/10'}`}
              >
                <span className="flex-1 truncate">
                  {L({ chs: `用「${customCandidate}」作为独立乘区`, en: `Use "${customCandidate}" as its own zone` })}
                </span>
                <span className="shrink-0 text-[9px] text-amber-300/50">{L({ chs: '乘区', en: 'zone' })}</span>
              </button>
            )}

            {!options.length && !customCandidate && (
              <p className="px-2 py-3 text-center text-[10px] text-white/30">
                {L({ chs: '没有匹配的词条', en: 'No stat matches' })}
              </p>
            )}
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}

/**
 * A key's label, with its suffix when that is what tells it apart.
 *
 * `atk` (攻击力 120) and `atkPct` (攻击力 46.6%) share a name, so the `%` is
 * appended for the percentage form. `sign` is deliberately not used: a '+' says
 * nothing about which stat this is.
 */
function keyLabelFor(key, L) {
  const meta = buffKeyOf(key);
  return meta.suffix ? `${L(meta)}${meta.suffix}` : L(meta);
}

/**
 * The value field: a number, or a formula over the owner's stats.
 *
 * WHY A TEXT FIELD AND NOT type=number. A formula (`=$总攻击力*0.15`) is a string,
 * and a number input would refuse it. The field is `inputMode="decimal"` so a
 * touch keypad still offers digits for the common case.
 *
 * `$` AUTOCOMPLETE. Typing `$` (or a prefix after one) opens a list of the
 * matching symbols, EACH WITH ITS CURRENT VALUE -- the only cheap way to
 * distinguish $攻击力 from $总攻击力, whose names differ by one character and
 * where picking the wrong one is a silently wrong buff. The list replaces ONLY
 * the partial name under the caret, so a formula with several symbols is editable
 * in the middle.
 */
/**
 * A symbol's current value, rounded so the list stays scannable.
 *
 * `$总攻击力` derives to 2673.1440000000002 (base x pct + flat, in floating
 * point), and a column of those is unreadable beside `$防御力 824`. Two decimals
 * is enough to tell `$攻击力` from `$总攻击力` -- the decision the list exists to
 * support -- without the noise. An exact integer keeps no `.00`.
 */
function roundForDisplay(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Math.round(v * 100) / 100;
}
function FormulaValueInput({ value, onChange, scope, L }) {
  const [suggest, setSuggest] = useState(null); // { items, from, to }
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);
  const ref = useRef(null);

  /**
   * Where to put the list: under the field, flipped up when there is no room
   * below, and clamped so a long list cannot run off an edge.
   *
   * THE SAME REASON `BuffKeyPicker` IS A PORTAL. The card clips its contents
   * twice over (`overflow-hidden` on the root and on the expanding rows
   * wrapper), so a list anchored inside the row was cut off at the row's edge --
   * measured: the six matches were showing one or two. A portal puts the list in
   * `document.body`, outside every clipping ancestor.
   */
  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const LIST_H = 200;
    const below = window.innerHeight - r.bottom;
    setRect({
      left: r.left,
      top: below < LIST_H && r.top > LIST_H ? r.top - LIST_H - 4 : r.bottom + 4,
      width: 230,
    });
  };

  const refresh = (el) => {
    const caret = el.selectionStart ?? el.value.length;
    const part = partialAt(el.value, caret);
    if (!part) { setSuggest(null); return; }
    setActive(0);
    place();
    setSuggest({ items: matchesFor(part.text, scope), from: part.from, to: part.to });
  };

  const close = () => setSuggest(null);

  const accept = (name) => {
    const el = ref.current;
    if (!el || !suggest) return;
    const text = '$' + name;
    const next = el.value.slice(0, suggest.from) + text + el.value.slice(suggest.to);
    onChange(next);
    const caret = suggest.from + text.length;
    // Re-set the value and caret after React paints the controlled input.
    setTimeout(() => { el.focus(); el.setSelectionRange(caret, caret); }, 0);
    close();
  };

  const open = Boolean(suggest && suggest.items.length);

  // The list is positioned from the field's viewport rect, so it has to follow
  // when the page moves under it -- exactly as the key picker's list does.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <span className="relative flex items-center">
      <input
        ref={ref}
        value={value ?? ''}
        onChange={(e) => { onChange(e.target.value); refresh(e.target); }}
        onKeyDown={(e) => {
          // While the list is open these keys drive IT, not the field: the arrows
          // move the highlight, Enter/Tab accept, Escape dismisses. This is what
          // the demo did, so the muscle memory carries over.
          if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            const n = suggest.items.length;
            setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
            return;
          }
          if (open && (e.key === 'Enter' || e.key === 'Tab')) {
            e.preventDefault();
            accept((suggest.items[active] || suggest.items[0]).name);
            return;
          }
          if (open && e.key === 'Escape') { e.preventDefault(); close(); }
        }}
        onBlur={() => setTimeout(close, 120)}
        placeholder={L({ chs: '数值', en: 'value' })}
        aria-label={L({ chs: '数值', en: 'value' })}
        inputMode="decimal"
        spellCheck={false}
        // 38px covers a four-digit stat; a formula is longer, so the field widens
        // while one is being typed (`w-28`) rather than clipping it.
        className={`rounded bg-transparent px-0.5 py-0.5 text-right text-[11px] tabular-nums text-white outline-none placeholder:text-white/25 focus:bg-white/5 ${
          isFormula(value) ? 'w-28 text-left font-mono text-[#7fd4c1]' : 'w-[38px]'
        }`}
      />
      {open && rect && createPortal(
        <div
          data-sym-menu
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width }}
          className="z-[70] max-h-[200px] overflow-y-auto rounded-lg border border-white/15 bg-[#17171c] p-1 shadow-2xl shadow-black/80"
        >
          {suggest.items.map((it, i) => (
            <button
              key={it.name}
              type="button"
              data-sym-option={it.name}
              data-active={i === active ? 'true' : undefined}
              // mousedown, not click: blur fires first and would close the list
              // before a click could be delivered.
              onMouseDown={(e) => { e.preventDefault(); accept(it.name); }}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] ${
                i === active ? 'bg-[#7fd4c1]/15 text-[#7fd4c1]' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              <span className="truncate">${it.name}</span>
              <span className="shrink-0 text-[10px] tabular-nums text-white/40">{roundForDisplay(it.value)}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ a row */

/**
 * One buff line: KEY — VALUE — TAG.
 *
 * The tag is deliberately free text. "CRIT DMG" is not enough on its own: the
 * same key can be unconditional, element-locked (Anemo CRIT DMG) or
 * action-locked (Normal Attack DMG), and those are different buffs that happen
 * to share a key.
 */
function BuffRow({ buff, L, editable, accent, onChange, onRemove, scope }) {
  const def = buffKeyOf(buff.key);
  const hasTag = Boolean(buff.tag && buff.tag.trim());
  // A FORMULA IS SHOWN AS ITS RESULT, with the text available while editing.
  // `resolve` REFUSES rather than reducing to the digits inside, so an
  // unresolvable formula reads as a marked error, never as a plausible number.
  const resolved = isFormula(buff.value) ? resolve(buff.value, scope) : null;

  if (editable) {
    // A FORMULA THAT CANNOT RESOLVE SAYS SO while it is being typed, matching the
    // collapsed reading. The input widens for a formula (`w-28`) only once one is
    // recognised; an unresolvable one is still `isFormula`, so the field is wide
    // and the row would otherwise look accepted. The message is the resolver's own
    // (`不认识的符号：…`), which is the only thing that says WHAT is wrong.
    const bad = isFormula(buff.value) && resolved && !resolved.ok ? resolved.error : null;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          {/* The key is a fixed 104px -- enough for the longest label -- and the
              TAG takes everything left. Giving both `flex-1` let the key expand
              past any label it could show and squeeze the tag to 31px, which is
              backwards: the tag is free text and the key is from a closed list. */}
          <BuffKeyPicker value={buff.key} onChange={(key) => onChange({ key })} L={L} />
          <span className="flex shrink-0 items-center gap-0.5">
            <FormulaValueInput
              value={buff.value}
              onChange={(v) => onChange({ value: v })}
              scope={scope}
              L={L}
            />
            {/* The unit, shown WHILE editing. Without it "32" for CRIT DMG and "32"
                for flat HP are indistinguishable until the card is collapsed. */}
            {/* A formula carries its own scaling, so the stat's `%` suffix would be
                a second, wrong unit beside it -- it is suppressed for one. */}
            <span className="w-[9px] text-[10px] text-white/35">
              {isFormula(buff.value) ? '' : buffKeyOf(buff.key).suffix}
            </span>
          </span>
          <input
            value={buff.tag || ''}
            onChange={(e) => onChange({ tag: e.target.value })}
            placeholder={L({ chs: '标签', en: 'tag' })}
            aria-label={L({ chs: '标签', en: 'tag' })}
            className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[11px] text-white/60 outline-none placeholder:text-white/25 focus:bg-white/5"
          />
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              title={L({ chs: '删除', en: 'Remove' })}
              className="shrink-0 rounded px-1 text-[11px] leading-none text-white/20 transition-colors hover:text-white/70"
            >
              ✕
            </button>
          )}
        </div>
        {bad && (
          <span
            data-formula-error
            title={bad}
            className="px-0.5 text-[10px] leading-tight text-red-300/90"
          >
            {L({ chs: '公式错误', en: 'bad formula' })}：{bad}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-baseline gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
      {/* KEY — what stat moves */}
      <span className="shrink-0 text-[11px] text-white/55">{L(def)}</span>

      {/* VALUE — pushed right so the numbers form a readable column */}
      <span className="ml-auto shrink-0 text-[13px] font-bold tabular-nums text-white">
        {resolved
          ? (resolved.ok
              ? formatBuffValue(String(resolved.value), def)
              : <span className="text-[11px] font-normal text-red-300/90" title={resolved.error}>{L({ chs: '公式错误', en: 'bad formula' })}</span>)
          : formatBuffValue(buff.value, def)}
      </span>

      {/* TAG — the qualifier, colour-coded by accent so it reads as metadata */}
      {hasTag && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium leading-tight"
          style={{ color: accent, backgroundColor: `${accent.replace('rgb', 'rgba').replace(')', ', 0.12)')}` }}
        >
          {buff.tag}
        </span>
      )}
    </div>
  );
}
