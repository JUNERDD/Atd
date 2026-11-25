import type { AppLanguage } from '@atd/agent-contracts';
import type { TFunction } from 'i18next';
import { createI18n, documentLanguage } from '../i18n/create.ts';
import en from '../i18n/locales/en/hud.json';
import zh from '../i18n/locales/zh-CN/hud.json';

/** The content script's copy (the `hud` namespace), typed from the English file. */
export type HudT = TFunction<'hud'>;

/**
 * Before Atd's language arrives with the first `state`, Chrome's UI language decides; nothing is
 * shown before that state anyway.
 */
function initialLanguage(): AppLanguage {
  return chrome.i18n.getUILanguage().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

const instance = createI18n('hud', { en, 'zh-CN': zh }, initialLanguage());

/** Follows the current language at call time. */
export const t: HudT = instance.getFixedT(null, 'hud');

/** Switches to `language`; returns whether it changed (surfaces then render again). */
export function applyLanguage(language: AppLanguage): boolean {
  if (instance.language === language) return false;
  void instance.changeLanguage(language);
  return true;
}

/** The BCP 47 tag for the hosts' `lang`. */
export function currentDocumentLanguage(): string {
  return documentLanguage(instance.language === 'zh-CN' ? 'zh-CN' : 'en');
}
