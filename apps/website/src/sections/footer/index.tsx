import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, LANGS, langPath, rememberLang } from '../../i18n/routes';
import { footerCopy } from './copy';
import './footer.css';

const languageNames = { en: 'English', zh: '简体中文' } as const;

/**
 * The page's foot: the name, the link columns and the languages, then a base line. As it arrives the
 * name decodes, the columns rise one after another and the base line draws.
 */
export function SiteFooter() {
  const t = useCopy(footerCopy);
  const lang = useLang();
  const year = 2026;

  return (
    <footer className="footer">
      <div className="footer__grid container" data-reveal-group="">
        <div className="footer__brand">
          <p className="footer__word" aria-hidden="true" data-reveal="decode">
            {site.name}
          </p>
          <p className="footer__tagline" data-reveal="rise" data-reveal-delay="100">
            {t.tagline}
          </p>
        </div>
        {t.columns.map((column, index) => (
          <nav
            className="footer__column"
            key={column.title}
            aria-label={column.title}
            data-reveal="rise"
            data-reveal-delay={180 + index * 80}
          >
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
        <nav
          className="footer__column"
          aria-label={t.languages}
          data-reveal="rise"
          data-reveal-delay={180 + t.columns.length * 80}
        >
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
      <div className="footer__base container" data-reveal-group="" data-reveal-stagger="90">
        <span className="footer__rule" aria-hidden="true" data-reveal="draw" />
        <p className="mono-label" data-reveal="fade">
          © {year} {site.author}
        </p>
        <p className="footer__note" data-reveal="fade">
          {t.note}
        </p>
        <p className="mono-label" data-reveal="decode">
          {t.grid}
        </p>
      </div>
    </footer>
  );
}
