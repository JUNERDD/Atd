import '@fontsource-variable/doto/wght.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app';
import { langFromDocument } from './i18n/routes';
import { initPressFeedback } from './lib/press-feedback';

const container = document.getElementById('root');
if (!container) throw new Error('The page template has no #root element.');

const app = (
  <StrictMode>
    <App lang={langFromDocument()} />
  </StrictMode>
);
// Built pages arrive prerendered and hydrate; the dev server serves an empty template.
if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);

initPressFeedback();
