import { useEffect, useRef } from 'react';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { langPath, pagePath, postSlugOf, type Page } from '../../i18n/routes';
import { formatGitHubStars, GITHUB_STARS_FALLBACK } from '../../lib/github-stars';
import { useActiveSection } from '../../lib/use-active-section';
import { useGitHubStars } from '../../lib/use-github-stars';
import { navCopy } from './copy';
import { GitHubMark } from './github-mark';
import './nav.css';

const BACKDROP_SCROLL_RANGE_PX = 120;

/**
 * The page's control strip: a full-width glass bar fixed at the top of the viewport. It carries
 * the name, the section links and the blog's (lit on the blog and its posts), the GitHub Star
 * key, and the download key, which leads to the download plate where the visitor picks their Mac's
 * chip. On another page the section links and the key lead back to the home page's sections.
 */
export function SiteNav({
  page,
  initialStars = GITHUB_STARS_FALLBACK,
}: {
  page: Page;
  initialStars?: number;
}) {
  const t = useCopy(navCopy);
  const lang = useLang();
  const home = page === 'home';
  const active = useActiveSection(home ? t.links.map((link) => link.href) : []);
  const stars = useGitHubStars(initialStars);
  const starCount = formatGitHubStars(stars);
  const githubLabel = t.github.ariaLabel(starCount);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop || CSS.supports('animation-timeline', 'scroll()')) return;
    const sync = () => {
      const progress = Math.min(1, Math.max(0, window.scrollY / BACKDROP_SCROLL_RANGE_PX));
      backdrop.style.setProperty('--nav-scroll', progress.toFixed(4));
    };
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);

  // `#cases` on the home page; `/#cases` or `/zh#cases` from another page.
  const sectionHref = (hash: string) => (home ? hash : `${langPath[lang]}${hash}`);

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <header className="nav" data-reveal="drop" data-reveal-delay="420">
        <div ref={backdropRef} className="nav__backdrop glass" aria-hidden="true" />
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
                  href={sectionHref(link.href)}
                  aria-current={active === link.href ? 'location' : undefined}
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                className="nav__link"
                href={pagePath(lang, 'blog')}
                aria-current={
                  page === 'blog' ? 'page' : postSlugOf(page) !== null ? 'true' : undefined
                }
              >
                {t.blog}
              </a>
            </li>
          </ul>
          <div className="nav__end">
            <a
              className="btn-bordered nav__github"
              href={site.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={githubLabel}
              title={githubLabel}
            >
              <GitHubMark />
              <span className="nav__github-label">{t.github.label}</span>
              <span className="nav__github-count">{starCount}</span>
            </a>
            <a className="btn-filled nav__cta" href={sectionHref('#download')}>
              {t.download}
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}
