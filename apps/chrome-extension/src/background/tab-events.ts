import type { DiagRecorder } from '../diagnostics/recorder.ts';
import { summarizeError } from '../diagnostics/sanitize.ts';
import type { CdpTranslator } from './cdp/translator.ts';
import type { HiddenRuns } from './hidden-runs.ts';
import type { Ownership } from './ownership.ts';
import type { OwnedTabs } from './owned-tabs.ts';
import type { RunLinks } from './run-links.ts';
import type { Surfaces } from './surfaces.ts';
import type { TabGroups } from './tab-group.ts';

export interface TabEventDeps {
  ownership: Ownership;
  owned: OwnedTabs;
  groups: TabGroups;
  surfaces: Surfaces;
  translator: CdpTranslator;
  links: RunLinks;
  hidden: HiddenRuns;
  diagnostics: DiagRecorder;
  /** Resolves once the restored state is loaded; events wait for it. */
  booted: Promise<void>;
}

/**
 * Chrome's tab and window events, registered in the worker's first turn (MV3 delivers the event
 * that woke a stopped worker only to listeners added then). They keep ownership, the asks' run
 * links, the runs hidden per tab, the shell's `tab.state`, and the surfaces' sites current.
 */
export function listenToTabs(deps: TabEventDeps): void {
  const { ownership, links, hidden } = deps;
  const after = (task: () => unknown): void => {
    deps.booted.then(task).catch((error: unknown) => {
      console.warn('[atd] a tab event failed', error);
      deps.diagnostics.recordBackground({
        level: 'warn',
        cat: 'tabs',
        code: 'event_failed',
        msg: summarizeError(error, 'Tab event handler failed'),
      });
    });
  };
  chrome.tabs.onCreated.addListener((tab) => after(() => ownership.adoptOpened(tab)));
  chrome.tabs.onRemoved.addListener((tabId) =>
    after(() => {
      deps.diagnostics.forgetTab(tabId);
      ownership.release(tabId, 'closed');
      links.tabClosed(tabId);
      hidden.tabClosed(tabId);
    }),
  );
  chrome.tabs.onUpdated.addListener((tabId, change) =>
    after(() => tabUpdated(deps, tabId, change)),
  );
  chrome.tabs.onReplaced.addListener((added, removed) =>
    after(() => {
      links.tabReplaced(removed, added);
      hidden.tabReplaced(removed, added);
      return ownership.replaced(added, removed);
    }),
  );
  chrome.tabs.onAttached.addListener((tabId) => after(() => ownership.reportState(tabId)));
  // Activation and focus change which owned tabs are active and focused, several at once.
  const focusMoved = (): void => after(() => ownership.reportAll());
  chrome.tabs.onActivated.addListener(focusMoved);
  chrome.windows.onFocusChanged.addListener(focusMoved);
  chrome.tabGroups.onRemoved.addListener((group) => after(() => deps.groups.forget(group.id)));
}

async function tabUpdated(
  deps: TabEventDeps,
  tabId: number,
  change: chrome.tabs.OnUpdatedInfo,
): Promise<void> {
  if (change.url !== undefined) deps.surfaces.noteUrl(tabId, change.url);
  if (deps.owned.get(tabId) === undefined) return;
  if (change.groupId !== undefined) await deps.ownership.groupChanged(tabId);
  if (change.url !== undefined || change.title !== undefined)
    await deps.ownership.reportState(tabId);
  // A finished load is when a tab that lost its attachment on a page Chrome keeps from extensions
  // can be attached again.
  if (change.status === 'complete') deps.translator.visibilityChanged();
}
