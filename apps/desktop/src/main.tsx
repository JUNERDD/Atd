import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import { App } from './App';

document.documentElement.dataset.runtime = window.desktop ? 'electron' : 'web';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
