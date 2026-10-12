import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const I18N = {
  chs: {
    characters: '角色',
    weapons: '武器',
    filter: '筛选',
    search: '搜索角色...',
    all: '全部',
    element: '元素',
    weapon: '武器',
    quality: '稀有度',
    rarity: '星级',
    back: '返回',
    stats: '基础属性',
    hp: '生命值',
    atk: '攻击力',
    def: '防御力',
    critdmg: '暴击伤害',
    lv: '等级',
    skills: '天赋',
    constellations: '命之座',
    passives: '固有天赋',
    ascension: '突破材料',
    noresult: '没有符合条件的角色',
    found: '位角色',
    notice: '提示',
    noticeText: '本页为 lunaris.moe 的本地静态复现，数据与图片均取自公开 API。',
    attributes: '属性成长',
    level: '等级',
    notFound: '找不到这个角色',
    notFoundHint: '该角色的详情数据不在本地数据集中。',
    retry: '重试',
    expand: '展开',
    collapse: '收起',
    birthday: '生日',
    affiliation: '所属',
    basicInfo: '基本信息',
    notImplemented: '该页签尚未在本复现中实现。',
    floor: (i) => `第 ${i} 层`,
    tabInfo: '角色信息',
    tabSkills: '天赋',
    tabConstellations: '命之座',
    tabEchoes: '回声',
    tabCostumes: '服装',
    tabStories: '故事',
    tabVoicelines: '语音',
    tabAssets: '资源',
    tabDiffs: '改动',
  },
  en: {
    characters: 'Characters',
    weapons: 'Weapons',
    filter: 'Filter',
    search: 'Search characters...',
    all: 'All',
    element: 'Element',
    weapon: 'Weapon',
    quality: 'Quality',
    rarity: 'Rarity',
    back: 'Back',
    stats: 'Base Stats',
    hp: 'HP',
    atk: 'ATK',
    def: 'DEF',
    critdmg: 'CRIT DMG',
    lv: 'Level',
    skills: 'Talents',
    constellations: 'Constellations',
    passives: 'Passive Talents',
    ascension: 'Ascension Materials',
    noresult: 'No characters match your filters',
    found: 'characters',
    notice: 'Notice',
    noticeText: 'Local static reproduction of lunaris.moe. Data and images come from its public API.',
    attributes: 'Attribute Growth',
    level: 'Level',
    notFound: 'Character not found',
    notFoundHint: 'This character has no detail data in the local dataset.',
    retry: 'Retry',
    expand: 'Expand',
    collapse: 'Collapse',
    birthday: 'Birthday',
    affiliation: 'Affiliation',
    basicInfo: 'Basic Information',
    notImplemented: 'This tab is not implemented in this reproduction.',
    floor: (i) => `Level ${i}`,
    tabInfo: 'Character Information',
    tabSkills: 'Skills',
    tabConstellations: 'Constellations',
    tabEchoes: 'Echoes',
    tabCostumes: 'Costumes',
    tabStories: 'Stories',
    tabVoicelines: 'Voicelines',
    tabAssets: 'Assets',
    tabDiffs: 'Diffs',
  },
};

const Ctx = createContext(null);

const LANGS = ['chs', 'en'];

/** Only the two languages that actually exist; anything else falls back. */
const readStoredLang = () => {
  try {
    const v = localStorage.getItem('lunaris-lang');
    return LANGS.includes(v) ? v : 'chs';
  } catch {
    // Private mode / storage disabled — a missing preference is not an error.
    return 'chs';
  }
};

export function I18nProvider({ children }) {
  // Validated on read: a stale or hand-edited key used to flow straight through
  // to `I18N[lang]`, which is `undefined` for any unknown value and blanked
  // every label on the page.
  const [lang, setLang] = useState(readStoredLang);
  useEffect(() => {
    localStorage.setItem('lunaris-lang', lang);
    document.documentElement.lang = lang === 'chs' ? 'zh-CN' : 'en';
  }, [lang]);
  const value = useMemo(
    () => ({ lang, setLang, t: I18N[lang] ?? I18N.chs, L: pickFor(lang) }),
    [lang]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Pick the current language out of a `{ chs, en }` pair.
 *
 * Exposed on the context as `L` because six components had each written the
 * same `lang === 'chs' ? o.chs : o.en` line locally, and the copies had begun
 * to differ in how they handled a missing pair. One implementation, one
 * behaviour: anything falsy renders as an empty string rather than throwing on
 * `undefined.chs`.
 */
const pickFor = (lang) => (o) => (o ? (lang === 'chs' ? o.chs : o.en) : '');

// A context-free fallback, so a component that calls `useI18n()` still renders
// when it is dropped into a tree without <I18nProvider> (e.g. DamageCard reused
// on another page or in another app). Without this, `useI18n()` returned null
// and destructuring `{ lang }` threw, blanking the whole subtree.
const FALLBACK = { lang: 'chs', setLang: () => {}, t: I18N.chs, L: pickFor('chs') };

export const useI18n = () => useContext(Ctx) ?? FALLBACK;
