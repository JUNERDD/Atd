import 'i18next';
import type background from './locales/en/background.json';
import type hud from './locales/en/hud.json';
import type options from './locales/en/options.json';
import type panel from './locales/en/panel.json';

/** Keys are typed from the English files, the source language. */
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: {
      background: typeof background;
      hud: typeof hud;
      panel: typeof panel;
      options: typeof options;
    };
  }
}
