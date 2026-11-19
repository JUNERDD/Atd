import { ArrowRight } from 'lucide-react';
import { faq as faqContent, type FaqPage as FaqContent } from '../../content/faq';
import { featurePage } from '../../content/features';
import { site } from '../../content/site';
import { useCopy, useLang } from '../../i18n/lang';
import { langPath, pagePath } from '../../i18n/routes';
import { QaItem } from '../../ui/qa';
import { PostContents } from '../blog/contents';
import { faqLabels } from './copy';
import '../blog/blog.css';
import './faq.css';

/** Read through the content's contract, so optional fields such as `see` are typed as optional. */
const faq: FaqContent = faqContent;

/**
 * The questions page, read like a post (blog.css): a header with the heading and lede, then the
 * contents (one link per group) beside the groups, each an `h2` over its questions, every answer
 * shown in full with a link to the capability page that covers it in depth, and last the download
 * with the way to every feature.
 */
export function FaqPage() {
  const t = useCopy(faqLabels);
  const copy = useCopy(faq.copy);
  const lang = useLang();
  const groups = faq.groups.filter((group) => group.entries.length > 0);
  return (
    <article className="post faq plate" aria-labelledby="faq-title">
      <div className="post__inner container">
        <header className="post__hero" data-reveal-group="">
          <h1 id="faq-title" className="post__title" data-reveal="rise" data-reveal-delay="80">
            {copy.title}
          </h1>
          <p className="post__summary" data-reveal="fade" data-reveal-delay="160">
            {copy.lede}
          </p>
        </header>
        {groups.length === 0 ? null : (
          <div className="post__body">
            <PostContents
              title={t.contents}
              sections={groups.map((group) => ({ href: `#${group.id}`, label: group.title[lang] }))}
            />
            <div className="post__main">
              {groups.map((group) => (
                <section
                  key={group.id}
                  id={group.id}
                  className="post__section"
                  aria-labelledby={`${group.id}-title`}
                  data-reveal="rise"
                >
                  <div className="post__copy">
                    <h2 id={`${group.id}-title`} className="post__heading">
                      {group.title[lang]}
                    </h2>
                  </div>
                  <div className="qa">
                    {group.entries.map((entry) => {
                      const feature = entry.see === undefined ? undefined : featurePage(entry.see);
                      return (
                        <QaItem
                          key={entry.id}
                          id={entry.id}
                          question={entry.question[lang]}
                          answer={entry.answer[lang]}
                        >
                          {feature === undefined ? null : (
                            <a
                              className="btn-plain faq__more"
                              href={pagePath(lang, `features/${feature.slug}`)}
                            >
                              {t.learnMore(feature.copy[lang].name)}
                              <ArrowRight aria-hidden="true" />
                            </a>
                          )}
                        </QaItem>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
        <footer className="post__end">
          <p className="post__end-release readout">{t.release(site.version)}</p>
          <div className="post__actions">
            <a className="btn-filled btn-large" href={`${langPath[lang]}#download`}>
              {t.download}
            </a>
            <a className="btn-plain" href={pagePath(lang, 'features')}>
              {t.hub}
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
        </footer>
      </div>
    </article>
  );
}
