import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, LANGS, langPath, rememberLang } from '../../i18n/routes';
import { footerCopy } from './copy';
import './footer.css';

const languageNames = { en: 'English', zh: '简体中文' } as const;

/**
 * The last plate: the name in dot figures, the project links and the languages on one row, and the
 * small print under them. As it arrives the name decodes and the rest fades up.
 */
export function SiteFooter() {
  const t = useCopy(footerCopy);
  const lang = useLang();
  const year = 2026;

  return (
    <footer className="footer plate">
      <span className="footer__seam" aria-hidden="true" />
      <div className="footer__inner container" data-reveal-group="">
        <p className="footer__word readout" aria-hidden="true" data-reveal="decode">
          {site.name}
        </p>
        <nav className="footer__nav" aria-label={t.linksLabel} data-reveal="fade">
          <ul className="footer__links">
            {t.links.map((link) => (
              <li key={link.href}>
                <a className="footer__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav className="footer__nav" aria-label={t.languages} data-reveal="fade">
          <ul className="footer__links">
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
        <p className="footer__note legend" data-reveal="fade">
          © {year} {site.author}. {t.note}
        </p>
      </div>
    </footer>
  );
}
