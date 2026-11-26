import type { AppLanguage } from '@atd/agent-contracts';
import i18next, { type i18n } from 'i18next';

export type Namespace = 'background' | 'hud' | 'panel';

/** One namespace's translations in every shipped language (English is the source). */
export type NamespaceResources = Record<AppLanguage, Record<string, unknown>>;

/**
 * An i18next instance for one surface. Each surface (service worker, content script, panel)
 * bundles only its own namespace, in both languages, so `init` is synchronous and `t` is ready on
 * return. Interpolated values are not escaped: the content script renders through `textContent`
 * and React escapes on its own. Switch with `instance.changeLanguage(language)`.
 */
export function createI18n(
  namespace: Namespace,
  resources: NamespaceResources,
  language: AppLanguage,
): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng: language,
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    ns: [namespace],
    defaultNS: namespace,
    resources: {
      en: { [namespace]: resources.en },
      'zh-CN': { [namespace]: resources['zh-CN'] },
    },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
}

/** The document language for fonts and line breaking (BCP 47 names Simplified Chinese `zh-Hans`). */
export function documentLanguage(language: AppLanguage): string {
  return language === 'zh-CN' ? 'zh-Hans' : language;
}
