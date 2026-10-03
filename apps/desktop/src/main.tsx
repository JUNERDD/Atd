import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import '@atd/ui/styles.css';
import './styles.css';
import i18n, { initialLanguageReady } from './i18n';
import { installEditCommands } from './lib/edit-commands';
import { NativeBridge } from './native-bridge/client';
import { installNativeHost } from './native-host';
import { loadMarkdown } from './features/agent/transcript/markdown-loader';

/** Which window this page is: the shell loads the settings and welcome guide windows by hash. */
const windowKind = (() => {
  const { hash } = window.location;
  if (hash === '#settings' || hash.startsWith('#settings?')) return 'settings';
  if (hash === '#onboarding') return 'onboarding';
  return 'panel';
})();
const root = document.getElementById('root')!;
// The macOS shell hosts this page and installs `window.desktop` from its message handler before
// the first render. A plain browser on the dev server has no shell, so it gets only a notice.
const nativeBridge = NativeBridge.connect();
if (nativeBridge) await renderWindow(nativeBridge);
else await renderHostRequired();

async function renderWindow(native: NativeBridge) {
  const windowRoot = loadWindowRoot();
  // The panel renders transcripts as soon as a task loads; start the markdown chunk alongside its
  // tree, so a transcript rarely has to show plain text first.
  if (windowKind === 'panel') void loadMarkdown();
  await installNativeHost(native, windowKind);
  document.documentElement.dataset.window = windowKind;
  // Every window runs the application menu's Undo/Redo through this entry.
  const disposeEditCommands = installEditCommands();
  import.meta.hot?.dispose(disposeEditCommands);
  // A non-English first language loads its translations (started when i18n loaded) before any
  // text renders.
  const [WindowRoot] = await Promise.all([windowRoot, initialLanguageReady]);
  // The welcome guide's window is a transparent full-screen stage: a loading surface would paint
  // over the whole display, so it waits on nothing visible.
  const fallback =
    windowKind === 'onboarding' ? null : (
      <output className="settings-loading">{i18n.t('window.loading')}</output>
    );
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <React.Suspense fallback={fallback}>
        <WindowRoot />
      </React.Suspense>
    </React.StrictMode>,
  );
}

// Each window loads only its own tree: the settings window never parses the panel, and vice versa.
// The entry awaits it before the first render rather than suspending on it: a root Suspense
// fallback would hold the window's content back by React's fallback throttle (300 ms).
// Keep each window's import a separate statement: a conditional expression around both imports
// gets one preload wrapper with only the panel's CSS dependencies, so the settings window rendered
// without its own stylesheet.
async function loadWindowRoot() {
  if (windowKind === 'settings') {
    const module = await import('./features/settings/settings-window');
    return module.SettingsWindow;
  }
  if (windowKind === 'onboarding') {
    const module = await import('./features/onboarding/onboarding-window');
    return module.OnboardingWindow;
  }
  const module = await import('./App');
  return module.App;
}

async function renderHostRequired() {
  await initialLanguageReady;
  ReactDOM.createRoot(root).render(
    <output className="settings-loading">{i18n.t('hostRequired', { ns: 'common' })}</output>,
  );
}
