import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGE_CODES, type AppLanguage } from '../client/settings-contract';
import enCommands from './locales/en/commands.json';
import enCommon from './locales/en/common.json';
import enMemory from './locales/en/memory.json';
import enOnboarding from './locales/en/onboarding.json';
import enPanel from './locales/en/panel.json';
import enProviders from './locales/en/providers.json';
import enSettings from './locales/en/settings.json';
import enTasks from './locales/en/tasks.json';
import { initialLanguage } from './languages';

export const defaultNS = 'settings' as const;
/** English is bundled: it is the fallback language and the source of the typed keys. */
export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    providers: enProviders,
    commands: enCommands,
    memory: enMemory,
    panel: enPanel,
    tasks: enTasks,
    onboarding: enOnboarding,
  },
} as const;

// Every other language loads on demand, one chunk per namespace file.
const translations = import.meta.glob<Record<string, unknown>>(
  ['./locales/*/*.json', '!./locales/en/*.json'],
  { import: 'default' },
);

async function loadLanguage(language: AppLanguage) {
  const folder = `./locales/${language}/`;
  await Promise.all(
    Object.entries(translations)
      .filter(([path]) => path.startsWith(folder))
      .map(async ([path, load]) => {
        const namespace = path.slice(folder.length, -'.json'.length);
        i18n.addResourceBundle(language, namespace, await load());
      }),
  );
}

let requested: AppLanguage = 'en';

/**
 * Switches only once the language's translations are loaded, so no render mixes locales. The latest
 * request wins: a switch whose translations are still loading is dropped when another one follows.
 */
export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  requested = language;
  if (!i18n.hasResourceBundle(language, defaultNS)) await loadLanguage(language);
  if (requested === language && i18n.resolvedLanguage !== language)
    await i18n.changeLanguage(language);
}

/** The document's language, for fonts and line breaking: BCP 47 names Simplified Chinese `zh-Hans`. */
function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language === 'zh-CN' ? 'zh-Hans' : language;
}
i18n.on('languageChanged', applyDocumentLanguage);

// Bundled English keeps init synchronous, so t() is ready as soon as this module loads.
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGE_CODES],
  defaultNS,
  ns: Object.keys(resources.en),
  resources,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Settles once the OS-derived first language is ready; the entry awaits it before rendering. */
export const initialLanguageReady = changeAppLanguage(initialLanguage());

export default i18n;
