/** The site's languages. Each one is prerendered to its own route; English is the source language. */
export const LANGS = ['en', 'zh'] as const;

/**
 * A page of the site, which is also its path below the language's root: the home page, the blog's
 * list of posts, one post (`blog/<slug>`), diagnostic downloads, or a missing route.
 */
export type Page = 'home' | 'blog' | `blog/${string}` | 'debug' | 'not-found';

export type Lang = (typeof LANGS)[number];

/** Copy for every language, with one shape: each section keeps its own `Localized` copy object. */
export type Localized<T> = Record<Lang, T>;

/** The `lang` attribute value of each language's page. */
export const htmlLang: Localized<string> = { en: 'en', zh: 'zh-CN' };

export const languageNames: Localized<string> = { en: 'English', zh: '简体中文' };

/** Where each language's page lives. */
export const langPath: Localized<string> = { en: '/', zh: '/zh' };

export function pagePath(lang: Lang, page: Page): string {
  if (page === 'home' || page === 'not-found') return langPath[lang];
  return lang === 'en' ? `/${page}` : `/zh/${page}`;
}

export function pageFromPath(path: string): Page {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/' || clean === '/index.html' || clean === '/zh' || clean === '/zh/index.html')
    return 'home';
  const page = /^\/(?:zh\/)?(debug|blog(?:\/[a-z0-9-]+)?)$/.exec(clean)?.[1];
  if (page === undefined) return 'not-found';
  if (page === 'debug' || page === 'blog') return page;
  return `blog/${page.slice('blog/'.length)}` as const;
}

export function pageFromDocument(): Page {
  if (document.documentElement.dataset.page === 'not-found') return 'not-found';
  return pageFromPath(location.pathname);
}

/** The post a `blog/<slug>` page shows, or `null` for every other page. */
export function postSlugOf(page: Page): string | null {
  return page.startsWith('blog/') ? page.slice('blog/'.length) : null;
}

/** The localStorage key that records a visitor's explicit language choice. */
export const LANG_CHOICE_KEY = 'atd-lang';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'zh';
}

/**
 * The language of the current page. Prerendered pages carry it on `<html data-lang>`; the dev server
 * serves one unmarked template for every path, so there the path decides and the page is marked here,
 * which also gives Chinese its `:lang(zh)` typography.
 */
export function langFromDocument(): Lang {
  const root = document.documentElement;
  const marked = root.dataset.lang;
  if (isLang(marked)) return marked;
  const lang: Lang = location.pathname.startsWith('/zh') ? 'zh' : 'en';
  root.lang = htmlLang[lang];
  root.dataset.lang = lang;
  return lang;
}

/** Remembers an explicit choice so the root page stops suggesting the visitor's browser language. */
export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_CHOICE_KEY, lang);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice then lasts one visit.
  }
}
