// One artifact slot: the piece icon, its set, its main stat and its substats.

import { useState } from 'react';
import { artifactIconImg, qualityOf } from '../../../game';
import { useI18n } from '../../../i18n';
import {
  ARTIFACT_LEVEL_MAX, ARTIFACT_LEVEL_MIN, ARTIFACT_LEVEL_STEP,
  SLOT_LABEL, blankPiece, pieceIcon,
} from '../../../lib/artifact';
import { NumberStepper } from '../controls';
import SetPicker from './SetPicker';
import MainStatControl from './MainStatControl';
import SubstatsControl from './SubstatsControl';

/**
 * A single slot of the artifact row.
 *
 * LAYOUT, top to bottom: piece icon (which IS the set control), set name, main
 * stat, level, then the four substat rows. The slot's own identity -- Flower,
 * Plume, and so on -- is carried by the piece artwork plus a tooltip rather
 * than by a text label, because a 178px column has no room for both the set
 * name and the slot name.
 *
 * WHY THE PIECE ICON IS NOT THE SET EMBLEM: a set's five pieces have distinct
 * artwork -- `UI_RelicIcon_15047_1` through `_5` -- so the row shows five
 * different pictures even when all five slots use the same set.
 *
 * @param {object}   piece     `{ setId, mainStat, level, subStats }`.
 * @param {object}   sets      setId -> set, from the catalogue.
 * @param {Function} onChange  Called with the patched piece.
 */
export default function PieceSlot({ slotKey, piece, sets, onChange }) {
  const { L } = useI18n();
  const [openSet, setOpenSet] = useState(false);
  // The two popovers are mutually exclusive, so the slot owns which is open and
  // passes the closer down; see MainStatControl and SubstatsControl.
  const [openMain, setOpenMain] = useState(false);
  const [openSub, setOpenSub] = useState(false);

  const set = piece.setId ? sets?.[piece.setId] : null;
  const icon = pieceIcon(sets, piece.setId, slotKey);
  const rq = qualityOf(set?.qualityType);
  // The substat value picker offers the LEGAL rolls for THIS rarity. A piece with
  // no set yet has no rarity to read, so it falls back to 5 stars -- the value a
  // build reaches for, and the default substat-rolls.js publishes.
  const rarity = rq?.stars ?? 5;

  // Three of the five slots read the same either way; the other two gain a
  // distinct label once a set is chosen.
  const setName = set ? L({ chs: set.chsName, en: set.enName }) : null;
  const label = setName || L(SLOT_LABEL[slotKey]);

  // Anything at all in this slot: a set, a main stat, or any substat. Drives
  // whether the clear button is offered -- an empty slot has nothing to clear,
  // and a permanently visible button on five empty cards is noise.
  const filled = !!(
    piece.setId
    || piece.mainStat
    || (piece.subStats || []).some(Boolean)
  );

  return (
    <div
      className="relative flex w-[178px] shrink-0 flex-col items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2"
      data-artifact-slot={slotKey}
      data-slot-filled={filled ? 'true' : 'false'}
    >
      {/* Clearing the whole slot: set, main stat, level and substats.
          A corner ✕, matching the buff cards, rather than a labelled button --
          five of those across the row would dominate an editor that is mostly
          read at a glance. */}
      {filled && (
        <button
          type="button"
          onClick={() => onChange(blankPiece())}
          data-clear-slot={slotKey}
          title={L({ chs: '清空该位置', en: 'Clear this slot' })}
          className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-[#1a1a20] text-[10px] text-white/50 transition-colors hover:border-red-400/50 hover:text-red-300"
        >
          ✕
        </button>
      )}
      {/* ---------------------------------------------------- piece icon */}
      {/* The slot's identity: five DIFFERENT pictures for one set. Clicking it
          opens the set picker, because the icon IS the set choice. The glow is
          the set's rarity colour, which is what makes a filled slot read as
          "equipped" at a glance in a row of five. */}
      <button
        type="button"
        onClick={() => setOpenSet(true)}
        title={set ? L({ chs: '更换套装', en: 'Change set' }) : L({ chs: '选择套装', en: 'Choose set' })}
        className="group/piece relative h-[76px] w-[76px] overflow-hidden rounded-xl border transition duration-200 hover:scale-[1.04]"
        style={{
          borderColor: set ? `${rq.color}66` : 'rgba(255,255,255,0.10)',
          background: set
            ? `radial-gradient(80% 70% at 50% 30%, ${rq.color}22 0%, rgba(0,0,0,0.55) 70%)`
            : 'rgba(0,0,0,0.35)',
          boxShadow: set ? `0 0 18px -4px ${rq.color}80, inset 0 1px 0 rgba(255,255,255,0.08)` : 'none',
        }}
      >
        {icon ? (
          <img
            src={artifactIconImg(icon)}
            alt=""
            className="h-full w-full object-contain p-1 drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] transition-transform duration-200 group-hover/piece:scale-105"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xl text-white/20">+</span>
        )}
        {/* Rarity strip along the bottom edge. */}
        {set && (
          <span
            className="absolute inset-x-0 bottom-0 h-[3px]"
            style={{ background: `linear-gradient(90deg, transparent, ${rq.color}, transparent)` }}
          />
        )}
      </button>

      {/* Set name, or the slot name while unset. `title` carries the full text
          because a set name is too long for a 152px column and truncates. */}
      <span
        title={label}
        className="w-full truncate text-center text-[10px] font-medium"
        style={{ color: set ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.35)' }}
      >
        {label}
      </span>

      {/* ---------------------------------------------------- main stat */}
      <MainStatControl
        slotKey={slotKey}
        piece={piece}
        onChange={onChange}
        onOpenChange={setOpenSub}
      />

      {/* ------------------------------------------------------ level */}
      {/* Per-slot, because a build mixes levels. The stepper is the only control
          that changes the main stat's number. */}
      <div className="flex w-full items-center justify-between gap-1">
        <span className="text-[9px] uppercase tracking-wider text-white/30">
          {L({ chs: '等级', en: 'Lv' })}
        </span>
        <NumberStepper
          value={piece.level ?? ARTIFACT_LEVEL_MAX}
          min={ARTIFACT_LEVEL_MIN}
          max={ARTIFACT_LEVEL_MAX}
          step={ARTIFACT_LEVEL_STEP}
          width="w-6"
          tint="#c9a6ff"
          // Nothing to level until a main stat exists: the level only ever
          // scales the main stat's value, so with no main stat it is a control
          // that cannot change anything.
          disabled={!piece.mainStat}
          onChange={(level) => onChange({ ...piece, level })}
          label={L({ chs: '圣遗物等级', en: 'Artifact level' })}
        />
      </div>

      {/* ------------------------------------------------------ substats */}
      <SubstatsControl piece={piece} rarity={rarity} onChange={onChange} onOpenChange={setOpenMain} />

      <SetPicker
        open={openSet}
        onClose={() => setOpenSet(false)}
        value={piece.setId}
        onPick={(setId) => onChange({ ...piece, setId })}
      />
    </div>
  );
}
