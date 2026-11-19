import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import {
  htmlLang,
  LANGS,
  languageNames,
  pagePath,
  rememberLang,
  type Page,
} from '../../i18n/routes';
import { footerCopy } from './copy';
import { FooterDirectory } from './directory';
import { ThemeSwitch } from './theme-switch';
import './footer.css';

/**
 * The last plate: the name in dot figures paired with language links on the top row, the
 * directory of every page of the site under them, and the small print plus theme switcher below.
 * As it arrives the name decodes and the rest fades up.
 */
export function SiteFooter({ page }: { page: Page }) {
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
        <nav className="footer__nav" aria-label={t.languages} data-reveal="fade">
          <ul className="footer__links">
            {LANGS.map((code) => (
              <li key={code}>
                <a
                  className="footer__link"
                  href={pagePath(code, page)}
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
        <FooterDirectory page={page} labels={t.directory} />
        <div className="footer__bottom" data-reveal="fade">
          <p className="footer__note legend">
            © {year} {site.author}. {t.note}
          </p>
          <ThemeSwitch labels={t.theme} />
        </div>
      </div>
    </footer>
  );
}
