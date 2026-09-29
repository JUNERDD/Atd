import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@ai/ui/styles.css';
import './styles.css';
import './preview.css';
import i18n, { initialLanguageReady } from './i18n';
import { installEditCommands } from './lib/edit-commands';
import { NativeBridge } from './native-bridge/client';
import { installNativeHost } from './native-host';
import { followDocumentFocus } from './window-state';
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

// The Electron preload installs `window.desktop` before any script runs; in the macOS shell the
// page installs it from the shell's message handler, before the first render. Without either (a
// plain browser on `pnpm dev:renderer`, conventionally opened with `?preview`) the page is a bare
// renderer for layout checks.
const nativeBridge = NativeBridge.connect();
if (nativeBridge) await installNativeHost(nativeBridge, isSettingsWindow ? 'settings' : 'panel');
const runtime = window.desktop?.runtime ?? 'preview';
document.documentElement.dataset.runtime = runtime;
// Platform styles describe native window surfaces, which only the desktop runtimes have.
if (window.desktop) document.documentElement.dataset.platform = window.desktop.platform;
document.documentElement.dataset.window = isSettingsWindow ? 'settings' : 'panel';
const root = document.getElementById('root')!;
// Both windows (panel and settings) run the application menu's Undo/Redo through this entry.
const disposeEditCommands = installEditCommands();
import.meta.hot?.dispose(disposeEditCommands);
// The shell pushes its key-window state to the native host; Electron follows document focus.
if (runtime === 'electron') {
  const disposeWindowFocus = followDocumentFocus();
  import.meta.hot?.dispose(disposeWindowFocus);
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
