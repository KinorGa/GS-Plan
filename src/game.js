// Game-domain mappings shared by the list and detail views.

export const VERSION = '7.1.0';

// Element key -> icon file, Chinese label, and the icon tint colour.
// Colours are the exact RGB values the original passes to drop-shadow().
export const ELEMENTS = {
  Cryo: { icon: 'cryo', zh: '冰', color: 'rgb(153, 255, 255)' },
  Pyro: { icon: 'pyro', zh: '火', color: 'rgb(255, 153, 153)' },
  Hydro: { icon: 'hydro', zh: '水', color: 'rgb(128, 192, 255)' },
  Electro: { icon: 'electro', zh: '雷', color: 'rgb(255, 172, 255)' },
  Anemo: { icon: 'anemo', zh: '风', color: 'rgb(128, 255, 215)' },
  Geo: { icon: 'geo', zh: '岩', color: 'rgb(255, 230, 153)' },
  Dendro: { icon: 'dendro', zh: '草', color: 'rgb(153, 255, 136)' },
};

export const WEAPONS = {
  WEAPON_SWORD_ONE_HAND: { icon: 'sword', zh: '单手剑', en: 'Sword' },
  WEAPON_CLAYMORE: { icon: 'claymore', zh: '双手剑', en: 'Claymore' },
  WEAPON_POLE: { icon: 'polearm', zh: '长柄武器', en: 'Polearm' },
  WEAPON_BOW: { icon: 'bow', zh: '弓', en: 'Bow' },
  WEAPON_CATALYST: { icon: 'catalyst', zh: '法器', en: 'Catalyst' },
};

// Rarity -> card border/background accent, mirroring the in-game quality colours.
export const QUALITY = {
  QUALITY_ORANGE: { stars: 5, color: '#ffb13f', grad: 'from-[#8a5a1e]/45' },
  QUALITY_PURPLE: { stars: 4, color: '#c9a6ff', grad: 'from-[#5b3f8a]/45' },
  QUALITY_BLUE: { stars: 3, color: '#5fb8ff', grad: 'from-[#2a5b8a]/45' },
  QUALITY_GREEN: { stars: 2, color: '#7fe3c0', grad: 'from-[#2a6b55]/45' },
};

export const elementOf = (key) => ELEMENTS[key] || { icon: 'unknown', zh: key, color: 'rgb(255, 255, 255)' };
export const weaponOf = (key) => WEAPONS[key] || { icon: 'unknown', zh: key, en: key };
export const qualityOf = (key) =>
  QUALITY[key] || { stars: 5, color: '#ffb13f', grad: 'from-[#8a5a1e]/45' };

// name = locale-aware character name field
export const nameOf = (c, lang) =>
  lang === 'chs' ? c.chsName : lang === 'en' ? c.enName : c.chsName;

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

export const charImg = (id) => `/img/char/${id}.webp`;
export const iconImg = (n) => `/img/icons/${n}.webp`;
export const avatarImg = (id) => `/img/avatar/${id}.webp`;
export const itemImg = (n) => `/img/item/${n}.webp`;
export const skillImg = (n) => `/img/skill/${n}.webp`;
export const talentImg = (n) => `/img/talent/${n}.webp`;
export const weaponIconImg = (n) => `/img/weapon/${n}.webp`;
export const artifactIconImg = (n) => `/img/artifact/${n}.webp`;

/**
 * Resolve a talent-ish icon name to the file that holds it.
 *
 * The local mirror splits these by kind and there is NO overlap between the two
 * folders (verified: every `UI_Talent_*` is in img/talent/, every `Skill_*` and
 * `UI_Avatar_*` is in img/skill/), so the name alone decides:
 *
 *   UI_Talent_S_Varka_01  -> img/talent/   constellations & passives
 *   Skill_E_Varka_01      -> img/skill/    active talents
 *   Skill_A_04            -> img/skill/    shared normal-attack icon
 *
 * EVERY caller that renders one of these must use this, not `talentImg` or
 * `skillImg` directly: those hardcode a folder, and using the wrong one makes
 * the browser request a file that does not exist. The damage card's source menu
 * previously called `talentImg` for active talents, so its icons silently 404'd
 * and the `onError` style hid them.
 */
export const talentIconImg = (n) => {
  const name = String(n || '');
  return name.startsWith('UI_Talent') ? talentImg(name) : skillImg(name);
};

/* ------------------------------------------------------------ icon tinting */

/*
 * Some icons in this project are BLACK SILHOUETTES on transparency and some are
 * finished colour artwork. Drawing a silhouette untinted on a near-black card
 * makes it invisible, so those must be recoloured — but recolouring the colour
 * artwork destroys it.
 *
 * Measured from the files themselves:
 *
 *   icons/anemo.webp               avg rgb(0,0,0)       sat 0.00  silhouette
 *   icons/claymore.webp            avg rgb(246,246,246) sat 0.00  white art
 *   artifacts/UI_RelicIcon_*.webp  avg rgb(181,169,119) sat 0.48  colour art
 *   weapon/UI_Gacha_EquipIcon_*    avg rgb(173,185,158) sat 0.27  colour art
 *
 * The distinction is a property of the DIRECTORY, not of the icon's name: every
 * file under `icons/` is a single-colour stencil, and every file under
 * `artifact/` and `weapon/` is colour artwork. Keying off the name meant every
 * newly added icon had to be remembered in a list here, and the gear icons were
 * duly missed — they were flattened to white on first render.
 */

/** Directories whose icons are single-colour stencils needing recolouring. */
const STENCIL_DIRS = ['/img/icons/'];

/**
 * True when `src` points at a stencil that must be recoloured to be visible.
 *
 * Takes the resolved URL rather than a bare name, because that is the only
 * thing that encodes which directory the icon actually came from.
 */
export const isStencilIcon = (src) =>
  STENCIL_DIRS.some((d) => String(src || '').includes(d)) &&
  // Weapons and the logo are white artwork inside `icons/`, so they are already
  // visible and must not be flattened.
  !/\/(bow|catalyst|claymore|polearm|sword|logo|unknown)\.webp$/.test(String(src || ''));

/** Flattens a stencil to pure white; the form most of the UI wants. */
export const ICON_WHITE = 'brightness(0) invert(1)';
