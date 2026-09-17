import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommands from './locales/en/commands.json';
import enCommon from './locales/en/common.json';
import enMemory from './locales/en/memory.json';
import enPanel from './locales/en/panel.json';
import enProviders from './locales/en/providers.json';
import enSettings from './locales/en/settings.json';
import enTasks from './locales/en/tasks.json';
import zhCommands from './locales/zh-CN/commands.json';
import zhCommon from './locales/zh-CN/common.json';
import zhMemory from './locales/zh-CN/memory.json';
import zhPanel from './locales/zh-CN/panel.json';
import zhProviders from './locales/zh-CN/providers.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhTasks from './locales/zh-CN/tasks.json';
import { initialLanguage } from './languages';

export const defaultNS = 'settings' as const;
export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    providers: enProviders,
    commands: enCommands,
    memory: enMemory,
    panel: enPanel,
    tasks: enTasks,
  },
  'zh-CN': {
    common: zhCommon,
    settings: zhSettings,
    providers: zhProviders,
    commands: zhCommands,
    memory: zhMemory,
    panel: zhPanel,
    tasks: zhTasks,
  },
} as const;

// Bundled resources keep init synchronous, so t() is ready on the first render.
void i18n.use(initReactI18next).init({
  lng: initialLanguage(),
  fallbackLng: 'en',
  supportedLngs: Object.keys(resources),
  defaultNS,
  ns: Object.keys(resources.en),
  resources,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
