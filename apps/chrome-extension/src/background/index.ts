import { CdpError } from './cdp/messages.ts';
import { Debuggee } from './cdp/debuggee.ts';
import { CdpTranslator } from './cdp/translator.ts';
import { ASK_COMMAND, askShortcut } from './commands.ts';
import {
  handleContentIntent,
  handleInvalidContent,
  type ContentIntentDeps,
} from './content-intents.ts';
import { FollowUps } from './follow-ups.ts';
import { HiddenRuns } from './hidden-runs.ts';
import { setLanguage } from './i18n.ts';
import { browserLabel, browserVersion, helloFrame, installationId } from './identity.ts';
import { Indicators } from './indicators.ts';
import { ContentInjector, openAsk } from './inject.ts';
import { NativeChannel, type CloseReason, type SendFrame } from './native.ts';
import { OwnedTabs } from './owned-tabs.ts';
import { Ownership } from './ownership.ts';
import { Pairing } from './pairing.ts';
import { Pointers } from './pointer.ts';
import { handlePopupIntent, type PopupIntentDeps } from './popup-intents.ts';
import { popupView, shownRun, tabView, type TabRuns } from './projection.ts';
import { PendingRequests } from './requests.ts';
import { RunLinks } from './run-links.ts';
import { handleShellFrame, type ShellFrameDeps } from './shell-frames.ts';
import { effectivePrefs, restorePrefs, Store } from './store.ts';
import { Surfaces } from './surfaces.ts';
import { listenToTabs } from './tab-events.ts';
import { TabGroups } from './tab-group.ts';

/**
 * The service worker of Atd for Chrome (an MV3 module). It owns the native channel to the Atd
 * shell and every Chrome API side effect; the content scripts and the popup render the views it
 * pushes and send intents back. Every listener is added in this first turn, because Chrome hands
 * the event that woke a stopped worker only to listeners registered then; work that needs the
 * restored state waits for `booted`. Startup always connects, so a worker stopped while it backed
 * off reconnects on its next wake.
 */

const store = new Store();
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

const pairing = new Pairing(store, send);
const owned = new OwnedTabs();
const groups = new TabGroups();
const links = new RunLinks(() => surfaces.schedulePush());
const hidden = new HiddenRuns(() => surfaces.schedulePush());
const surfaces = new Surfaces(
  {
    popup: () => popupView(store.state, browserLabel()),
    tab: (tabId, url) => tabView(store.state, tabId, url, tabRuns(tabId)),
  },
  {
    content: (tabId, intent) => handleContentIntent(contentDeps, tabId, intent),
    invalidContent: (tabId, message) => handleInvalidContent(contentDeps, tabId, message),
    popup: (intent) => handlePopupIntent(popupDeps, intent),
    popupOpened: () => void refreshShortcut(),
  },
);
const injector = new ContentInjector(surfaces);
const pointers = new Pointers(owned, surfaces);
const ownership = new Ownership(owned, groups, injector, pointers, send);
const requests = new PendingRequests(surfaces);
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
});
const channel = new NativeChannel({
  hello: () => helloFrame(pairing.currentSecret()),
  frame: (frame) => handleShellFrame(frameDeps, frame),
  closed: channelClosed,
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
  shownRun: (tabId) => shownRun(store.state, tabId, tabRuns(tabId)),
};
const popupDeps: PopupIntentDeps = {
  store,
  forward,
  toShell,
  reconnect: () => {
    channel.reconnectNow();
    store.update({ connection: 'connecting' });
  },
  pairing,
  owned,
  openAsk: (tabId) => openAsk(tabId, store.state.pairing.state === 'paired', injector, surfaces),
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

const booted = boot();

chrome.runtime.onConnect.addListener((port) => surfaces.accept(port));
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === ASK_COMMAND) void booted.then(() => askFromShortcut(tab));
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
listenToTabs({ ownership, owned, groups, surfaces, translator, links, hidden, booted });

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
    await installationId();
    const [prefs] = await Promise.all([
      restorePrefs(),
      pairing.restore(),
      owned.restore(),
      groups.restore(),
      links.restore(),
      hidden.restore(),
      debuggee.restore(),
    ]);
    if (prefs !== undefined) store.update({ prefs });
    surfaces.schedulePush();
    await refreshShortcut();
  } catch (error) {
    console.warn('[atd] could not restore the last state', error);
  }
  channel.connect();
}

function channelClosed(reason: CloseReason): void {
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

async function askFromShortcut(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const tabId =
    tab?.id ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
  if (tabId === undefined) return;
  await openAsk(tabId, store.state.pairing.state === 'paired', injector, surfaces);
}

/** Chrome sends no event when the person changes a shortcut, so it is read when it may show. */
async function refreshShortcut(): Promise<void> {
  const shortcut = await askShortcut().catch(() => store.state.askShortcut);
  if (shortcut !== store.state.askShortcut) store.update({ askShortcut: shortcut });
}
