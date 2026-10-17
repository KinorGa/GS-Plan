// The artifact row: one panel holding five individually configured slots.

import { qualityOf } from '../../../game';
import { useI18n } from '../../../i18n';
import {
  SLOTS, activeBonuses, dominantSetOf, useArtifacts, withPiece,
} from '../../../lib/artifact';
import { activeArtifacts, normaliseArtifacts, setArtifactSlots } from '../../../lib/artifact-sets';
import PieceSlot from './PieceSlot';
import BonusChips from './BonusChips';
import ArtifactSetTabs from './ArtifactSetTabs';
import ArtifactTotals from './ArtifactTotals';
import ArtifactScan from './ArtifactScan';
import ArtifactOptimize from './ArtifactOptimize';

/**
 * Five artifact slots, each configured independently.
 *
 * WHY THE SLOTS ARE INDEPENDENT: "4-piece X + 1 off-piece" is the normal build,
 * so the five slots cannot share one set selection. Each slot owns
 * `{ setId, mainStat, level, subStats }` and this component only fans the
 * change back out.
 *
 * @param {object}   [value]     The unit's artifact CONTAINER ({ active, sets }).
 *                              A bare five-slot build is accepted and migrated,
 *                              so a caller holding an old shape still works.
 * @param {Function} onChange    Called with a whole new CONTAINER.
 * @param {Function} [onRemove]  Omit to hide the remove control.
 * @param {string}   [charId]    Whose build this is. The optimiser is per
 *                              character (artifacts only move their owner's
 *                              damage), and it needs the id to find that
 *                              character's damage entries.
 * @param {object}   [optimize]  `{ entries, team, catalogue, talentDamage }` --
 *                              what the optimiser merges. Omitted by a caller
 *                              that has no axis in hand, which hides the button.
 */
export default function ArtifactRow({ value, onChange, onRemove, charId, optimize }) {
  const { lang, L } = useI18n();
  const { sets, list, error, retry, loading } = useArtifacts(lang);

  // One normalisation at the boundary: everything below this line deals with a
  // container, and `activeArtifacts` resolves which build is in use.
  const artifacts = normaliseArtifacts(value);
  const build = activeArtifacts({ artifacts }) || {};
  const bonuses = activeBonuses(build);

  // The accent follows whichever set holds the most slots, so the panel takes
  // on the colour of the build rather than an arbitrary one.
  const accent = qualityOf(dominantSetOf(sets, bonuses)?.qualityType || 'QUALITY_ORANGE').color;
  // A slot edit lands on the ACTIVE build only, so editing one configuration
  // never touches another.
  const patchSlot = (slotKey, next) =>
    onChange(setArtifactSlots(artifacts, artifacts.active, withPiece(build, slotKey, next)));

  return (
    <div
      data-artifact-row
      // Glass treatment matching the rest of the app: a translucent panel over a
      // blurred backdrop, with a rarity-tinted wash and hairline highlight so
      // the card reads as a raised surface rather than a flat box.
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025] p-3 shadow-2xl shadow-black/60 backdrop-blur-xl"
    >
      {/* Rarity wash from the dominant set, and a top highlight, both purely
          decorative so they sit behind the content and ignore pointer events. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{ background: `radial-gradient(120% 90% at 12% 0%, ${accent} 0%, transparent 62%)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />

      <div className="relative mb-2.5 flex items-center gap-2">
        <h3 className="text-[12px] font-bold tracking-wide text-white">
          {L({ chs: '圣遗物', en: 'Artifacts' })}
        </h3>

        <BonusChips bonuses={bonuses} sets={sets} />

        {/* THE OPTIMISER, beside the remove control because both act on the whole
            configuration rather than on one slot. It is the one place in the row
            that asks a question about the FUTURE of the build -- "which substat
            allocation is best" -- rather than about what is on the pieces.
            They share one right-aligned cluster so the chips keep the left and
            the controls keep the right, whichever of the two is present. */}
        <div className="ml-auto flex items-center gap-1.5">
          <ArtifactOptimize charId={charId} build={build} optimize={optimize} />
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded px-1 text-[11px] text-white/25 transition-colors hover:text-white/80"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* THE CONFIGURATIONS, on their own line under the panel title: they name
          and select the build, which is a different question from the bonus chips
          beside the title (what the CURRENT build gives). A separate line keeps
          the tabs from competing with the chips for the same row, which is where
          they would wrap awkwardly at a handful of builds. */}
      <div className="relative mb-2.5">
        <ArtifactSetTabs artifacts={artifacts} onChange={onChange} />
      </div>

      {loading && (
        <p className="py-6 text-center text-[11px] text-white/30">
          {L({ chs: '加载套装数据…', en: 'Loading sets…' })}
        </p>
      )}

      {error && <LoadError error={error} onRetry={retry} />}

      {!loading && !error && (
        /* THE SLOTS AND THE TOTALS READ AS ONE ROW. The totals panel is the last
           child of the same flex track, so it scrolls with the five slots and
           sits where the empty width already was -- a summary placed BELOW the
           row would be pushed off-screen by five 178px cards on a narrow column,
           which is where this is read. It stretches to the tallest slot, so the
           two columns share a baseline instead of the summary floating. */
        /* THE TOP PADDING IS LOAD-BEARING, not spacing. A slot's clear button
           sits at `-top-1.5` -- OUTSIDE the slot's own box -- and `overflow-x-auto`
           makes the other axis clip too, so with no room above them every ✕ was
           cut in half by the scroll track. `pt-2` gives the row the few pixels the
           buttons stick out by. */
        <div data-artifact-slots className="flex items-stretch gap-2.5 overflow-x-auto pb-1 pt-2">
          {SLOTS.map((s) => (
            <PieceSlot
              key={s.key}
              slotKey={s.key}
              piece={build[s.key]}
              sets={sets}
              onChange={(next) => patchSlot(s.key, next)}
            />
          ))}
          <ArtifactTotals build={build} />
          {/* READ A SCREENSHOT INTO THE ROW. Last in the flex track, in the empty
              width the totals panel leaves: the row is where a build is entered,
              and entering one by eye off a screenshot is the slow path. It writes
              through the same `onChange` the slots do, so a scanned piece is
              indistinguishable from a hand-entered one afterwards. */}
          <ArtifactScan
            build={build}
            sets={sets}
            list={list}
            onApply={(next) => onChange(setArtifactSlots(artifacts, artifacts.active, next))}
          />
        </div>
      )}
    </div>
  );
}

/** A failed catalogue load, with the retry that a page reload used to require. */
function LoadError({ error, onRetry }) {
  const { L } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <p className="text-[11px] text-red-400">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-white/15 px-3 py-1 text-[10px] text-white/60 hover:border-white/35 hover:text-white"
      >
        {L({ chs: '重试', en: 'Retry' })}
      </button>
    </div>
  );
}
