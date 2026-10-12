import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { elementOf, weaponOf, qualityOf, nameOf, fmt, avatarImg, charImg, iconImg, skillImg, talentIconImg, itemImg, ICON_WHITE } from '../game';
import { richText, toArray } from '../richtext';
import { useI18n } from '../i18n';

/*
 * The panel shown when a character cannot be displayed.
 *
 * It keeps the Back link, which the previous inline error text did not: a user
 * who clicked a character with no local data (charlist.json is one entry longer
 * than the detail set) was left on a dead page with no way out but the browser
 * button.
 */
function Notice({ t, title, body, tone = 'muted' }) {
  return (
    <div className="container mx-auto px-4 py-6">
      <Link
        to="/char"
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        ← {t.back}
      </Link>
      <div
        className={`rounded-2xl border border-white/10 bg-[#0a0a0a] p-8 text-center ${
          tone === 'error' ? 'text-red-400' : 'text-muted-foreground'
        }`}
      >
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-2 text-xs opacity-70">{body}</p>
      </div>
    </div>
  );
}

// Tab order, matching the original (Character Information / Skills /
// Constellations / Echoes / Costumes / Stories / Voicelines / Assets / Diffs).
// The labels live in I18N so there is ONE translation table rather than this
// array being a second, easily-drifted one.
const TABS = [
  { key: 'info', label: 'tabInfo' },
  { key: 'skills', label: 'tabSkills' },
  { key: 'constellations', label: 'tabConstellations' },
  { key: 'echoes', label: 'tabEchoes' },
  { key: 'costumes', label: 'tabCostumes' },
  { key: 'stories', label: 'tabStories' },
  { key: 'voicelines', label: 'tabVoicelines' },
  { key: 'assets', label: 'tabAssets' },
  { key: 'diffs', label: 'tabDiffs' },
];

const SKILL_KEYS = ['normalattack', 'elementalskill', 'elementalburst'];

