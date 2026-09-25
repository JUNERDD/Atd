import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import './web/web.css';
import { App } from './App';
import i18n from './i18n';
import { installNativeOverlayBlur } from './native-overlay-blur';
import { installEditCommands } from './lib/edit-commands';
const SettingsWindow = React.lazy(() =>
  import('./features/settings/settings-window').then((module) => ({
    default: module.SettingsWindow,
  })),
);

const WebSignIn = React.lazy(() =>
  import('./web/web-sign-in').then((module) => ({ default: module.WebSignIn })),
);

// In a plain browser (the dev server `pnpm dev` runs, or the build the service serves) the page
// signs in to the agent service and installs the same bridge the desktop preload provides.
// `?preview` keeps a bare renderer without a service, for layout checks.
const webHost =
  !window.desktop && !new URLSearchParams(window.location.search).has('preview')
    ? await import('./web').then((module) => module.installWebHost())
    : null;
const runtime = window.desktop?.runtime ?? 'web';
document.documentElement.dataset.runtime = runtime;
// Platform styles describe native window surfaces, which only the Electron runtime has.
document.documentElement.dataset.platform =
  runtime === 'electron' ? (window.desktop?.platform ?? 'web') : 'web';
const isSettingsWindow =
  window.location.hash === '#settings' || window.location.hash.startsWith('#settings?');
document.documentElement.dataset.window = isSettingsWindow ? 'settings' : 'panel';
const root = document.getElementById('root')!;
// Both windows (panel and settings) run the application menu's Undo/Redo through this entry.
const disposeEditCommands = installEditCommands();
import.meta.hot?.dispose(disposeEditCommands);
if (runtime === 'electron' && window.desktop?.platform === 'darwin') {
  const disposeOverlayBlur = installNativeOverlayBlur(root);
  import.meta.hot?.dispose(disposeOverlayBlur);
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <React.Suspense
      fallback={<output className="settings-loading">{i18n.t('window.loading')}</output>}
    >
      {webHost && webHost.kind !== 'ready' ? (
        <WebSignIn state={webHost} />
      ) : isSettingsWindow ? (
        <SettingsWindow />
      ) : (
        <App />
      )}
    </React.Suspense>
  </React.StrictMode>,
);
