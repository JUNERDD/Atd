import {
  DiagRecorder,
  installBackgroundErrorCapture,
  type BackgroundDiagReporter,
} from '../diagnostics/recorder.ts';
import { summarizeError } from '../diagnostics/sanitize.ts';
import {
  actionClicked,
  configureActionSurface,
  openPanel,
  panelSurface,
} from './action-surface.ts';
import { CdpError } from './cdp/messages.ts';
import { Debuggee } from './cdp/debuggee.ts';
import { CdpTranslator } from './cdp/translator.ts';
import { ASK_COMMAND, refreshShortcuts } from './commands.ts';
import {
  handleContentIntent,
  handleInvalidContent,
  type ContentIntentDeps,
} from './content-intents.ts';
import { watchDevBuilds } from './dev-reload.ts';
import { FollowUps } from './follow-ups.ts';
import { HiddenRuns } from './hidden-runs.ts';
import { setLanguage } from './i18n.ts';
import { browserLabel, browserVersion, helloFrame, installationId } from './identity.ts';
import { Indicators } from './indicators.ts';
import { ContentInjector, openAsk } from './inject.ts';
import { NativeChannel, type CloseReason, type SendFrame } from './native.ts';
import { handleOptionsIntent, type OptionsIntentDeps } from './options-intents.ts';
import { OwnedTabs } from './owned-tabs.ts';
import { Ownership } from './ownership.ts';
import { Pairing } from './pairing.ts';
import { Pointers } from './pointer.ts';
import { handlePanelIntent, type PanelIntentDeps } from './panel-intents.ts';
import { optionsView, panelView, shownRun, tabView, type TabRuns } from './projection.ts';
import { PendingRequests } from './requests.ts';
import { RunLinks } from './run-links.ts';
import { restoreSettings } from './settings.ts';
import { handleShellFrame, type ShellFrameDeps } from './shell-frames.ts';
import { effectivePrefs, restorePrefs, Store } from './store.ts';
import { Surfaces } from './surfaces.ts';
import { listenToTabs } from './tab-events.ts';
import { TabGroups } from './tab-group.ts';

/**
 * The service worker of Atd for Chrome (an MV3 module). It owns the native channel to the Atd
 * shell and every Chrome API side effect; the content scripts and the panels render the views it
 * pushes and send intents back. Every listener is added in this first turn, because Chrome hands
 * the event that woke a stopped worker only to listeners registered then; work that needs the
 * restored state waits for `booted`. Startup always connects, so a worker stopped while it backed
 * off reconnects on its next wake.
 */

const store = new Store();
/** Where Atd's panel opens (the in-page ask's Open side panel, the options page); fixed. */
const panel = panelSurface();
const send: SendFrame = (frame) => channel.send(frame);
/** Frames that need Atd: dropped while the channel is not ready. */
const forward: SendFrame = (frame) => store.state.connection === 'ready' && channel.send(frame);
/**
 * Frames the shell handles itself (opening Atd or its settings): they also go through while the
 * shell answers without its service.
 */
const toShell: SendFrame = (frame) =>
  (store.state.connection === 'ready' || store.state.connection === 'serviceUnavailable') &&
  channel.send(frame);

const diagnostics = new DiagRecorder(send);
installBackgroundErrorCapture(diagnostics);
const onDiag: BackgroundDiagReporter = (input) => diagnostics.recordBackground(input);

const pairing = new Pairing(store, send, onDiag);
const owned = new OwnedTabs();
const groups = new TabGroups();
const links = new RunLinks(() => surfaces.schedulePush());
const hidden = new HiddenRuns(() => surfaces.schedulePush());
const surfaces = new Surfaces(
  {
    panel: () => panelView(store.state, browserLabel()),
    options: () => optionsView(store.state, browserLabel(), panel),
    tab: (tabId, url) => tabView(store.state, tabId, url, tabRuns(tabId), panel),
  },
  {
    content: (tabId, intent, reply, origin) =>
      handleContentIntent(contentDeps, tabId, intent, reply, origin),
    invalidContent: (tabId, message) => handleInvalidContent(contentDeps, tabId, message),
    panel: (intent, reply) => handlePanelIntent(panelDeps, intent, reply),
    options: (intent, tab) => handleOptionsIntent(optionsDeps, intent, tab),
    pageOpened: () => void refreshShortcuts(store),
    onDiagnostic: onDiag,
  },
);
const injector = new ContentInjector(surfaces, onDiag);
const pointers = new Pointers(owned, surfaces);
const ownership = new Ownership(owned, groups, injector, pointers, send, onDiag);
const requests = new PendingRequests();
const followUps = new FollowUps((taskId) => {
  for (const tabId of surfaces.contentTabs())
    if (shownRun(store.state, tabId, tabRuns(tabId))?.taskId === taskId)
      surfaces.postToTab(tabId, { type: 'followUp.failed', taskId });
});
const indicators = new Indicators(store, owned, groups);
const debuggee = new Debuggee({
  event: (tabId, child, method, params) => translator.debuggerEvent(tabId, child, method, params),
  input: (tabId) => owned.noteAtdInput(tabId),
});
const translator = new CdpTranslator({
  send,
  debuggee,
  visibleTabs: () => owned.activeTabs(),
  openTab: openForWorker,
  closeTab: (tabId) => chrome.tabs.remove(tabId),
  version: browserVersion,
  onDiagnostic: onDiag,
});
const channel = new NativeChannel({
  hello: () => helloFrame(pairing.currentSecret()),
  frame: (frame) => handleShellFrame(frameDeps, frame),
  closed: channelClosed,
  onDiagnostic: onDiag,
});

