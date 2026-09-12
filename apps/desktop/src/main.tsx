import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import { App } from './App';
const SettingsWindow = React.lazy(() =>
  import('./features/settings/settings-window').then((module) => ({
    default: module.SettingsWindow,
  })),
);

document.documentElement.dataset.runtime = window.desktop ? 'electron' : 'web';
document.documentElement.dataset.platform = window.desktop?.platform ?? 'web';
const isSettingsWindow = window.location.hash === '#settings';
document.documentElement.dataset.window = isSettingsWindow ? 'settings' : 'panel';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<output className="settings-status">Loading settings…</output>}>
      {isSettingsWindow ? <SettingsWindow /> : <App />}
    </React.Suspense>
  </React.StrictMode>,
);
