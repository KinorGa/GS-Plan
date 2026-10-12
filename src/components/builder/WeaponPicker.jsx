// The weapon picker, as a full modal.
//
// Same surface as the character picker (see PickerModal): choosing one of 250
// weapons is the same task as choosing one of 139 characters. The previous
// version was a 330px, six-column popover anchored to the card, which showed
// barely a dozen weapons at a time and had to be scrolled in two directions.
//
// The list is filtered to weapons the character can actually equip — a sword
// user is never offered a bow — and offers a type filter for the rest.

import { useMemo, useState } from 'react';
import { qualityOf, weaponIconImg, iconImg, ICON_WHITE } from '../../game';
import { useI18n } from '../../i18n';
import { useCatalogue, weaponIconName } from '../../lib/catalogue';
import { PickerModal, PickerSearch } from './controls';

/** Weapon-type glyphs, in the order the game lists them. */
const TYPES = [
  { key: 'WEAPON_SWORD_ONE_HAND', icon: 'sword' },
  { key: 'WEAPON_CLAYMORE', icon: 'claymore' },
  { key: 'WEAPON_POLE', icon: 'polearm' },
  { key: 'WEAPON_BOW', icon: 'bow' },
  { key: 'WEAPON_CATALYST', icon: 'catalyst' },
];

export default function WeaponPicker({ open, onClose, weaponType, value, onPick }) {
  const { catalogue } = useCatalogue();
  const { L } = useI18n();
  const [q, setQ] = useState('');

  const base = catalogue?.weaponsByType?.[weaponType] || [];

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((w) =>
      [w.chsName, w.enName].filter(Boolean).some((n) => n.toLowerCase().includes(needle))
    );
  }, [base, q]);

  return (
    <PickerModal
      open={open}
      onClose={onClose}
      title={L({ chs: '选择武器', en: 'Choose a weapon' })}
      count={`${list.length} / ${base.length}`}
      controls={
        <>
          <PickerSearch
            value={q}
            onChange={setQ}
            placeholder={L({ chs: '搜索武器…', en: 'Search weapons…' })}
          />

          {/* Only the equippable type is offered here. A bow on a sword user is
              not a choice, and the other four types would quadruple the list
              with entries that cannot be selected. The inactive ones stay
              visible but dimmed, so the row reads as "this character uses a
              sword" rather than as a filter the user forgot to set. */}
          <div className="flex items-center gap-1.5">
            {TYPES.map((t) => {
              const active = t.key === weaponType;
              return (
                <span
                  key={t.key}
                  title={t.key}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                    active ? 'border-white/40 bg-white/10' : 'border-white/8'
                  }`}
                  style={{ opacity: active ? 1 : 0.22 }}
                >
                  <img
                    src={iconImg(t.icon)}
                    alt=""
                    style={{ width: 15, height: 15, filter: ICON_WHITE }}
                    className="object-contain"
                  />
                </span>
              );
            })}
            <span className="ml-1 text-[10px] text-white/30">
              {L({ chs: '仅显示可装备类型', en: 'equippable type only' })}
            </span>
          </div>
        </>
      }
    >
      {!base.length && (
        <p className="py-10 text-center text-xs text-white/35">
          {L({ chs: '正在加载武器列表…', en: 'Loading weapons…' })}
        </p>
      )}

      {/* Larger, labelled tiles than the character grid: a weapon icon is the
          only thing distinguishing 250 entries, so it needs room to be read. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {list.map((w) => {
          const rq = qualityOf(w.qualityType);
          const selected = w.id === value;
          return (
            <button
              key={w.id}
              type="button"
              title={L({ chs: w.chsName, en: w.enName })}
              onClick={() => { onPick(w.id); onClose(); }}
              // GLASS, matching the character picker and the team cards. The 2px
              // rarity border-top is gone: every tile carried one, so it read as
              // chrome across a grid of 90 weapons and fought the selection ring.
              // Rarity moves to the wash behind the art and to the star row, both
              // of which say the same thing without banding the tile.
              className="group relative flex flex-col items-center gap-1 overflow-hidden rounded-xl border bg-white/[0.02] p-2 backdrop-blur-md transition-colors hover:bg-white/[0.06]"
              style={{
                borderColor: selected ? rq.color : 'rgba(255,255,255,0.08)',
                boxShadow: selected
                  ? `0 0 0 1px ${rq.color}, 0 0 16px -4px ${rq.color}99`
                  : 'inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(120% 80% at 50% 0%, ${rq.color}2e 0%, transparent 62%)` }}
              />
              <span className="relative flex h-[68px] items-center justify-center">
                <img
                  src={weaponIconImg(weaponIconName(w.weaponIcon))}
                  alt=""
                  loading="lazy"
                  // Weapon art is 512x1024 with wide transparent margins, so it
                  // is fitted by height and allowed to overflow the width.
                  className="h-full w-auto max-w-none object-contain transition-transform duration-200 group-hover:scale-110"
                />
              </span>
              <span className="relative w-full truncate text-center text-[10px] font-medium text-white">
                {L({ chs: w.chsName, en: w.enName })}
              </span>
              <span className="relative text-[9px]" style={{ color: rq.color }}>
                {rq.stars}★
                {w.ascensionStats?.atk != null && (
                  <span className="ml-1 text-white/30">ATK {w.ascensionStats.atk}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {base.length > 0 && !list.length && (
        <p className="py-10 text-center text-xs text-white/30">
          {L({ chs: '没有匹配的武器', en: 'No weapons match' })}
        </p>
      )}
    </PickerModal>
  );
}
