// The 2-piece / 4-piece readout for an artifact build.

import { useI18n } from '../../../i18n';

/**
 * One chip per active set bonus.
 *
 * These are DERIVED from the five slots rather than stored: two slots of one set
 * is a 2-pc, four is a 4-pc, and the slots are independent, so storing them
 * would let the chips disagree with the row above them.
 *
 * The tooltip carries the set's own bonus text when the catalogue has it, and
 * falls back to the bare "2-pc" / "4-pc" wording when it does not. The English
 * side is left empty on that path on purpose: the bonus descriptions are
 * Chinese-only upstream, and the fallback is what an English reader sees.
 *
 * @param {Array}  bonuses  `[{ setId, pieces }]`, from `activeBonuses(build)`.
 * @param {object} sets     setId -> set, for the names.
 */
export default function BonusChips({ bonuses, sets }) {
  const { L } = useI18n();

  const bonusText = (setId, pieces) =>
    sets?.[setId]?.bonuses?.[`${pieces}pc`]?.description;

  // The wrapper is rendered even with no bonuses. An empty flex row costs
  // nothing visually, and keeping the element means the row's header is the
  // same node tree whether or not a set bonus is active -- which is what the
  // pre-refactor markup did.
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(bonuses || []).map((b) => {
        const text = bonusText(b.setId, b.pieces);
        return (
          <span
            key={`${b.setId}-${b.pieces}`}
            title={L(
              text
                ? { chs: text, en: '' }
                : b.pieces === 4
                  ? { chs: '4件套', en: '4-pc' }
                  : { chs: '2件套', en: '2-pc' }
            )}
            className="rounded-md border border-[#7fd4c1]/30 px-1.5 py-0.5 text-[9px] font-semibold text-[#7fd4c1]"
            style={{
              background: 'linear-gradient(180deg, rgba(127,212,193,0.20) 0%, rgba(127,212,193,0.08) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(127,212,193,0.25)',
            }}
          >
            {b.pieces} · {L({ chs: sets?.[b.setId]?.chsName, en: sets?.[b.setId]?.enName })}
          </span>
        );
      })}
    </div>
  );
}
