import 'i18next';
import type background from './locales/en/background.json';
import type hud from './locales/en/hud.json';
import type popup from './locales/en/popup.json';

/** Keys are typed from the English files, the source language. */
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { background: typeof background; hud: typeof hud; popup: typeof popup };
  }
}
