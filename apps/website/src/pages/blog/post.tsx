import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import posts from 'virtual:atd-blog';
import type { BlogBlock, BlogInline } from '../../content/blog-schema';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { pagePath } from '../../i18n/routes';
import { PostContents, type PostSection } from './contents';
import { BLOG_NOTE_KINDS, blogCopy } from './copy';
import './blog.css';

function renderInlines(nodes: BlogInline[]): ReactNode {
  return nodes.map((node, index) => renderInline(node, index));
}

function renderInline(node: BlogInline, key: number): ReactNode {
  if (typeof node === 'string') return node;
  switch (node.kind) {
    case 'strong':
      return <strong key={key}>{renderInlines(node.children)}</strong>;
    case 'em':
      return <em key={key}>{renderInlines(node.children)}</em>;
    case 'code':
      return (
        <code key={key} className="post__code">
          {node.text}
        </code>
      );
    case 'link': {
      const external = /^https?:\/\//i.test(node.href);
      return (
        <a
          key={key}
          className="post__link"
          href={node.href}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {renderInlines(node.children)}
        </a>
      );
    }
  }
}

function renderBlock(block: BlogBlock, key: number): ReactNode {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={key} className="post__text">
          {renderInlines(block.children)}
        </p>
      );
    case 'list':
      return block.ordered ? (
        <ol key={key} className="post__list" data-ordered="">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlines(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key} className="post__list">
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlines(item)}</li>
          ))}
        </ul>
      );
  }
}

/**
 * One post's page, read top to bottom like a release note: the back button, a centered header
 * (release, title, summary, date), then the body: the contents, which link to each section, beside
 * the sections themselves (each highlight's heading, text, and image filling the main column,
 * then any tail note cards), and last one primary action, the release's installers on GitHub.
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
  const noteSections = BLOG_NOTE_KINDS.filter((kind) => copy[kind].length > 0);
  const sections: PostSection[] = [
    ...copy.highlights.map((highlight) => ({
      href: `#${highlight.anchor}`,
      label: highlight.title,
    })),
    ...noteSections.map((kind) => ({
      href: `#${kind}`,
      label: t[kind],
    })),
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
                  {highlight.blocks.map((block, blockIndex) => renderBlock(block, blockIndex))}
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
            {noteSections.map((kind) => (
              <section
                key={kind}
                id={kind}
                className="post__section"
                aria-labelledby={`${kind}-title`}
              >
                <div className="post__copy">
                  <h2 id={`${kind}-title`} className="post__heading">
                    {t[kind]}
                  </h2>
                </div>
                <ul className="card post__fixes">
                  {copy[kind].map((note, noteIndex) => (
                    <li key={noteIndex} className="post__fix">
                      <p className="post__fix-text">{renderInlines(note.content)}</p>
                      {note.figure ? (
                        <img
                          className="post__fix-shot"
                          src={note.figure.image.src}
                          width={note.figure.image.width}
                          height={note.figure.image.height}
                          alt={note.figure.alt}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
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
