import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import { App } from './App';
import { SettingsWindow } from './features/settings/settings-window';

document.documentElement.dataset.runtime = window.desktop ? 'electron' : 'web';
document.documentElement.dataset.platform = window.desktop?.platform ?? 'web';
const isSettingsWindow = window.location.hash === '#settings';
document.documentElement.dataset.window = isSettingsWindow ? 'settings' : 'panel';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isSettingsWindow ? <SettingsWindow /> : <App />}</React.StrictMode>,
);
