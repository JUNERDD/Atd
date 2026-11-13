import { ArrowUpRight } from 'lucide-react';
import posts from 'virtual:atd-blog';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { pagePath } from '../../i18n/routes';
import { blogCopy } from './copy';
import './blog.css';

/**
 * The blog's list: every post, newest first, as an opaque card that is one link to the post's own
 * page (`/blog/<slug>`), which holds the full notes. A card shows the post's first image, its
 * release and date, its title and its summary; the newest is a wide card above the rest.
 */
export function BlogIndex() {
  const t = useCopy(blogCopy);
  const lang = useLang();
  return (
    <section className="blog plate" aria-labelledby="blog-title">
      <div className="blog__inner container">
        <header className="blog__intro" data-reveal-group="">
          <h1
            id="blog-title"
            className="blog__title dot-text"
            data-reveal="rise"
            data-reveal-delay="80"
          >
            {t.title}
          </h1>
          <p className="blog__lede" data-reveal="fade" data-reveal-delay="200">
            {t.lede}
          </p>
        </header>
        <ol className="blog__grid">
          {posts.map((post, index) => {
            const copy = post.copy[lang];
            const cover = copy.highlights[0];
            const first = index === 0;
            return (
              <li
                key={post.slug}
                className="blog__item"
                data-featured={first ? '' : undefined}
                data-reveal="rise"
              >
                <a className="card pressable blog-card" href={pagePath(lang, `blog/${post.slug}`)}>
                  {cover ? (
                    <img
                      className="card__media blog-card__media"
                      src={cover.image.src}
                      width={cover.image.width}
                      height={cover.image.height}
                      alt={cover.alt}
                      {...(first ? {} : { loading: 'lazy' })}
                      decoding="async"
                    />
                  ) : null}
                  <div className="blog-card__body">
                    <p className="blog-card__meta">
                      <span className="blog-card__release readout">{t.release(post.version)}</span>
                      <time className="legend" dateTime={post.date}>
                        {copy.dateLabel}
                      </time>
                    </p>
                    <h2 className="card__title blog-card__title">{copy.title}</h2>
                    <p className="card__subtitle blog-card__summary">{copy.summary}</p>
                  </div>
                </a>
              </li>
            );
          })}
        </ol>
        <a className="btn-plain blog__releases" href={site.releasesUrl}>
          {t.allReleases}
          <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
