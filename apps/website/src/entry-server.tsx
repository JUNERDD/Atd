import { renderToString } from 'react-dom/server';
import posts from 'virtual:atd-blog';
import { App } from './app';
import { renderHead, type HeadOptions, type PostHead } from './head';
import { htmlLang, LANGS, pagePath, postSlugOf, type Lang, type Page } from './i18n/routes';
import { GITHUB_STARS_FALLBACK, STAR_META_NAME } from './lib/github-stars';
import type { BlogIndexPostData } from './structured-data';

const pages: Page[] = [
  'home',
  'blog',
  ...posts.map((post) => `blog/${post.slug}` as const),
  'debug',
];

export { posts };

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

/** A post page's own title, description, date, share image, and section titles for its head tags. */
function postHead(lang: Lang, page: Page): PostHead | undefined {
  const slug = postSlugOf(page);
  if (slug === null) return undefined;
  const post = posts.find((candidate) => candidate.slug === slug);
  if (!post) return undefined;
  const copy = post.copy[lang];
  const cover = copy.highlights[0];
  return {
    slug: post.slug,
    version: post.version,
    title: copy.title,
    description: copy.summary,
    published: post.date,
    keywords: [`Atd ${post.version}`, ...copy.highlights.map((highlight) => highlight.title)],
    ...(cover ? { image: { ...cover.image, alt: cover.alt } } : {}),
  };
}

function blogIndexPosts(lang: Lang, siteUrl: string): BlogIndexPostData[] {
  return posts.map((post) => {
    const copy = post.copy[lang];
    const cover = copy.highlights[0];
    return {
      slug: post.slug,
      version: post.version,
      title: copy.title,
      description: copy.summary,
      published: post.date,
      ...(cover ? { image: `${siteUrl}${cover.image.src}` } : {}),
    };
  });
}

function leadPreloadImage(lang: Lang, page: Page, post: PostHead | undefined): string | undefined {
  if (post?.image) return post.image.src;
  if (page === 'blog') return posts[0]?.copy[lang].highlights[0]?.image.src;
  return undefined;
}

/** Renders one language's page: the app markup, its head tags, and the `<html>` attributes. */
export function render(
  lang: Lang,
  siteUrl: string,
  page: Page = 'home',
  initialStars: number = GITHUB_STARS_FALLBACK,
) {
  const post = postHead(lang, page);
  const preloadImage = leadPreloadImage(lang, page, post);
  const headOptions: HeadOptions = {
    ...(post ? { post } : {}),
    ...(page === 'blog' ? { blogPosts: blogIndexPosts(lang, siteUrl) } : {}),
    ...(preloadImage ? { preloadImage } : {}),
  };
  const pageAttr = page === 'not-found' ? ' data-page="not-found"' : '';
  return {
    html: renderToString(<App lang={lang} page={page} initialStars={initialStars} />),
    head: `${renderHead(lang, siteUrl, page, headOptions)}\n    <meta name="${STAR_META_NAME}" content="${initialStars}" />`,
    htmlAttrs: `lang="${htmlLang[lang]}" data-lang="${lang}" data-theme="dark"${pageAttr}`,
  };
}
