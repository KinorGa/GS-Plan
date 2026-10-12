import { useEffect, useMemo, useState } from 'react';
import { ELEMENTS, WEAPONS } from '../game';
import { useI18n } from '../i18n';
import CharacterCard from '../components/CharacterCard';

export default function CharList() {
  const { lang, t } = useI18n();
  const [chars, setChars] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [element, setElement] = useState('all');
  const [weapon, setWeapon] = useState('all');
  const [rarity, setRarity] = useState('all');
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    fetch('/data/charlist.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then(setChars)
      .catch((e) => setErr(e.message));
  }, []);

  const list = useMemo(() => {
    if (!chars) return [];
    return Object.entries(chars).filter(([, c]) => {
      if (element !== 'all' && c.element !== element) return false;
      if (weapon !== 'all' && c.weaponType !== weapon) return false;
      if (rarity !== 'all' && c.qualityType !== rarity) return false;
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        const hay = [c.chsName, c.enName, c.ruName].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [chars, q, element, weapon, rarity]);

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <span className="mr-2 text-xs font-semibold text-amber-300">{t.notice}</span>
        <span className="text-xs text-amber-200/80">{t.noticeText}</span>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{t.characters}</h1>
        <span className="text-sm text-muted-foreground">
          {list.length} {t.found}
        </span>
      </div>

      <div className="mb-5 rounded-xl border border-border bg-secondary/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowFilter((v) => !v)}
            className={`rounded-lg border border-border px-3 py-2 text-sm transition-colors ${
              showFilter ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            ⚙ {t.filter}
          </button>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.search}
            className="min-w-[200px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
          />
        </div>

        {showFilter && (
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <FilterRow
              label={t.element}
              value={element}
              onChange={setElement}
              options={[
                { v: 'all', label: t.all },
                ...Object.entries(ELEMENTS).map(([k, e]) => ({ v: k, label: lang === 'chs' ? e.zh : k, icon: e.icon })),
              ]}
            />
            <FilterRow
              label={t.weapon}
              value={weapon}
              onChange={setWeapon}
              options={[
                { v: 'all', label: t.all },
                ...Object.entries(WEAPONS).map(([k, w]) => ({ v: k, label: lang === 'chs' ? w.zh : w.en, icon: w.icon })),
              ]}
            />
            <FilterRow
              label={t.rarity}
              value={rarity}
              onChange={setRarity}
              options={[
                { v: 'all', label: t.all },
                { v: 'QUALITY_ORANGE', label: '5★' },
                { v: 'QUALITY_PURPLE', label: '4★' },
              ]}
            />
          </div>
        )}
      </div>

      {err && <p className="text-red-400">加载失败 / Failed: {err}</p>}
      {!chars && !err && <p className="text-muted-foreground">Loading…</p>}

      {chars && list.length === 0 && <p className="text-muted-foreground">{t.noresult}</p>}

      <div className="grid grid-cols-3 gap-2 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
        {list.map(([id, c]) => (
          <CharacterCard key={id} id={id} char={c} linkTo={`/char/${id}`} />
        ))}
      </div>
    </div>
  );
}

function FilterRow({ label, value, onChange, options }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
            value === o.v
              ? 'border-primary/60 bg-primary/20 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.icon && <img src={`/img/icons/${o.icon}.webp`} alt="" className="h-3.5 w-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
