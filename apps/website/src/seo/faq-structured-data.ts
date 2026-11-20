import { faq } from '../content/faq/index.ts';
import { htmlLang, pagePath, type Lang } from '../i18n/routes.ts';
import {
  baseNodes,
  breadcrumbList,
  homeCrumb,
  questionNode,
  schemaIds,
  type PageFacts,
} from '../structured-data.ts';

/**
 * Schema.org graph for `/faq` and `/zh/faq`: the page itself as an `FAQPage` whose main entity is
 * every question across the groups, in page order, each answer's paragraphs joined by a blank
 * line, and its home › FAQ `BreadcrumbList`.
 */
export function faqStructuredData(
  lang: Lang,
  siteUrl: string,
  homeName: string,
  page: PageFacts,
): object {
  const ids = schemaIds(siteUrl);
  const url = `${siteUrl}${pagePath(lang, 'faq')}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'FAQPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
        dateModified: faq.updated,
        mainEntity: faq.groups.flatMap((group) =>
          group.entries.map((entry) =>
            questionNode(entry.question[lang], entry.answer[lang].join('\n\n')),
          ),
        ),
      },
      breadcrumbList(`${url}#breadcrumb`, [
        homeCrumb(lang, siteUrl, homeName),
        { name: faq.copy[lang].title, item: url },
      ]),
    ],
  };
}
