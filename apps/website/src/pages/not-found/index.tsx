import { useCopy, useLang } from '../../i18n/lang';
import { langPath, pagePath } from '../../i18n/routes';
import { notFoundCopy } from './copy';
import './not-found.css';

/** Fallback route view rendered for unmatched URLs and exported to static `404.html`. */
export function NotFoundPage() {
  const t = useCopy(notFoundCopy);
  const lang = useLang();
  const other = lang === 'en' ? 'zh' : 'en';

  return (
    <section className="not-found plate" aria-labelledby="not-found-title">
      <div className="not-found__inner container" data-reveal-group="">
        <p className="not-found__code readout" data-reveal="decode">
          404
        </p>
        <h1 id="not-found-title" className="not-found__title dot-text" data-reveal="rise">
          {t.title}
        </h1>
        <p className="not-found__lede" data-reveal="fade">
          {t.description}
        </p>
        <div className="not-found__actions" data-reveal="fade">
          <a className="btn-filled btn-large" href={langPath[lang]}>
            {t.home}
          </a>
          <a className="btn-bordered" href={pagePath(lang, 'blog')}>
            {t.blog}
          </a>
          <a className="btn-plain" href={langPath[other]}>
            {t.alternateLabel}
          </a>
        </div>
      </div>
    </section>
  );
}
