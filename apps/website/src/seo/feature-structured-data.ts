import { featurePages, featuresHub, type FeaturePage } from '../content/features/index.ts';
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
 * The hub's last substantive change, `YYYY-MM-DD`: its own copy's or any capability page's,
 * whichever is later, since the hub lists every capability's name and summary. The hub's
 * `dateModified` and its sitemap `lastmod` both use it.
 */
export function featuresHubUpdated(): string {
  return featurePages.reduce<string>(
    (latest, feature) => (feature.updated > latest ? feature.updated : latest),
    featuresHub.updated,
  );
}

function hubCrumb(lang: Lang, siteUrl: string) {
  return { name: featuresHub.copy[lang].title, item: `${siteUrl}${pagePath(lang, 'features')}` };
}

/**
 * Schema.org graph for `/features` and `/zh/features`: a `CollectionPage` whose main entity is an
 * `ItemList` of the capability pages in the hub's order, and its `BreadcrumbList`.
 */
export function featuresHubStructuredData(
  lang: Lang,
  siteUrl: string,
  homeName: string,
  page: PageFacts,
): object {
  const ids = schemaIds(siteUrl);
  const url = `${siteUrl}${pagePath(lang, 'features')}`;
  const listId = `${url}#capabilities`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'CollectionPage',
        '@id': `${url}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
        dateModified: featuresHubUpdated(),
        mainEntity: { '@id': listId },
      },
      {
        '@type': 'ItemList',
        '@id': listId,
        numberOfItems: featurePages.length,
        itemListElement: featurePages.map((feature, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${siteUrl}${pagePath(lang, `features/${feature.slug}`)}`,
          name: feature.copy[lang].name,
        })),
      },
      breadcrumbList(`${url}#breadcrumb`, [
        homeCrumb(lang, siteUrl, homeName),
        hubCrumb(lang, siteUrl),
      ]),
    ],
  };
}

/**
 * Schema.org graph for one capability page: its `WebPage` (about the app, dated by the page's
 * `updated`), the home › hub › capability `BreadcrumbList`, and, when the page answers questions,
 * an `FAQPage` listing them.
 */
export function featureStructuredData(
  lang: Lang,
  siteUrl: string,
  homeName: string,
  feature: FeaturePage,
  page: PageFacts,
): object {
  const ids = schemaIds(siteUrl);
  const copy = feature.copy[lang];
  const url = `${siteUrl}${pagePath(lang, `features/${feature.slug}`)}`;
  const webpageId = `${url}#webpage`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ...baseNodes(siteUrl),
      {
        '@type': 'WebPage',
        '@id': webpageId,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        breadcrumb: { '@id': `${url}#breadcrumb` },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
        dateModified: feature.updated,
        ...(copy.keywords.length > 0 ? { keywords: copy.keywords.join(', ') } : {}),
      },
      breadcrumbList(`${url}#breadcrumb`, [
        homeCrumb(lang, siteUrl, homeName),
        hubCrumb(lang, siteUrl),
        { name: copy.name, item: url },
      ]),
      ...(copy.questions.length > 0
        ? [
            {
              '@type': 'FAQPage',
              '@id': `${url}#faq`,
              inLanguage: htmlLang[lang],
              isPartOf: { '@id': webpageId },
              mainEntity: copy.questions.map((entry) => questionNode(entry.question, entry.answer)),
            },
          ]
        : []),
    ],
  };
}
