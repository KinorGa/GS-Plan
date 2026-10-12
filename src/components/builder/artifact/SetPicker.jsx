// The set picker: a grid of every artifact set, filtered by name.

import { useMemo, useState } from 'react';
import { artifactIconImg, qualityOf } from '../../../game';
import { useI18n } from '../../../i18n';
import { useArtifacts } from '../../../lib/artifact';
import { PickerModal, PickerSearch } from '../controls';

/**
 * A grid of all 66 sets, each tile showing its emblem, name and rarity.
 *
 * @param {string|number|null} value  The currently equipped set id.
 * @param {Function}           onPick  Called with the new set id; the modal
 *                                     closes itself, because a set choice is a
 *                                     single decision rather than a filter.
 */
export default function SetPicker({ open, onClose, onPick, value }) {
  const { lang, L } = useI18n();
  const { list } = useArtifacts(lang);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((s) =>
      [s.chsName, s.enName].filter(Boolean).some((n) => n.toLowerCase().includes(needle))
    );
  }, [list, q]);

  return (
    <PickerModal
      open={open}
      onClose={onClose}
      title={L({ chs: '选择套装', en: 'Choose a set' })}
      count={filtered.length}
      maxWidth="max-w-[1180px]"
      controls={
        <PickerSearch
          value={q}
          onChange={setQ}
          placeholder={L({ chs: '搜索套装…', en: 'Search sets…' })}
        />
      }
    >
      <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
        {filtered.map((s) => {
          const rq = qualityOf(s.qualityType);
          const selected = String(s.id) === String(value);
          return (
            <button
              key={s.id}
              type="button"
              // A stable hook for tests and for anyone scripting the page. The
              // tiles are otherwise indistinguishable from the app's other
              // `aria-pressed` buttons (constellations, stat options), which is
              // exactly the ambiguity that makes a selector pick the wrong one.
              data-set-tile={s.id}
              title={L({ chs: s.chsName, en: s.enName })}
              aria-pressed={selected}
              onClick={() => { onPick(s.id); onClose(); }}
              className="group relative flex flex-col items-center gap-1 overflow-hidden rounded-xl border p-2 transition-colors duration-150 hover:bg-white/[0.07]"
              style={{
                // No coloured top border any more: EVERY tile carried one in its
                // rarity colour, which drowned the selection indicator and made
                // a chosen tile indistinguishable from its neighbours. Rarity is
                // still shown, by the star row, where it reads as information
                // rather than as chrome.
                borderColor: selected ? rq.color : 'rgba(255,255,255,0.09)',
                background: selected
                  ? `linear-gradient(180deg, ${rq.color}26 0%, rgba(255,255,255,0.03) 100%)`
                  : 'rgba(255,255,255,0.025)',
                boxShadow: selected
                  ? `0 0 0 1px ${rq.color}, 0 0 16px -4px ${rq.color}99, inset 0 1px 0 rgba(255,255,255,0.10)`
                  : 'inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
            >
              <span className="flex h-[62px] items-center justify-center">
                <img
                  src={artifactIconImg(s.setIcon)}
                  alt=""
                  loading="lazy"
                  className="h-full w-auto max-w-none object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] transition-transform duration-200 group-hover:scale-110"
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                />
              </span>
              <span className="w-full truncate text-center text-[10px] font-medium text-white">
                {L({ chs: s.chsName, en: s.enName })}
              </span>
              <span className="text-[9px] text-white/45">{'★'.repeat(rq.stars)}</span>

              {/* A tick, because a coloured ring alone is easy to miss in a
                  grid of sixty near-identical emblems. */}
              {selected && (
                <span
                  className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-black"
                  style={{ backgroundColor: rq.color }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!filtered.length && (
        <p className="py-10 text-center text-xs text-white/30">
          {L({ chs: '没有匹配的套装', en: 'No sets match' })}
        </p>
      )}
    </PickerModal>
  );
}
