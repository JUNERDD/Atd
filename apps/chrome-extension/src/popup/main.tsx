import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n, documentLanguage } from '../i18n/create.ts';
import en from '../i18n/locales/en/popup.json';
import zhCN from '../i18n/locales/zh-CN/popup.json';
import { Popup } from './app.tsx';
// The kit first: the popup's own rules are unlayered too and win by coming later.
import './apple-kit.css';
import './popup.css';
import './connect.css';

// English, the source language, until the first state brings Atd's setting: the popup shows no
// copy before it (Popup switches before painting the view), so it needs no guess of its own.
document.documentElement.lang = documentLanguage('en');
const i18n = createI18n('popup', { en, 'zh-CN': zhCN }, 'en');

const root = document.getElementById('root');
if (!root) throw new Error('The popup document has no #root element.');
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Popup />
    </I18nextProvider>
  </StrictMode>,
);
