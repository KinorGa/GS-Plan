// The team panel: the character row, the selected unit's artifacts, and the
// character picker that adds to it.
//
// THE INTERACTION
//   Clicking a card selects it. The artifact row below then shows THAT unit's
//   artifacts, and edits go to that unit. One artifact row, never one per
//   character: a team is four units and five slots each, so a row per unit
//   would be twenty slots of chrome for a build that is normally the same
//   4-piece set on everyone.
//
// WHY SELECTION IS A UNIT ID, NOT AN INDEX
//   An index would silently point at the wrong unit the moment one is removed,
//   and the artifacts shown would change under the user. Ids are stable across
//   add, remove and a save/load round trip.
//
// WHY THE PANEL OWNS THE PICKER
//   The picker is how a unit gets into this row, so its "add" lands on the same
//   store the row reads. Left to the page, every page mounting the panel would
//   have to wire the picker, the store and the panel together identically --
//   which is the coupling this component exists to remove.

import { useEffect, useMemo, useState } from 'react';
import { avatarImg, charImg, elementOf, iconImg, nameOf, qualityOf } from '../game';
import { useI18n } from '../i18n';
import { useCatalogue, useCharacters } from '../lib/catalogue';
import { useTeam } from '../lib/team-context';
import UnitCard from './builder/UnitCard';
import ArtifactRow from './builder/artifact/ArtifactRow';
import { PickerModal, PickerSearch } from './builder/controls';

export default function TeamPanel({ compact = false }) {
  const { L } = useI18n();
  const { units, setUnit, removeUnit, addUnit } = useTeam();
  const [selectedId, setSelectedId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Selection follows the list. Four cases, all of them reachable:
  //   - nothing selected yet  -> select the first unit
  //   - the selected unit was removed -> fall back to the first
  //   - a unit was added to an empty team -> select it
  //   - otherwise -> leave the choice alone, so adding a character does not
  //     steal focus from the one being edited
  useEffect(() => {
    if (!units.length) { if (selectedId !== null) setSelectedId(null); return; }
    if (!selectedId || !units.some((u) => u.id === selectedId)) {
      setSelectedId(units[0].id);
    }
  }, [units, selectedId]);

  const selected = units.find((u) => u.id === selectedId) || null;

  return (
    <div data-team-panel className="flex flex-col gap-4">
      {/* ------------------------------------------------------ character row */}
      {/* A horizontally scrolling strip, not a wrapping grid: a team is a short
          ordered list, and wrapping made the page grow downward as characters
          were added, pushing the first unit off screen. */}
      <div
        data-team-units
        className="-mx-1 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-1 pb-3"
      >
        {units.map((u) => (
          <UnitCard
            key={u.id}
            value={u}
            selected={u.id === selectedId}
            onSelect={() => setSelectedId(u.id)}
            onChange={(next) => setUnit(u.id, next)}
            onRemove={() => removeUnit(u.id)}
          />
        ))}

        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-[150px] w-[150px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#7fd4c1]/35 bg-[#7fd4c1]/[0.04] transition-colors hover:border-[#7fd4c1]/70 hover:bg-[#7fd4c1]/[0.08]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#7fd4c1]/50 text-lg text-[#7fd4c1]">
            +
          </span>
          <span className="text-[11px] font-medium text-[#7fd4c1]">
            {L({ chs: '添加角色', en: 'Add character' })}
          </span>
        </button>
      </div>

      {!units.length && (
        <p className="text-center text-[11px] text-white/25">
          {L({
            chs: '还没有角色，点上面的「添加角色」开始',
            en: 'No characters yet - click "Add character" to start',
          })}
        </p>
      )}

      {/* ------------------------------------------------------- artifact row */}
      {/* Captioned with whose artifacts these are. Without the name, editing a
          set and then clicking another card looks like the edits were lost.
          Hidden in `compact` mode, where the page wants the row and nothing
          else. */}
      {selected && !compact && (
        <div data-team-artifacts data-for-unit={selected.id} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {L({ chs: '正在配置', en: 'Configuring' })}
            </span>
            <UnitTag unit={selected} />
          </div>

          <ArtifactRow
            value={selected.artifacts}
            onChange={(next) => setUnit(selected.id, { artifacts: next })}
          />
        </div>
      )}

      {/* Import/export is NOT here any more. It used to live in this panel and
          export the team alone; it now covers the team AND every damage axis, so
          it belongs to the page that holds both. It still renders in the same
          place on screen, because this panel's root has no visual box. */}

      <CharacterPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(charId) => addUnit(charId)}
      />
    </div>
  );
}

/** The selected unit's name and rarity, so the caption says WHOSE set this is. */
function UnitTag({ unit }) {
  const { lang } = useI18n();
  const { catalogue } = useCatalogue();
  const charId = unit?.char?.id;
  const char = charId ? catalogue?.chars?.[charId] : null;
  if (!char) return null;

  const q = qualityOf(char.qualityType);
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5">
      {/* The id comes from the UNIT, not from `char`: a catalogue entry is
          keyed by id and does not carry one as a field, so `char.id` is
          undefined and the URL came out as `/img/avatar/undefined.webp`. */}
      <img
        src={avatarImg(charId)}
        alt=""
        className="h-4 w-4 shrink-0 rounded-full object-cover"
        onError={(e) => { e.currentTarget.src = charImg(charId); }}
      />
      <span className="text-[11px] font-semibold text-white">{nameOf(char, lang)}</span>
      <span className="text-[9px] font-bold" style={{ color: q.color }}>{q.stars}★</span>
    </span>
  );
}

