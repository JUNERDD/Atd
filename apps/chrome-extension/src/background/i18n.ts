import { resolveLanguage, type AppLanguage } from '@atd/agent-contracts';
import { createI18n } from '../i18n/create.ts';
import en from '../i18n/locales/en/background.json';
import zhCN from '../i18n/locales/zh-CN/background.json';

/**
 * The service worker's copy: the tab group's attention title, the toolbar button's tooltip and
 * the reasons for requests the worker refuses itself. It follows the language Atd forwards; until
 * Atd has said, Chrome's UI language decides, resolved the way Atd resolves an unset language.
 */
const instance = createI18n(
  'background',
  { en, 'zh-CN': zhCN },
  resolveLanguage(chrome.i18n.getUILanguage()),
);

export const t = instance.getFixedT(null, 'background');

/** Switches the copy's language; true when it changed, so callers repaint what shows copy. */
export function setLanguage(language: AppLanguage): boolean {
  if (instance.language === language) return false;
  void instance.changeLanguage(language);
  return true;
}