const contentDeps: ContentIntentDeps = {
  store,
  forward,
  toShell,
  surfaces,
  requests,
  ownership,
  followUps,
  hidden,
  diagnostics,
  shownRun: (tabId) => shownRun(store.state, tabId, tabRuns(tabId)),
};
const panelDeps: PanelIntentDeps = {
  store,
  forward,
  toShell,
  reconnect: () => {
    channel.reconnectNow();
    store.update({ connection: 'connecting' });
  },
  pairing,
  owned,
  requests,
  diagnostics,
};
const optionsDeps: OptionsIntentDeps = {
  store,
  forward,
  toShell,
  restored: () => booted,
  diagnostics,
};
const frameDeps: ShellFrameDeps = {
  store,
  channel,
  pairing,
  ownership,
  pointers,
  translator,
  requests,
  links,
  hidden,
  followUps,
  diagnostics,
};

store.subscribe(() => {
  setLanguage(effectivePrefs(store.state.prefs).language);
  surfaces.schedulePush();
  indicators.schedule();
});
owned.onChange(() => {
  translator.visibilityChanged();
  surfaces.schedulePush();
  indicators.schedule();
});

configureActionSurface();
const booted = boot();
// A literal mode, so the release build leaves the dev reloader out entirely.
if (import.meta.env.MODE === 'dev') {
  void watchDevBuilds(
    {
      contentTabs: () => surfaces.contentTabs(),
      inject: (tabId) => injector.ensure(tabId),
      beforeReload: () => diagnostics.prepareDevReload(),
    },
    booted,
  );
}

chrome.runtime.onConnect.addListener((port) => surfaces.accept(port));
chrome.action.onClicked.addListener((tab) =>
  actionClicked(tab, store.state.settings.toolbarAction, askIn),
);
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === ASK_COMMAND) void askFromShortcut(tab);
});
chrome.debugger.onEvent.addListener((source, method, params) =>
  debuggee.handleEvent(source, method, params),
);
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (tabId === undefined || !debuggee.forget(tabId)) return;
  translator.debuggerDetached(tabId);
  void booted.then(() =>
    ownership.debuggerDetached(tabId, reason, () => translator.visibilityChanged()),
  );
});
listenToTabs({
  ownership,
  owned,
  groups,
  surfaces,
  translator,
  links,
  hidden,
  diagnostics,
  booted,
});

/**
 * What this worker knows of a tab's runs: the run owning it, those asked from it without its page,
 * and the ended ones whose HUD left it.
 */
function tabRuns(tabId: number): TabRuns {
  const owner = owned.get(tabId)?.runId;
  const linked = [...(owner === undefined ? [] : [owner]), ...links.displayRuns(tabId)];
  return { linked, hidden: hidden.inTab(tabId) };
}

/**
 * Restores what the last worker lifetime kept, then connects (also when restoring failed). The
 * installation id comes first: replacing an invalid one forgets the stored pairing.
 */
async function boot(): Promise<void> {
  try {
    await diagnostics.restore();
    await installationId(onDiag);
    const [prefs] = await Promise.all([
      restorePrefs(onDiag),
      restoreSettings(store, onDiag),
      pairing.restore(),
      owned.restore(onDiag),
      groups.restore(onDiag),
      links.restore(onDiag),
      hidden.restore(onDiag),
      debuggee.restore(onDiag),
    ]);
    if (prefs !== undefined) store.update({ prefs });
    surfaces.schedulePush();
    await refreshShortcuts(store);
  } catch (error) {
    console.warn('[atd] could not restore the last state', error);
    onDiag({
      level: 'error',
      cat: 'boot',
      code: 'restore_failed',
      msg: summarizeError(error, 'Could not restore service worker state'),
    });
  }
  channel.connect();
}

function channelClosed(reason: CloseReason): void {
  diagnostics.setPaired(false);
  store.update({ connection: reason });
  pairing.onDisconnected();
  translator.closeAll();
  requests.failAll('notConnected');
  followUps.clear();
  pointers.clearAll();
}

/** `Target.createTarget` from the worker: a background tab for the run that took a tab last. */
async function openForWorker(url: string): Promise<number> {
  const runId = owned.latestActiveRun();
  if (runId === undefined) throw new CdpError('No Atd run is using this browser.');
  return ownership.openForRun(runId, url);
}

/**
 * The person asked for Atd in `tab` (the toolbar button, the ask shortcut): the in-page ask where
 * the tab's content script can run, in every connection state, else Atd's panel. Decided before
 * anything is awaited, so the panel opens within the person's gesture; the in-page ask waits for
 * the restored state (a click may have woken the worker).
 */
function askIn(tab: chrome.tabs.Tab): void {
  const tabId = tab.id;
  if (tabId === undefined || !injector.reaches(tab)) {
    void openPanel({ windowId: tab.windowId });
    return;
  }
  void booted.then(() => openAsk({ id: tabId, windowId: tab.windowId }, injector, surfaces));
}

/**
 * The ask shortcut: the in-page ask (or the panel where it cannot run) whatever the person chose
 * for the toolbar button. Chrome names the tab for a shortcut pressed in a browser window; without
 * one, the query costs the gesture and the panel may no longer open.
 */
async function askFromShortcut(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const target =
    tab?.id === undefined
      ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      : tab;
  if (target !== undefined) askIn(target);
}