export default function CharDetail() {
  const { id } = useParams();
  const { lang, t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  // `null` while in flight; `'missing'` is the 404 case, which is NOT an error
  // worth an error page — the character simply has no local detail file.
  const [state, setState] = useState('loading');
  const [err, setErr] = useState(null);

  const tab = params.get('tab') || 'skills';
  const setTab = (k) => setParams({ tab: k }, { replace: true });

  // The charlist is a nicety (it supplies the fallback element/name when a
  // detail file omits them). A failure here must degrade, not abort the page.
  useEffect(() => {
    let cancelled = false;
    setList(null);
    fetch('/data/charlist.json')
      .then((r) => {
        // Same SPA-fallback caveat as the detail fetch: a 200 does not imply
        // JSON. Anything unusable degrades to `{}` below rather than throwing,
        // because this file only supplies fallback names/stats.
        const type = r.headers.get('content-type') || '';
        return r.ok && type.includes('json') ? r.json() : {};
      })
      .then((j) => { if (!cancelled) setList(j); })
      .catch(() => { if (!cancelled) setList({}); });
    return () => { cancelled = true; };
  }, []);

  // The detail fetch is the one the page actually needs. It is guarded against
  // the [id, lang] race: toggling the language while a slow response is in
  // flight would otherwise let the OLD language's payload land last and render
  // a Chinese body under English chrome.
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setErr(null);
    setState('loading');

    fetch(`/data/char/${lang}/${id}.json`)
      .then((r) => {
        if (!r.ok) {
          const e = new Error('HTTP ' + r.status);
          e.missing = r.status === 404;
          throw e;
        }
        // A missing data file does NOT produce a 404 here: the static server
        // falls back to index.html for unknown paths (SPA routing), so the
        // response is 200 with an HTML body. Parsing it would throw a raw
        // "Unexpected token '<'" that means nothing to a user, so detect the
        // fallback and treat it as "this character has no detail file" —
        // charlist.json lists 137 ids but only 136 detail files ship.
        const type = r.headers.get('content-type') || '';
        if (!type.includes('json')) {
          const e = new Error('not json');
          e.missing = true;
          throw e;
        }
        return r.json();
      })
      .then((j) => {
        if (cancelled) return;
        setDetail(j);
        setState('ready');
      })
      .catch((e) => {
        if (cancelled) return;
        if (e.missing) setState('missing');
        else { setErr(e.message); setState('error'); }
      });

    return () => { cancelled = true; };
  }, [id, lang]);

  if (state === 'missing') return <Notice id={id} t={t} title={t.notFound} body={t.notFoundHint} />;
  if (state === 'error') {
    return <Notice id={id} t={t} title={t.notFound} body={err} tone="error" />;
  }
  if (state === 'loading' || !list || !detail) {
    return <div className="container mx-auto px-4 py-10 text-muted-foreground">Loading…</div>;
  }

  const base = list[id] || {};
  const info = detail.info || {};
  const el = elementOf(info.element || base.element);
  const wq = weaponOf(info.weapon || base.weaponType);
  const q = qualityOf(info.rarity || base.qualityType);
  const s = base.ascensionStats || {};
  const name = info.name || nameOf(base, lang);

  return (
    <div className="container mx-auto px-4 py-6">
      <Link to="/char" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        ← {t.back}
      </Link>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <ProfileCard
          id={id}
          name={name}
          info={info}
          el={el}
          wq={wq}
          q={q}
          s={s}
          lang={lang}
          t={t}
        />

        <div className="space-y-8">
          {/* Sticky tab bar - matches the original's top-[70px] / rounded-2xl strip. */}
          <div className="sticky top-[70px] z-40 mb-8 flex flex-wrap gap-2 rounded-2xl border border-white/5 bg-[#0a0a0a]/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-md">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`rounded-xl px-6 py-2.5 text-sm font-semibold tracking-wide transition-colors duration-200 ${
                  tab === tb.key
                    ? 'bg-[#27272a] text-white ring-1 ring-white/10'
                    : 'text-white/40 hover:bg-white/5 hover:text-white'
                }`}
              >
                {t[tb.label]}
              </button>
            ))}
          </div>

          {tab === 'skills' && <SkillsTab detail={detail} t={t} />}
          {tab === 'constellations' && <ConstellationsTab detail={detail} t={t} />}
          {tab === 'info' && <InfoTab detail={detail} lang={lang} t={t} />}
          {!['skills', 'constellations', 'info'].includes(tab) && (
            <p className="text-sm text-muted-foreground">
              {t.notImplemented}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

function ProfileCard({ id, name, info, el, wq, q, s, lang, t }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black/40">
      <img
        src={avatarImg(id)}
        alt={name}
        className="mx-auto h-[360px] w-full bg-gradient-to-b from-white/5 to-transparent object-contain"
        onError={(e) => {
          e.currentTarget.src = charImg(id);
        }}
      />
      <div className="space-y-2 p-4">
        <h1 className="text-2xl font-bold">{name}</h1>
        {info.title && <p className="text-sm text-muted-foreground">{info.title}</p>}
        <div className="flex items-center gap-3 pt-1">
          {/* The element icon is a black silhouette, so it needs recolouring to
              be visible; the weapon icon is already white artwork. */}
          <img
            src={iconImg(el.icon)}
            alt={info.element}
            className="h-5 w-5"
            style={{ filter: ICON_WHITE }}
          />
          <img src={iconImg(wq.icon)} alt={wq.en} className="h-5 w-5" />
          <span className="text-xs text-muted-foreground">
            {lang === 'chs' ? wq.zh : wq.en} · {q.stars}★
          </span>
        </div>
        {info.description && <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{info.description}</p>}

        <div className="grid grid-cols-2 gap-2 pt-3">
          <StatBox icon="hp_base" label={t.hp} value={fmt(s.hp)} />
          <StatBox icon="atk_base" label={t.atk} value={fmt(s.atk)} />
          <StatBox icon="def_base" label={t.def} value={fmt(s.def)} />
          <StatBox icon="critdmg" label={t.critdmg} value={s['CRIT DMG%'] != null ? s['CRIT DMG%'] + '%' : '—'} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- skills */

function SkillsTab({ detail, t }) {
  const { lang } = useI18n();
  const skills = SKILL_KEYS.map((k) => ({ key: k, ...(detail.skills?.[k] || {}) })).filter((x) => x.name);
  const passives = toArray(detail.passives);
  if (!skills.length && !passives.length) return null;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {skills.map((sk) => (
          <SkillCard key={sk.key} skill={sk} />
        ))}
      </div>

      {passives.length > 0 && (
        <div>
          <h2 className="mb-3 border-b border-border pb-2 text-lg font-semibold">
            {t.passives}
          </h2>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {passives.map((p, i) => (
              <div key={i} className="flex flex-col rounded-2xl border border-white/5 bg-[#0a0a0a] p-6">
                <div className="mb-4 flex shrink-0 flex-col items-center">
                  {p.icon && (
                    <img
                      src={talentIconImg(p.icon)}
                      alt={p.name}
                      className="mb-3 h-16 w-16 object-contain"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  <h3 className="text-center text-xl font-bold text-white">{p.name}</h3>
                </div>
                <div
                  className="text-sm font-light leading-relaxed text-white/70"
                  dangerouslySetInnerHTML={{ __html: richText(p.description) }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill }) {
  const { t } = useI18n();
  const levels = maxLevels(skill);
  const [lv, setLv] = useState(10); // 1-based, matching the original's default Lv.10
  const [expanded, setExpanded] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(false);
  const descRef = useRef(null);

  // Show the top/bottom fade only when the description can still scroll that way.
  const onDescScroll = () => {
    const el = descRef.current;
    if (!el) return;
    setAtTop(el.scrollTop <= 2);
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
  };

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setAtTop(true);
    setAtBottom(el.scrollHeight <= el.clientHeight + 2);
  }, [skill.name]);

  const rows = Object.entries(skill.multipliers || {});
  const shown = expanded ? rows : rows.slice(0, 12);

  return (
    <div className="relative flex h-[700px] flex-col rounded-2xl border border-white/5 bg-[#0a0a0a] p-6 transition duration-300">
      {/* Icon + title, centered */}
      <div className="relative mb-6 flex shrink-0 flex-col items-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full p-2">
          {skill.icon && <img src={skillImg(skill.icon)} alt={skill.name} className="h-full w-full object-contain" />}
        </div>
        <h3 className="text-center text-xl font-bold text-white">{skill.name}</h3>
      </div>

      {/* Scrolling description with the original's coloured keyword spans. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={descRef}
          onScroll={onDescScroll}
          className="flex-1 overflow-y-auto py-4 pr-2 text-sm font-light leading-relaxed text-white/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 hover:[&::-webkit-scrollbar-thumb]:bg-white/20"
          dangerouslySetInnerHTML={{ __html: richText(skill.description) }}
        />
        {/* Top/bottom fades appear only while there is more content that way. */}
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-[#0a0a0a] to-transparent transition-opacity duration-300 ${
            atTop ? 'opacity-0' : 'opacity-100'
          }`}
        />
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0a0a0a] to-transparent transition-opacity duration-300 ${
            atBottom ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>

      {/* Attributes panel */}
      <div className="mt-4 flex shrink-0 flex-col gap-4">
        <div className="overflow-hidden rounded-xl border border-white/5 bg-[#0a0a0a]">
          <div className="flex shrink-0 items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">{t.attributes}</span>
            <div className="flex items-center gap-3">
              <span className="w-8 text-right text-xs text-white/80">Lv.{lv}</span>
              <input
                type="range"
                min={1}
                max={levels}
                value={lv}
                onChange={(e) => setLv(Number(e.target.value))}
                className="h-2 w-24 cursor-pointer appearance-none rounded-full bg-secondary accent-white"
              />
            </div>
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto p-4">
            {shown.map(([label, arr]) => (
              <div
                key={label}
                className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-0 last:pb-0"
              >
                <span className="text-xs text-white/60">{label}</span>
                <span className="text-right text-xs text-white">
                  {Array.isArray(arr) ? arr[Math.min(lv - 1, arr.length - 1)] : arr}
                </span>
              </div>
            ))}
          </div>
        </div>

        {rows.length > 12 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] py-2 text-xs font-medium text-white/40 transition-colors duration-200 hover:bg-white/[0.05] hover:text-white/70"
          >
            {expanded ? `▲ ${t.collapse}` : `▼ ${t.expand}`}
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- constellations */

function ConstellationsTab({ detail, t }) {
  const { lang } = useI18n();
  const cons = toArray(detail.constellations);
  if (!cons.length) return null;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      {cons.map((c, i) => (
        <div key={i} className="flex flex-col rounded-2xl border border-white/5 bg-[#0a0a0a] p-6">
          <div className="mb-4 flex shrink-0 flex-col items-center">
            {c.icon && (
              <img
                src={talentIconImg(c.icon)}
                alt={c.name}
                className="mb-3 h-16 w-16 object-contain"
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            )}
            <h3 className="text-center text-xl font-bold text-white">{c.name}</h3>
            <p className="mt-1 text-xs uppercase tracking-wider text-white/40">
              {t.floor(i + 1)}
            </p>
          </div>
          <div
            className="text-sm font-light leading-relaxed text-white/70"
            dangerouslySetInnerHTML={{ __html: richText(c.description) }}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- info */

function InfoTab({ detail, lang, t }) {
  const info = detail.info || {};
  const cv = info.cv || {};
  const rows = [
    [t.birthday, info.birthday],
    [t.affiliation, info.affiliation],
    [t.constellations, info.constellation],
    ['CV (EN)', cv.EN],
    ['CV (CN)', cv.CHS],
    ['CV (JP)', cv.JP],
    ['CV (KR)', cv.KR],
  ].filter(([, v]) => v);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] p-6">
        <h3 className="mb-4 text-xl font-bold text-white">{t.basicInfo}</h3>
        <div className="space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
              <span className="text-xs text-white/60">{k}</span>
              <span className="text-right text-xs text-white">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {detail.ascension && Object.keys(detail.ascension).length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-[#0a0a0a] p-6">
          <h3 className="mb-4 text-xl font-bold text-white">{t.ascension}</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(detail.ascension)
              .filter(([k]) => k !== '202')
              .flatMap(([group, items]) =>
                Object.entries(items || {}).map(([matId, count]) => (
                  <div
                    key={group + matId}
                    className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
                  >
                    <img
                      src={itemImg(matId)}
                      alt={matId}
                      className="h-8 w-8"
                      onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                    />
                    <span className="text-xs font-medium tabular-nums">×{count}</span>
                  </div>
                ))
              )}
            <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground">Mora</span>
              <span className="text-xs font-medium tabular-nums">{fmt(detail.ascension['202'])}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

function StatBox({ icon, label, value }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {/* Stat icons are black silhouettes; without the filter they vanish
            against the dark panel. */}
        <img src={iconImg(icon)} alt="" className="h-3.5 w-3.5" style={{ filter: ICON_WHITE }} />
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Talent tables run Lv.1-15 for combat talents, but some scaling entries have
// fewer columns; use the longest array so the slider never overruns.
function maxLevels(skill) {
  let n = 1;
  for (const v of Object.values(skill.multipliers || {})) if (Array.isArray(v)) n = Math.max(n, v.length);
  return n;
}
