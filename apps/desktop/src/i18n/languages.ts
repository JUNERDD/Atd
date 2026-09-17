import {
  LANGUAGE_CODES,
  resolveLanguage,
  type AppLanguage,
} from '../../electron/settings-contract';

/** Language names are endonyms: each option is written in its own language. */
export const LANGUAGE_NAMES: Record<AppLanguage, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

export const LANGUAGE_OPTIONS = LANGUAGE_CODES.map((code) => ({
  code,
  name: LANGUAGE_NAMES[code],
}));

export function initialLanguage(): AppLanguage {
  return resolveLanguage(navigator.language);
}
