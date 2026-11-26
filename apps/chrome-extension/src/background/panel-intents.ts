import type { PanelMessage } from '../messages/panel.ts';
import { sendAsk } from './asks.ts';
import type { SendFrame } from './native.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import type { Pairing } from './pairing.ts';
import type { PendingRequests } from './requests.ts';
import type { Store } from './store.ts';
import type { PanelReply } from './surfaces.ts';
import { webOrigin } from './urls.ts';

export interface PanelIntentDeps {
  store: Store;
  /** Sends frames that need Atd: dropped while the channel is not ready. */
  forward: SendFrame;
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
 * and control of the runs in this browser. Answers to an ask go back to the panel that sent it.
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
  }
}

/**
 * The site switch (D6): sent to Atd and shown at once; Atd's `sites` frame that follows is the
 * truth. Only an http(s) origin, exactly as `URL.origin` writes it, is a site.
 */
function setSite(deps: PanelIntentDeps, origin: string, allowed: boolean): void {
  if (webOrigin(origin)?.origin !== origin || !deps.forward({ t: 'site.set', origin, allowed }))
    return;
  const others = deps.store.state.sites.filter((site) => site !== origin);
  deps.store.update({ sites: allowed ? [...others, origin] : others });
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
