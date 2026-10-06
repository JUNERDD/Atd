import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, LANGS, langPath, rememberLang } from '../../i18n/routes';
import { footerCopy } from './copy';
import './footer.css';

const languageNames = { en: 'English', zh: '简体中文' } as const;

export function SiteFooter() {
  const t = useCopy(footerCopy);
  const lang = useLang();
  const year = 2026;

  return (
    <footer className="footer">
      <div className="footer__grid container">
        <div className="footer__brand">
          <p className="footer__word" aria-hidden="true">
            {site.name}
          </p>
          <p className="footer__tagline">{t.tagline}</p>
        </div>
        {t.columns.map((column) => (
          <nav className="footer__column" key={column.title} aria-label={column.title}>
            <h2 className="mono-label">{column.title}</h2>
            <ul>
              {column.links.map((link) => (
                <li key={link.href}>
                  <a className="footer__link" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        <nav className="footer__column" aria-label={t.languages}>
          <h2 className="mono-label">{t.languages}</h2>
          <ul>
            {LANGS.map((code) => (
              <li key={code}>
                <a
                  className="footer__link"
                  href={langPath[code]}
                  hrefLang={htmlLang[code]}
                  lang={htmlLang[code]}
                  aria-current={code === lang ? 'page' : undefined}
                  onClick={() => rememberLang(code)}
                >
                  {languageNames[code]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="footer__base container">
        <p className="mono-label">
          © {year} {site.author}
        </p>
        <p className="footer__note">{t.note}</p>
        <p className="mono-label">{t.grid}</p>
      </div>
    </footer>
  );
}
