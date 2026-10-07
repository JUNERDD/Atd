import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, langPath, otherLang, rememberLang } from '../../i18n/routes';
import { navCopy } from './copy';
import { useActiveSection } from './use-active-section';
import './nav.css';

/**
 * The page's control strip: a matte bar as wide as the content column, floating over the page. It
 * carries the name, the section links (a status light marks the one being read), the language
 * switch and the download key. Under it, the kit's scroll edge softly blurs content as it passes.
 */
export function SiteNav() {
  const t = useCopy(navCopy);
  const lang = useLang();
  const other = otherLang(lang);
  const active = useActiveSection(t.links.map((link) => link.href));

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <div className="scroll-edge-top nav__edge" aria-hidden="true" />
      <header className="nav" data-reveal="drop" data-reveal-delay="420">
        <nav className="nav__bar" aria-label={t.label}>
          <a className="nav__brand" href={langPath[lang]} aria-label={t.home}>
            <span className="nav__mark" aria-hidden="true" />
            <span className="nav__word" aria-hidden="true">
              {site.name}
            </span>
          </a>
          <ul className="nav__links">
            {t.links.map((link) => (
              <li key={link.href}>
                <a
                  className="nav__link"
                  href={link.href}
                  aria-current={active === link.href ? 'location' : undefined}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="nav__end">
            <a
              className="nav__lang"
              href={langPath[other]}
              hrefLang={htmlLang[other]}
              lang={htmlLang[other]}
              aria-label={t.switchName}
              onClick={() => rememberLang(other)}
            >
              {t.switchTo}
            </a>
            <a className="btn-filled nav__cta" href={site.latestReleaseUrl}>
              {t.download}
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
