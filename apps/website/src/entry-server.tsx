import { renderToString } from 'react-dom/server';
import { App } from './app';
import { renderHead } from './head';
import { htmlLang, LANGS, pagePath, type Lang, type Page } from './i18n/routes';

/** Every prerendered page: its language, its URL path and `hreflang`, and its directory under `dist`. */
export const routes = (['home', 'debug'] as const).flatMap((page) =>
  LANGS.map((lang) => {
    const path = pagePath(lang, page);
    return {
      lang,
      page,
      path,
      hreflang: htmlLang[lang],
      dir: path === '/' ? './' : `${path.slice(1)}/`,
      indexable: page === 'home',
    };
  }),
);

/** Renders one language's page: the app markup, its head tags, and the `<html>` attributes. */
export function render(lang: Lang, siteUrl: string, page: Page = 'home') {
  return {
    html: renderToString(<App lang={lang} page={page} />),
    head: renderHead(lang, siteUrl, page),
    htmlAttrs: `lang="${htmlLang[lang]}" data-lang="${lang}" data-theme="dark"`,
  };
}
