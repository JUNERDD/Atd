import { ArrowUpRight } from 'lucide-react';
import { featurePages } from '../../content/features';
import { site } from '../../content/site';
import { useLang } from '../../i18n/lang';
import { pagePath, type Page } from '../../i18n/routes';
import type { DirectoryLabels } from './copy';

/** One of the site's own pages, linked in the current language and lit when it is this page. */
function PageLink({ current, target, label }: { current: Page; target: Page; label: string }) {
  const lang = useLang();
  return (
    <li className="footer__item">
      <a
        className="footer__link"
        href={pagePath(lang, target)}
        aria-current={current === target ? 'page' : undefined}
      >
        {label}
      </a>
    </li>
  );
}

/** A page elsewhere (the project on GitHub), marked with an arrow out. */
function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <li className="footer__item">
      <a className="footer__link" href={href}>
        {label}
        <ArrowUpRight className="footer__out" aria-hidden="true" />
      </a>
    </li>
  );
}

/**
 * Every page of the site, so each one links to all the others: the features hub and each
 * capability under Features, then the questions page, the blog and the project on GitHub under
 * Resources. The groups stack on narrow screens, each list in two columns; from 760px they share
 * four equal tracks, the capabilities filling three of them and the resources the fourth.
 */
export function FooterDirectory({ page, labels }: { page: Page; labels: DirectoryLabels }) {
  const lang = useLang();
  return (
    <nav className="footer__directory" aria-label={labels.label} data-reveal="fade">
      <div className="footer__group" data-group="features">
        <h2 id="footer-features" className="footer__heading">
          {labels.features}
        </h2>
        <ul className="footer__list" aria-labelledby="footer-features">
          <PageLink current={page} target="features" label={labels.allFeatures} />
          {featurePages.map((feature) => (
            <PageLink
              key={feature.slug}
              current={page}
              target={`features/${feature.slug}`}
              label={feature.copy[lang].name}
            />
          ))}
        </ul>
      </div>
      <div className="footer__group" data-group="resources">
        <h2 id="footer-resources" className="footer__heading">
          {labels.resources}
        </h2>
        <ul className="footer__list" aria-labelledby="footer-resources">
          <PageLink current={page} target="faq" label={labels.faq} />
          <PageLink current={page} target="blog" label={labels.blog} />
          <ExternalLink href={site.repoUrl} label={labels.github} />
          <ExternalLink href={site.releasesUrl} label={labels.releases} />
        </ul>
      </div>
    </nav>
  );
}
