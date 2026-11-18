import React from 'react';
import ReactDOM from 'react-dom/client';
import { ScrollShadowDefaultContext } from '@atd/ui/lib/scroll-shadow-context';
import '@fontsource-variable/inter';
import '@atd/ui/styles.css';
import './window-scroll.css';
import './styles.css';
import i18n, { changeAppLanguage, defaultNS, initialLanguageReady } from './i18n';
import { WindowLoading } from './components/window-loading';
import { DiagnosticsErrorBoundary } from './features/diagnostics/error-boundary';
import { installEditCommands } from './lib/edit-commands';
import { NativeBridge } from './native-bridge/client';
import { installNativeHost } from './native-host';
import { installColorScheme } from './theme/color-scheme';

// The theme follows `prefers-color-scheme` (the shell applies the appearance setting app-wide);
// set it before anything renders, the host-required notice included.
const disposeColorScheme = installColorScheme();
import.meta.hot?.dispose(disposeColorScheme);

/**
 * Which window this page is: the shell loads the settings, welcome guide and generative view
 * windows by hash.
 */
const windowKind = (() => {
  const { hash } = window.location;
  if (hash === '#settings' || hash.startsWith('#settings?')) return 'settings';
  if (hash === '#onboarding') return 'onboarding';
  if (hash.startsWith('#view?')) return 'view';
  return 'panel';
})();
const root = document.getElementById('root')!;
// The macOS shell hosts this page and installs `window.desktop` from its message handler before
// the first render. A plain browser on the dev server has no shell, so it gets only a notice.
const nativeBridge = NativeBridge.connect();
if (nativeBridge) await renderWindow(nativeBridge);
else await renderHostRequired();

async function renderWindow(native: NativeBridge) {
  document.documentElement.dataset.window = windowKind;
  const windowRoot = loadWindowRoot();
  await installNativeHost(native, windowKind);
  // Every window runs the application menu's Undo/Redo through this entry.
  const disposeEditCommands = installEditCommands();
  import.meta.hot?.dispose(disposeEditCommands);
  // A non-English first language loads its translations (started when i18n loaded) before any
  // text renders; panel and settings also prime their initial query snapshots and hydrated
  // language in parallel so the first frame paints with settled theme, language, and state.
  const settingsReady =
    windowKind === 'panel' || windowKind === 'settings'
      ? import('./features/settings/use-settings')
          .then(({ readSettingsSnapshot }) => readSettingsSnapshot())
          .then(async (snapshot) => {
            await initialLanguageReady;
            if (
              !i18n.hasResourceBundle(snapshot.language, defaultNS) ||
              i18n.resolvedLanguage !== snapshot.language
            ) {
              await changeAppLanguage(snapshot.language);
            }
          })
          .catch(() => undefined)
      : Promise.resolve();
  const panelReady =
    windowKind === 'panel'
      ? Promise.all([
          import('./features/service/use-service').then(({ readServiceStatus }) =>
            readServiceStatus(),
          ),
          import('./features/agent/use-agent').then(({ readAgentSnapshot }) => readAgentSnapshot()),
        ]).catch(() => undefined)
      : Promise.resolve();
  const [WindowRoot] = await Promise.all([
    windowRoot,
    initialLanguageReady,
    settingsReady,
    panelReady,
  ]);
  // The welcome guide's window is a transparent full-screen stage: a loading surface would paint
  // over the whole display, so it waits on nothing visible. The others name the window being
  // opened and paint their content surface, except a view's window, whose surface the shell draws
  // (styles.css); their own trees place any shapes.
  const fallback =
    windowKind === 'onboarding' ? null : (
      <output className="window-loading" aria-busy="true">
        <WindowLoading
          title={
            windowKind === 'settings'
              ? i18n.t('window.loading')
              : windowKind === 'view'
                ? i18n.t('view.loading', { ns: 'tasks' })
                : i18n.t('panelLoading', { ns: 'common' })
          }
        />
      </output>
    );
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ScrollShadowDefaultContext.Provider value={windowKind !== 'panel'}>
        <DiagnosticsErrorBoundary>
          <React.Suspense fallback={fallback}>
            <WindowRoot />
          </React.Suspense>
        </DiagnosticsErrorBoundary>
      </ScrollShadowDefaultContext.Provider>
    </React.StrictMode>,
  );
  if (windowKind === 'panel') {
    const warmup = window.setTimeout(() => {
      void import('./features/agent/panel-view-loaders').then(({ warmPanelDeferredChunks }) =>
        warmPanelDeferredChunks(),
      );
    }, 120);
    import.meta.hot?.dispose(() => window.clearTimeout(warmup));
  }
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
  if (windowKind === 'view') {
    const module = await import('./features/agent/generative-views/view-window');
    return module.ViewWindow;
  }
  const module = await import('./App');
  return module.App;
}

async function renderHostRequired() {
  await initialLanguageReady;
  ReactDOM.createRoot(root).render(
    <output className="host-required">{i18n.t('hostRequired', { ns: 'common' })}</output>,
  );
}
