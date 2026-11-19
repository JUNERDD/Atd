import { ArrowRight } from 'lucide-react';
import { featurePages, featuresHub, type FeaturesHubCopy } from '../../content/features';
import { useCopy, useLang } from '../../i18n/lang';
import { langPath, pagePath } from '../../i18n/routes';
import { IllustrationLayers } from './case-frame';
import { featuresPageCopy } from './copy';
import '../blog/blog.css';
import './features.css';

/**
 * The features hub: the heading lit in dots on the page's center line, then every capability as
 * an opaque card (the blog list's card) that is one link to its page, and last the download and
 * the way to the questions page. A card shows the capability's illustration above its name.
 */
export function FeaturesHub() {
  const t = useCopy(featuresPageCopy);
  const hub = useCopy<FeaturesHubCopy>(featuresHub.copy);
  const lang = useLang();
  return (
    <section className="blog hub plate" aria-labelledby="hub-title">
      <div className="blog__inner container">
        <header className="blog__intro" data-reveal-group="">
          <h1
            id="hub-title"
            className="blog__title dot-text"
            data-reveal="rise"
            data-reveal-delay="80"
          >
            {hub.title}
          </h1>
          <p className="blog__lede" data-reveal="fade" data-reveal-delay="200">
            {hub.lede}
          </p>
        </header>
        <ul className="hub__grid">
          {featurePages.map((page) => {
            const copy = page.copy[lang];
            return (
              <li key={page.slug} className="hub__item" data-reveal="rise">
                <a
                  className="card pressable blog-card hub-card"
                  href={pagePath(lang, `features/${page.slug}`)}
                >
                  <div className="card__media blog-card__media case-frame">
                    <IllustrationLayers page={page} lang={lang} lazy decorative />
                  </div>
                  <div className="blog-card__body">
                    <h2 className="card__title blog-card__title">{copy.name}</h2>
                    <p className="card__subtitle blog-card__summary">{copy.summary}</p>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        <div className="post__actions" data-reveal="fade">
          <a className="btn-filled btn-large" href={`${langPath[lang]}#download`}>
            {t.download}
          </a>
          <a className="btn-plain" href={pagePath(lang, 'faq')}>
            {t.faq}
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
