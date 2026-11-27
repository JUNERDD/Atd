import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n, documentLanguage } from '../i18n/create.ts';
import en from '../i18n/locales/en/options.json';
import zhCN from '../i18n/locales/zh-CN/options.json';
import { Options } from './app.tsx';
// The kit first, the one the panel carries: the page's own rules are unlayered too and win by
// coming later. Its script installs the menu behavior of the toolbar button's pop-up.
import '../kit/apple-kit.css';
import '../kit/apple-kit.js';
import '../pages/page.css';
import './options.css';

// English, the source language, until the first state brings Atd's setting: the page shows no copy
// before it (Options switches before painting the view), so it needs no guess of its own.
document.documentElement.lang = documentLanguage('en');
const i18n = createI18n('options', { en, 'zh-CN': zhCN }, 'en');

const root = document.getElementById('root');
if (!root) throw new Error('The options document has no #root element.');
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Options />
    </I18nextProvider>
  </StrictMode>,
);
