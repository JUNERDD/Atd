import { renderToString } from 'react-dom/server';
import posts from 'virtual:atd-blog';
import { App } from './app';
import { renderHead, type PostHead } from './head';
import { htmlLang, LANGS, pagePath, postSlugOf, type Lang, type Page } from './i18n/routes';

const pages: Page[] = [
  'home',
  'blog',
  ...posts.map((post) => `blog/${post.slug}` as const),
  'debug',
];

/** Every prerendered page: its language, its URL path and `hreflang`, and its directory under `dist`. */
export const routes = pages.flatMap((page) =>
  LANGS.map((lang) => {
    const path = pagePath(lang, page);
    return {
      lang,
      page,
      path,
      hreflang: htmlLang[lang],
      dir: path === '/' ? './' : `${path.slice(1)}/`,
      indexable: page !== 'debug',
    };
  }),
);

/** A post page's own title, description, date and share image, for its head tags. */
function postHead(lang: Lang, page: Page): PostHead | undefined {
  const post = posts.find((candidate) => candidate.slug === postSlugOf(page));
  if (!post) return undefined;
  const copy = post.copy[lang];
  const cover = copy.highlights[0];
  return {
    title: copy.title,
    description: copy.summary,
    published: post.date,
    ...(cover ? { image: { ...cover.image, alt: cover.alt } } : {}),
  };
}

/** Renders one language's page: the app markup, its head tags, and the `<html>` attributes. */
export function render(lang: Lang, siteUrl: string, page: Page = 'home') {
  return {
    html: renderToString(<App lang={lang} page={page} />),
    head: renderHead(lang, siteUrl, page, postHead(lang, page)),
    htmlAttrs: `lang="${htmlLang[lang]}" data-lang="${lang}" data-theme="dark"`,
  };
}
