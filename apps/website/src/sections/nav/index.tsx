import { useRef } from 'react';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { htmlLang, langPath, otherLang, rememberLang } from '../../i18n/routes';
import { navCopy } from './copy';
import { useNavTone } from './use-nav-tone';
import './nav.css';

/**
 * The page's one floating glass bar: brand, section links, the language switch and the download pill.
 * Below it, the kit's scroll edge softly blurs content as it scrolls under the bar. Both turn light
 * while the paper section passes beneath them.
 */
export function SiteNav() {
  const t = useCopy(navCopy);
  const lang = useLang();
  const other = otherLang(lang);
  const bar = useRef<HTMLElement>(null);
  const tone = useNavTone(bar);

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <div className="scroll-edge-top nav__edge" data-tone={tone} aria-hidden="true" />
      <header className="nav" data-reveal="drop" data-reveal-delay="420">
        <nav
          ref={bar}
          className="nav__bar glass"
          data-theme={tone === 'paper' ? 'light' : 'dark'}
          aria-label={t.label}
        >
          <a className="nav__brand" href={langPath[lang]} aria-label={t.home}>
            <span className="nav__mark" aria-hidden="true" />
            <span className="nav__word" aria-hidden="true">
              {site.name}
            </span>
          </a>
          <ul className="nav__links">
            {t.links.map((link) => (
              <li key={link.href}>
                <a className="nav__link" href={link.href}>
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
