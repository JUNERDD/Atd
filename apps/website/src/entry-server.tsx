import { renderToString } from 'react-dom/server';
import { App } from './app';
import { renderHead } from './head';
import { htmlLang, LANGS, langPath, type Lang } from './i18n/routes';

/** Every prerendered page: its language, its URL path and `hreflang`, and its directory under `dist`. */
export const routes = LANGS.map((lang) => ({
  lang,
  path: langPath[lang],
  hreflang: htmlLang[lang],
  dir: lang === 'en' ? './' : `${lang}/`,
}));

/** Renders one language's page: the app markup, its head tags, and the `<html>` attributes. */
export function render(lang: Lang, siteUrl: string) {
  return {
    html: renderToString(<App lang={lang} />),
    head: renderHead(lang, siteUrl),
    htmlAttrs: `lang="${htmlLang[lang]}" data-lang="${lang}" data-theme="dark"`,
  };
}
