import { Link } from 'react-router-dom';
import { elementOf, weaponOf, qualityOf, nameOf, fmt, iconImg, ICON_WHITE } from '../game';
import CharacterArt from './CharacterArt.jsx';
import { useI18n } from '../i18n';

// Reproduces the original card's exact structure and animation:
//
//   <a class="group ... hover:scale-[1.025]">            <- whole card scales 1.025
//     <button pin>                                       <- fades in on hover
//     <div aspect-[2/5] rounded-xl border overflow-hidden bg-[#0a0a0a]>
//       <img object-cover origin-[center_27%]             <- scales 1.0 -> 1.1
//            group-hover:scale-[1.1]>
//       <div gradient from-black via-black/25>            <- scrim
//       <div flex-col justify-end items-center text-center>
//         <div translate-y-2 group-hover:translate-y-0>   <- text block rises
//           <h3 name: 22px bold, centered, drop-shadow>
//           <element 28px + weapon 28px icons>
//           <stats max-h-0 opacity-0 -> max-h-[120px] opacity-100>
export default function CharacterCard({ id, char, linkTo }) {
  const { lang, t } = useI18n();
  const el = elementOf(char.element);
  const wq = weaponOf(char.weaponType);
  const q = qualityOf(char.qualityType);
  const s = char.ascensionStats || {};
  const name = nameOf(char, lang);

  // In the grid the card navigates to the character page; on the standalone
  // page it is inert (no router context), so fall back to a plain wrapper.
  const Wrapper = linkTo ? Link : 'div';
  const wrapperProps = linkTo ? { to: linkTo } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className="group relative block outline-none ring-0 transition-transform duration-300 ease-out hover:scale-[1.025] focus:outline-none focus:ring-0"
    >
      {/* Pin button - appears only on hover, as on the original. */}
      <button
        type="button"
        title={lang === 'chs' ? '固定角色' : 'Pin Character'}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="absolute left-2 top-2 z-20 -translate-y-[5px] rounded-lg border border-white/10 bg-black/60 p-1.5 text-white/70 opacity-0 backdrop-blur-sm transition duration-200 hover:bg-black/80 hover:text-white group-hover:translate-y-0 group-hover:opacity-100"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 17v5" />
          <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
        </svg>
      </button>

      <CharacterArt
        id={id}
        char={char}
        lang={lang}
        name={name}
        className="aspect-[2/5]"
      >
        {/* Stats: collapsed by default, revealed on hover. */}
        <div className="flex max-h-0 w-full flex-col gap-1 overflow-hidden opacity-0 transition-[max-height,opacity] duration-500 ease-out group-hover:max-h-[120px] group-hover:opacity-100">
          <StatRow left={['hp_base', fmt(s.hp)]} right={['atk_base', fmt(s.atk)]} />
          <StatRow
            left={['def_base', fmt(s.def)]}
            right={['critdmg', s['CRIT DMG%'] != null ? s['CRIT DMG%'] + '%' : '—']}
          />
        </div>
      </CharacterArt>
    </Wrapper>
  );
}

function StatRow({ left, right }) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-8">
      <StatCell icon={left[0]} value={left[1]} align="start" />
      <StatCell icon={right[0]} value={right[1]} align="end" />
    </div>
  );
}

function StatCell({ icon, value, align }) {
  return (
    <div className={`flex items-center gap-2 ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
      <img
        src={iconImg(icon)}
        alt={icon}
        width={14}
        height={14}
        style={{ width: 14, height: 14, filter: ICON_WHITE }}
        className="object-contain"
      />
      <span className="whitespace-nowrap text-sm font-bold text-white drop-shadow-md">{value}</span>
    </div>
  );
}
