import type { DiagRecorder } from '../diagnostics/recorder.ts';
import type { OptionsMessage } from '../messages/options.ts';
import { openShortcutSettings, refreshShortcuts } from './commands.ts';
import type { SendFrame } from './native.ts';
import { changeSettings } from './settings.ts';
import { setSite, type SiteDeps } from './sites.ts';

export interface OptionsIntentDeps extends SiteDeps {
  /** Sends frames the shell handles itself: also while its service is unavailable. */
  toShell: SendFrame;
  /** Resolves once the worker restored what it keeps, the settings among it. */
  restored(): Promise<void>;
  diagnostics: DiagRecorder;
}

/**
 * What the options page asks for: the extension's settings, the websites the person allowed,
 * Chrome's command shortcuts, and opening Atd or its settings as the panel's More menu does. `tab`
 * is the options page's own tab (its port's sender), beside which Chrome's shortcut page opens.
 */
export function handleOptionsIntent(
  deps: OptionsIntentDeps,
  intent: OptionsMessage,
  tab: chrome.tabs.Tab | undefined,
): void {
  switch (intent.type) {
    case 'toolbarAction.set': {
      const toolbarAction = intent.action;
      // After the restore, which would otherwise replace the person's choice with the kept one.
      void deps.restored().then(() => changeSettings(deps.store, { toolbarAction }));
      return;
    }
    case 'site.set':
      setSite(deps, intent.origin, intent.allowed);
      return;
    case 'shortcuts.refresh':
      void refreshShortcuts(deps.store);
      return;
    case 'shortcuts.edit':
      void openShortcutSettings(tab);
      return;
    case 'app.open':
      deps.toShell({ t: 'app.open' });
      return;
    case 'settings.open':
      deps.toShell({ t: 'settings.open' });
      return;
    case 'diag.event':
      deps.diagnostics.recordSurfaceEvent('options', intent);
      return;
  }
}
