/** The site's languages. Each one is prerendered to its own route; English is the source language. */
export const LANGS = ['en', 'zh'] as const;

export type Lang = (typeof LANGS)[number];

/** Copy for every language, with one shape: each section keeps its own `Localized` copy object. */
export type Localized<T> = Record<Lang, T>;

/** The `lang` attribute value of each language's page. */
export const htmlLang: Localized<string> = { en: 'en', zh: 'zh-CN' };

export const languageNames: Localized<string> = { en: 'English', zh: '简体中文' };

/** Where each language's page lives. */
export const langPath: Localized<string> = { en: '/', zh: '/zh' };

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
