import type { BlogPost } from '../../content/blog-schema';
import type { FeaturePage } from '../../content/features';
import { useLang } from '../../i18n/lang';
import { pagePath } from '../../i18n/routes';

/**
 * A capability page's related capabilities, the first of its closing sections: opaque cards (the
 * blog list's card without an image) of each one's name and summary, as many across as fit.
 */
export function RelatedFeatures({
  title,
  pages,
}: {
  title: string;
  pages: readonly FeaturePage[];
}) {
  const lang = useLang();
  return (
    <section id="related" className="post__section" aria-labelledby="related-title">
      <div className="post__copy">
        <h2 id="related-title" className="post__heading">
          {title}
        </h2>
      </div>
      <ul className="capability__related">
        {pages.map((page) => {
          const copy = page.copy[lang];
          return (
            <li key={page.slug}>
              <a
                className="card pressable blog-card capability__card"
                href={pagePath(lang, `features/${page.slug}`)}
              >
                <h3 className="card__title blog-card__title">{copy.name}</h3>
                <p className="card__subtitle blog-card__summary">{copy.summary}</p>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The release posts that introduced or changed a capability, in the order the page lists them:
 * one card of rows between hairlines, each a link to the post showing its release in dots,
 * its date and its title.
 */
export function ReleaseNotes({
  title,
  posts,
  release,
}: {
  title: string;
  posts: readonly BlogPost[];
  release: (version: string) => string;
}) {
  const lang = useLang();
  return (
    <section id="release-notes" className="post__section" aria-labelledby="release-notes-title">
      <div className="post__copy">
        <h2 id="release-notes-title" className="post__heading">
          {title}
        </h2>
      </div>
      <ul className="card capability__posts">
        {posts.map((post) => {
          const copy = post.copy[lang];
          return (
            <li key={post.slug} className="capability__posts-item">
              <a className="capability__post" href={pagePath(lang, `blog/${post.slug}`)}>
                <span className="capability__post-meta">
                  <span className="capability__post-release readout">{release(post.version)}</span>
                  <time className="legend" dateTime={post.date}>
                    {copy.dateLabel}
                  </time>
                </span>
                <span className="capability__post-title">{copy.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
