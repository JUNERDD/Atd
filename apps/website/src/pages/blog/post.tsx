import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import posts from 'virtual:atd-blog';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { pagePath } from '../../i18n/routes';
import { PostContents, type PostSection } from './contents';
import { blogCopy } from './copy';
import './blog.css';

/**
 * One post's page, read top to bottom like a release note: the back button, a centered header
 * (release, title, summary, date), then the body: the contents, which link to each section, beside
 * the sections themselves (each highlight's heading and text at a reading measure, its image wider,
 * then the fixes in a card), and last one primary action, the release's installers on GitHub.
 */
export function BlogPostPage({ slug }: { slug: string }) {
  const t = useCopy(blogCopy);
  const lang = useLang();
  const blog = pagePath(lang, 'blog');
  const post = posts.find((candidate) => candidate.slug === slug);
  const back = (
    <div className="post__bar">
      <a className="btn-plain post__back" href={blog} aria-label={t.back}>
        <ChevronLeft aria-hidden="true" />
        {t.title}
      </a>
    </div>
  );
  if (!post)
    return (
      <article className="post plate">
        <div className="post__inner container">
          {back}
          <p className="post__summary">{t.missing}</p>
        </div>
      </article>
    );
  const copy = post.copy[lang];
  const sections: PostSection[] = [
    ...copy.highlights.map((highlight) => ({
      href: `#${highlight.anchor}`,
      label: highlight.title,
    })),
    ...(copy.fixes.length > 0 ? [{ href: '#fixes', label: t.fixes }] : []),
  ];
  return (
    <article className="post plate" aria-labelledby="post-title">
      <div className="post__inner container">
        {back}
        <header className="post__hero" data-reveal-group="">
          <p className="post__release readout" data-reveal="decode">
            {t.release(post.version)}
          </p>
          <h1 id="post-title" className="post__title" data-reveal="rise" data-reveal-delay="80">
            {copy.title}
          </h1>
          <p className="post__summary" data-reveal="fade" data-reveal-delay="160">
            {copy.summary}
          </p>
          <p className="legend" data-reveal="fade" data-reveal-delay="240">
            <time dateTime={post.date}>{copy.dateLabel}</time>
          </p>
        </header>
        <div className="post__body">
          <PostContents title={t.contents} sections={sections} />
          <div className="post__main">
            {copy.highlights.map((highlight) => (
              <section
                key={highlight.anchor}
                id={highlight.anchor}
                className="post__section"
                aria-labelledby={`${highlight.anchor}-title`}
                data-reveal="rise"
              >
                <div className="post__copy">
                  <h2 id={`${highlight.anchor}-title`} className="post__heading">
                    {highlight.title}
                  </h2>
                  {highlight.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="post__text">
                      {paragraph}
                    </p>
                  ))}
                </div>
                <img
                  className="post__shot"
                  src={highlight.image.src}
                  width={highlight.image.width}
                  height={highlight.image.height}
                  alt={highlight.alt}
                  loading="lazy"
                  decoding="async"
                />
              </section>
            ))}
            {copy.fixes.length > 0 ? (
              <section id="fixes" className="post__section" aria-labelledby="fixes-title">
                <div className="post__copy">
                  <h2 id="fixes-title" className="post__heading">
                    {t.fixes}
                  </h2>
                </div>
                <ul className="card post__fixes">
                  {copy.fixes.map((fix) => (
                    <li key={fix.text} className="post__fix">
                      <p>{fix.text}</p>
                      {fix.figure ? (
                        <img
                          className="post__fix-shot"
                          src={fix.figure.image.src}
                          width={fix.figure.image.width}
                          height={fix.figure.image.height}
                          alt={fix.figure.alt}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
        <footer className="post__end">
          <p className="post__end-release readout">{t.release(post.version)}</p>
          <div className="post__actions">
            <a
              className="btn-filled btn-large post__download"
              href={`${site.releasesUrl}/tag/v${post.version}`}
            >
              {t.onGitHub(post.version)}
              <ArrowUpRight aria-hidden="true" />
            </a>
            <a className="btn-plain" href={blog}>
              {t.back}
            </a>
          </div>
        </footer>
      </div>
    </article>
  );
}
