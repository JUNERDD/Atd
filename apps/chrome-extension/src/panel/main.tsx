import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { createI18n, documentLanguage } from '../i18n/create.ts';
import en from '../i18n/locales/en/panel.json';
import zhCN from '../i18n/locales/zh-CN/panel.json';
import { Panel } from './app.tsx';
import { SURFACE } from './surface.ts';
// The kit first: the panel's own rules are unlayered too and win by coming later. Its script
// installs the menu behavior the toolbar's More menu uses.
import '../kit/apple-kit.css';
import '../kit/apple-kit.js';
import '../pages/page.css';
import './panel.css';
import './connect.css';
import './composer.css';

// English, the source language, until the first state brings Atd's setting: the panel shows no
// copy before it (Panel switches before painting the view), so it needs no guess of its own.
document.documentElement.lang = documentLanguage('en');
// The side panel fills its column; the popup sizes to its content (panel.css).
document.documentElement.dataset.surface = SURFACE;
const i18n = createI18n('panel', { en, 'zh-CN': zhCN }, 'en');

const root = document.getElementById('root');
if (!root) throw new Error('The panel document has no #root element.');
createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Panel />
    </I18nextProvider>
  </StrictMode>,
);
