import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { iconImg } from '../game';

export default function Layout({ children }) {
  const { lang, setLang, t } = useI18n();
  const { pathname } = useLocation();

  // Only /char is reproduced locally; the rest are shown for fidelity but disabled.
  const nav = [
    { to: '/char', label: t.characters, live: true },
    { to: '/weapons', label: t.weapons, live: false },
    { to: '/artifacts', label: lang === 'chs' ? '圣遗物' : 'Artifacts', live: false },
    { to: '/materials', label: lang === 'chs' ? '材料' : 'Materials', live: false },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4">
          <div className="relative flex h-16 items-center justify-between gap-4">
            <Link to="/char" className="z-20 flex shrink-0 items-center gap-3">
              <img src={iconImg('logo')} alt="Lunaris" className="h-10 w-10 object-contain" />
              <span className="hidden text-xl italic tracking-wide text-white sm:block">LUNARIS</span>
            </Link>

            <nav className="no-scrollbar flex flex-1 items-center overflow-x-auto">
              <div className="mx-auto flex items-center gap-2">
                {nav.map((n) =>
                  n.live ? (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 transition-colors ${
                        pathname.startsWith(n.to)
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      }`}
                    >
                      <span className="font-medium">{n.label}</span>
                    </Link>
                  ) : (
                    <span
                      key={n.to}
                      title="本地复现仅包含角色页"
                      className="flex shrink-0 cursor-not-allowed items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-muted-foreground/40"
                    >
                      <span className="font-medium">{n.label}</span>
                    </span>
                  )
                )}
              </div>
            </nav>

            <div className="z-20 flex shrink-0 items-center gap-2">
              <button
                onClick={() => setLang(lang === 'chs' ? 'en' : 'chs')}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {lang === 'chs' ? '中文' : 'EN'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="mt-16 border-t border-border py-8 text-center text-xs text-muted-foreground">
        <p>{t.noticeText}</p>
        <p className="mt-2 opacity-60">
          Original: <span className="underline">lunaris.moe</span> · Local reproduction for study
        </p>
      </footer>
    </div>
  );
}
