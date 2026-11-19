import { ArrowUpRight, ChevronLeft } from 'lucide-react';
import posts from 'virtual:atd-blog';
import { featurePage } from '../../content/features';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { langPath, pagePath } from '../../i18n/routes';
import { QaItem } from '../../ui/qa';
import { PostContents, type PostSection } from '../blog/contents';
import { IllustrationLayers } from './case-frame';
import { RelatedFeatures, ReleaseNotes } from './capability-links';
import { featuresPageCopy } from './copy';
import '../blog/blog.css';
import './features.css';

/**
 * One capability's page, a sibling of a blog post's reading layout (blog.css): the back bar to the
 * hub, a centered header (the capability's name in dots, the title, the lede, the download and the
 * source), its showcase illustration when it has one, then the body: the contents beside the
 * sections, the questions answered in full, the related capabilities and the release notes, each
 * only when it has something to show, and last the download again with the way back to the hub.
 */
export function CapabilityPage({ slug }: { slug: string }) {
  const t = useCopy(featuresPageCopy);
  const lang = useLang();
  const hub = pagePath(lang, 'features');
  const download = `${langPath[lang]}#download`;
  const page = featurePage(slug);
  const back = (
    <div className="post__bar">
      <a className="btn-plain post__back" href={hub} aria-label={t.back}>
        <ChevronLeft aria-hidden="true" />
        {t.hub}
      </a>
    </div>
  );
  if (!page)
    return (
      <article className="post capability plate" aria-labelledby="capability-title">
        <div className="post__inner container">
          {back}
          <h1 id="capability-title" className="post__summary capability__missing">
            {t.missing}
          </h1>
        </div>
      </article>
    );

  const copy = page.copy[lang];
  const related = page.related
    .map((other) => featurePage(other))
    .filter((other) => other !== undefined);
  const notes = page.posts
    .map((postSlug) => posts.find((post) => post.slug === postSlug))
    .filter((post) => post !== undefined);
  const sections: PostSection[] = copy.sections.map((section) => ({
    href: `#${section.id}`,
    label: section.title,
  }));
  if (copy.questions.length > 0) sections.push({ href: '#questions', label: t.questions });
  if (related.length > 0) sections.push({ href: '#related', label: t.related });
  if (notes.length > 0) sections.push({ href: '#release-notes', label: t.releaseNotes });

  return (
    <article className="post capability plate" aria-labelledby="capability-title">
      <div className="post__inner container">
        {back}
        <header className="post__hero" data-reveal-group="">
          <p className="post__release readout" data-reveal="decode">
            {copy.name}
          </p>
          <h1
            id="capability-title"
            className="post__title"
            data-reveal="rise"
            data-reveal-delay="80"
          >
            {copy.title}
          </h1>
          <p className="post__summary" data-reveal="fade" data-reveal-delay="160">
            {copy.lede}
          </p>
          <div className="capability__actions" data-reveal="fade" data-reveal-delay="240">
            <a className="btn-filled btn-large" href={download}>
              {t.download}
            </a>
            <a className="btn-plain" href={site.repoUrl}>
              {t.source}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </header>
        <div className="case-frame capability__shot" data-reveal="rise">
          <IllustrationLayers page={page} lang={lang} lazy={false} decorative={false} />
        </div>
        {sections.length === 0 ? null : (
          <div className="post__body">
            <PostContents title={t.contents} sections={sections} />
            <div className="post__main">
              {copy.sections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="post__section"
                  aria-labelledby={`${section.id}-title`}
                  data-reveal="rise"
                >
                  <div className="post__copy">
                    <h2 id={`${section.id}-title`} className="post__heading">
                      {section.title}
                    </h2>
                    {section.paragraphs.map((paragraph, index) => (
                      <p key={index} className="post__text">
                        {paragraph}
                      </p>
                    ))}
                    {section.points === undefined || section.points.length === 0 ? null : (
                      <ul className="post__list">
                        {section.points.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              ))}
              {copy.questions.length === 0 ? null : (
                <section id="questions" className="post__section" aria-labelledby="questions-title">
                  <div className="post__copy">
                    <h2 id="questions-title" className="post__heading">
                      {t.questions}
                    </h2>
                  </div>
                  <div className="qa">
                    {copy.questions.map((item, index) => (
                      <QaItem key={index} question={item.question} answer={[item.answer]} />
                    ))}
                  </div>
                </section>
              )}
              {related.length === 0 ? null : <RelatedFeatures title={t.related} pages={related} />}
              {notes.length === 0 ? null : (
                <ReleaseNotes title={t.releaseNotes} posts={notes} release={t.release} />
              )}
            </div>
          </div>
        )}
        <footer className="post__end">
          <p className="post__end-release readout">{t.release(site.version)}</p>
          <div className="post__actions">
            <a className="btn-filled btn-large" href={download}>
              {t.download}
            </a>
            <a className="btn-plain" href={hub}>
              {t.allFeatures}
            </a>
          </div>
        </footer>
      </div>
    </article>
  );
}
