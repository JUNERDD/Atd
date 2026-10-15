import { site } from './content/site.ts';
import { htmlLang, LANGS, langPath, type Lang } from './i18n/routes.ts';

/** What one language's page says about itself, shared with its meta tags. */
export interface PageFacts {
  title: string;
  description: string;
  /** The share image, an absolute URL. */
  image: string;
}

/**
 * The page's schema.org graph: the site, its author, the page and the app it describes. Product
 * facts come from `content/site.ts`, so the version, download and system requirements search engines
 * read stay those the page shows. `siteUrl` is the production origin, without a trailing slash.
 */
export function structuredData(lang: Lang, siteUrl: string, page: PageFacts): object {
  const home = `${siteUrl}/`;
  const url = `${siteUrl}${langPath[lang]}`;
  const ids = {
    website: `${home}#website`,
    author: `${home}#author`,
    app: `${home}#app`,
    page: `${url}#webpage`,
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': ids.website,
        url: home,
        name: site.name,
        inLanguage: LANGS.map((other) => htmlLang[other]),
        publisher: { '@id': ids.author },
      },
      {
        '@type': 'Person',
        '@id': ids.author,
        name: site.author,
        url: `https://github.com/${site.author}`,
      },
      {
        '@type': 'WebPage',
        '@id': ids.page,
        url,
        name: page.title,
        description: page.description,
        inLanguage: htmlLang[lang],
        isPartOf: { '@id': ids.website },
        about: { '@id': ids.app },
        primaryImageOfPage: { '@type': 'ImageObject', url: page.image },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': ids.app,
        name: site.name,
        description: page.description,
        url: home,
        image: page.image,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: `macOS ${site.minMacOS} or later`,
        processorRequirements: site.chip,
        softwareVersion: site.version,
        downloadUrl: site.downloadUrl,
        releaseNotes: site.releasesUrl,
        license: site.licenseUrl,
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        author: { '@id': ids.author },
        sameAs: [site.repoUrl],
      },
    ],
  };
}

/**
 * The graph as a `<script>` element. `<` is escaped so no string in the data can close the element
 * early; JSON parsers read `<` back as `<`.
 */
export function structuredDataScript(data: object): string {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}