/* ---------------------------------------------------------- character modal */

/**
 * Pick a character to add to the team.
 *
 * A modal rather than a dropdown because it offers 137 characters with
 * portraits; a list that long inside a popover would be a scrollbar with a
 * search box, whereas a grid of faces is scannable at a glance.
 */
function CharacterPicker({ open, onClose, onPick }) {
  const { lang, L } = useI18n();
  const { chars, loading, error, retry } = useCharacters();
  const [q, setQ] = useState('');
  const [element, setElement] = useState(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return chars.filter((c) => {
      if (element && c.element !== element) return false;
      if (!needle) return true;
      return [c.chsName, c.enName].filter(Boolean).some((n) => n.toLowerCase().includes(needle));
    });
  }, [chars, q, element]);

  if (!open) return null;

  const ELEMENTS = ['Anemo', 'Geo', 'Electro', 'Dendro', 'Hydro', 'Pyro', 'Cryo'];

  return (
    <PickerModal
      open={open}
      onClose={onClose}
      title={L({ chs: '选择角色', en: 'Choose a character' })}
      count={list.length}
      controls={
        <>
          <PickerSearch
            value={q}
            onChange={setQ}
            placeholder={L({ chs: '搜索角色…', en: 'Search characters…' })}
          />

          {/* Element filter: the single most useful way to narrow 137 entries,
              and it needs no text at all. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setElement(null)}
              aria-label="all"
              className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[9px] font-bold transition-colors ${
                element === null
                  ? 'border-white/40 text-white'
                  : 'border-white/10 text-white/35 hover:border-white/25'
              }`}
            >
              {L({ chs: '全', en: 'All' })}
            </button>
            {ELEMENTS.map((e) => {
              const el = elementOf(e);
              const active = element === e;
              return (
                <button
                  key={e}
                  type="button"
                  onClick={() => setElement(active ? null : e)}
                  aria-label={e}
                  aria-pressed={active}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors"
                  style={{
                    borderColor: active ? el.color : 'rgba(255,255,255,0.10)',
                    backgroundColor: active ? `${el.color}22` : 'transparent',
                  }}
                >
                  {/* Element glyphs are black stencils, so they are tinted with
                      the element's own colour via the drop-shadow clipping
                      trick rather than shown as flat white. */}
                  <span style={{ width: 15, height: 15, overflow: 'hidden', display: 'inline-block' }}>
                    <img
                      src={iconImg(el.icon)}
                      alt=""
                      style={{
                        width: 15,
                        height: 15,
                        filter: `drop-shadow(${el.color} 0px -15px 0px)`,
                        transform: 'translateY(15px)',
                        display: 'block',
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      }
    >
      {loading && (
        <p className="py-10 text-center text-xs text-white/35">
          {L({ chs: '加载角色列表…', en: 'Loading characters…' })}
        </p>
      )}
      {error && (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-xs text-red-400">{error}</p>
          {/* Without this the picker stayed empty for the life of the page: the
              rejected request used to be cached forever. */}
          <button
            type="button"
            onClick={retry}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-white/60 transition-colors hover:border-white/35 hover:text-white"
          >
            {L({ chs: '重试', en: 'Retry' })}
          </button>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
        {list.map((c) => {
          const rq = qualityOf(c.qualityType);
          return (
            <button
              key={c.id}
              type="button"
              title={nameOf(c, lang)}
              onClick={() => { onPick(c.id); onClose(); }}
              // GLASS, matching the team cards this picker feeds. The 2px rarity
              // border-top is gone: across 137 tiles every one carried a
              // coloured bar, which read as chrome and made the grid noisy.
              // Rarity is still shown, by the wash behind the portrait.
              className="group relative flex flex-col items-center overflow-hidden rounded-xl border border-white/8 bg-white/[0.02] transition duration-200 hover:scale-[1.04] hover:border-white/25"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(120% 80% at 50% 0%, ${rq.color}33 0%, transparent 62%)` }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
              />
              <span className="relative block h-[78px] w-full overflow-hidden">
                <img
                  src={charImg(c.id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover object-[center_22%]"
                  onError={(e) => { e.currentTarget.src = avatarImg(c.id); }}
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1 pb-0.5 pt-2 text-center text-[10px] font-semibold text-white">
                  {nameOf(c, lang)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {!loading && !list.length && (
        <p className="py-10 text-center text-xs text-white/30">
          {L({ chs: '没有匹配的角色', en: 'No characters match' })}
        </p>
      )}
    </PickerModal>
  );
}
