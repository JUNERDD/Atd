import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import './web/web.css';
import i18n, { initialLanguageReady } from './i18n';
import { installNativeOverlayBlur } from './native-overlay-blur';
import { installEditCommands } from './lib/edit-commands';
import { loadMarkdown } from './features/agent/transcript/markdown-loader';

const isSettingsWindow =
  window.location.hash === '#settings' || window.location.hash.startsWith('#settings?');
// Each window loads only its own tree: the settings window never parses the panel, and vice versa.
// The entry awaits it before the first render rather than suspending on it: a root Suspense
// fallback would hold the window's content back by React's fallback throttle (300 ms).
// Keep each window's import a separate statement: a conditional expression around both imports
// gets one preload wrapper with only the panel's CSS dependencies, so the settings window rendered
// without its own stylesheet.
async function loadWindowRoot() {
  if (isSettingsWindow) {
    const module = await import('./features/settings/settings-window');
    return module.SettingsWindow;
  }
  const module = await import('./App');
  return module.App;
}
const windowRoot = loadWindowRoot();
// The panel renders transcripts as soon as a task loads; start the markdown chunk alongside its
// tree, so a transcript rarely has to show plain text first.
if (!isSettingsWindow) void loadMarkdown();

// Without the Electron preload (a plain browser on `pnpm dev:web`, conventionally opened with
// `?preview`) no host installs `window.desktop`: the page is a bare renderer for layout checks.
const runtime = window.desktop?.runtime ?? 'web';
document.documentElement.dataset.runtime = runtime;
// Platform styles describe native window surfaces, which only the Electron runtime has.
document.documentElement.dataset.platform =
  runtime === 'electron' ? (window.desktop?.platform ?? 'web') : 'web';
document.documentElement.dataset.window = isSettingsWindow ? 'settings' : 'panel';
const root = document.getElementById('root')!;
// Both windows (panel and settings) run the application menu's Undo/Redo through this entry.
const disposeEditCommands = installEditCommands();
import.meta.hot?.dispose(disposeEditCommands);
if (runtime === 'electron' && window.desktop?.platform === 'darwin') {
  const disposeOverlayBlur = installNativeOverlayBlur(root);
  import.meta.hot?.dispose(disposeOverlayBlur);
}

// A non-English first language loads its translations (started when i18n loaded) before any text renders.
const [WindowRoot] = await Promise.all([windowRoot, initialLanguageReady]);
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <React.Suspense
      fallback={<output className="settings-loading">{i18n.t('window.loading')}</output>}
    >
      <WindowRoot />
    </React.Suspense>
  </React.StrictMode>,
);
