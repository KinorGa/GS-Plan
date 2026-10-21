// The summed stat readout beside the five artifact slots.
//
// WHY THIS EXISTS
//   Five pieces, each with a main stat and four substats, is twenty-five numbers
//   in a row -- and the five columns are read one at a time to answer a question
//   that is really about the WHOLE build: "how much CRIT Rate am I actually
//   wearing?" Asking that of the row means adding up ten numbers by eye across
//   four cards. This panel does it once, in the vocabulary the pieces are
//   entered in (生命值, 攻击力加成, 暴击率...), so the build can be read at a
//   glance rather than assembled in the reader's head.
//
// WHAT IT IS NOT
//   It is NOT the damage panel. That panel's `攻击力` is the character's base
//   plus a percentage of it; this is only what the ARTIFACTS contribute. Keeping
//   the two apart is deliberate: a total here that already folded in the
//   character's base would move when the character changed and stop answering
//   "what did I farm?". The panel keeps its own derived numbers.

import { useI18n } from '../../../i18n';
import {
  TOTAL_ORDER, artifactStatTotals, formatStat, statMeta,
} from '../../../lib/artifact';
import { StatGlyph } from './StatGlyph';

export default function ArtifactTotals({ build, totals: providedTotals }) {
  const { L } = useI18n();

  const totals = providedTotals || artifactStatTotals(build);
  // TOTAL_ORDER first, then anything a future key added that the order does not
  // yet name -- so a new stat shows up rather than silently disappearing. Sorted
  // so the tail is stable instead of insertion-ordered.
  const shown = [
    ...TOTAL_ORDER.filter((k) => totals[k]),
    ...Object.keys(totals).filter((k) => !TOTAL_ORDER.includes(k)).sort(),
  ];

  return (
    <div
      data-artifact-totals
      className="flex w-[168px] shrink-0 flex-col self-stretch rounded-xl border border-white/[0.07] bg-white/[0.02] p-2"
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/45">
          {L({ chs: '词条合计', en: 'Stat Totals' })}
        </p>
        <span className="text-[9px] text-white/25">{shown.length}</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-3 text-center text-[10px] leading-relaxed text-white/25">
          {L({ chs: '还没有词条', en: 'No stats yet' })}
        </p>
      ) : (
        <div className="flex flex-col gap-[3px]">
          {shown.map((key) => {
            const meta = statMeta(key);
            const value = totals[key];
            return (
              <div
                key={key}
                data-total-row={key}
                className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-[3px]"
              >
                <StatGlyph stat={key} size={13} />
                <span className="min-w-0 flex-1 truncate text-[10px] text-white/70" title={L(meta)}>
                  {L(meta)}
                </span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-white">
                  {formatStat(value)}
                </span>
                {meta.suffix && (
                  <span className="shrink-0 text-[9px] text-white/35">{meta.suffix}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
