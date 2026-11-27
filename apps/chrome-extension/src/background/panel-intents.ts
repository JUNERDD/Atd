import type { PanelMessage } from '../messages/panel.ts';
import { sendAsk } from './asks.ts';
import type { SendFrame } from './native.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import type { Pairing } from './pairing.ts';
import type { PendingRequests } from './requests.ts';
import { setSite, type SiteDeps } from './sites.ts';
import type { PanelReply } from './surfaces.ts';

export interface PanelIntentDeps extends SiteDeps {
  /** Sends frames the shell handles itself: also while its service is unavailable. */
  toShell: SendFrame;
  /** Reconnect now: the panel's answer to a broken channel. */
  reconnect(): void;
  pairing: Pairing;
  owned: OwnedTabs;
  requests: PendingRequests;
}

/**
 * What the panel asks for: pairing and the connection, the composer's requests, the site switch,
 * control of the runs in this browser, and the extension's options page. Answers to an ask go back
 * to the panel that sent it.
 */
export function handlePanelIntent(
  deps: PanelIntentDeps,
  intent: PanelMessage,
  reply: PanelReply,
): void {
  switch (intent.type) {
    case 'pair.start':
      deps.pairing.start();
      return;
    case 'pair.cancel':
      deps.pairing.cancel();
      return;
    case 'reconnect':
      deps.reconnect();
      return;
    case 'ask': {
      const { requestId, tabId, text, includePage, ownInput } = intent;
      const ask = { from: 'panel', tabId, requestId, text, includePage } as const;
      void sendAsk(deps, ownInput === undefined ? ask : { ...ask, ownInput }, reply);
      return;
    }
    case 'site.set':
      setSite(deps, intent.origin, intent.allowed);
      return;
    case 'run.stop':
      deps.forward({ t: 'run.stop', taskId: intent.taskId, runId: intent.runId });
      return;
    case 'tab.show':
      void showTab(deps, intent.tabId);
      return;
    case 'app.open':
      deps.toShell({
        t: 'app.open',
        ...(intent.taskId === undefined ? {} : { taskId: intent.taskId }),
      });
      return;
    case 'settings.open':
      deps.toShell({ t: 'settings.open' });
      return;
    case 'options.open':
      // It needs no connection: the extension's own page, in a tab (`options_ui`).
      chrome.runtime.openOptionsPage().catch((error: unknown) => {
        console.info('[atd] could not open the options page', error);
      });
      return;
  }
}

/** Show Tab: brings a run's tab and its window forward; only tabs runs work in. */
async function showTab(deps: PanelIntentDeps, tabId: number): Promise<void> {
  const ofRun =
    deps.owned.get(tabId) !== undefined ||
    deps.store.state.runs.some((run) => run.tabs.includes(tabId));
  if (!ofRun) return;
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    console.info(`[atd] could not show tab ${tabId}`, error);
  }
}
