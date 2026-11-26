import type { RunView } from '../channel/payloads.ts';
import { ACTIVE_RUN_STATUSES, type PanelView, type SurfaceRun } from '../messages/views.ts';

/**
 * What the panel shows for a background `PanelView`, kept apart from rendering so every state rule
 * (decision 10 of the spec, the prototype's `popupMain` / `popupConnect`) has one owner.
 */

/**
 * The tab the panel's window shows. Only http(s) pages are a page Atd can act on ("This Page", the
 * composer's page chip); a request sent from any other tab goes without its page. `tabId` is null
 * only when the window shows no tab the panel can read.
 */
export type ActivePage =
  | { kind: 'loading' }
  | { kind: 'web'; tabId: number; origin: string; host: string }
  | { kind: 'other'; tabId: number | null };

/**
 * States where the panel can only explain and offer a retry. `connecting` and `disconnected` are
 * notices only before pairing: a paired panel keeps its runs and page in view while the background
 * reconnects, so backoff attempts do not swap the whole layout.
 */
export type NoticeKind =
  | 'connecting'
  | 'disconnected'
  | 'otherHost'
  | 'serviceUnavailable'
  | 'hostMissing'
  | 'browserNotVerified'
  | 'browserMismatch';

export type Screen =
  | { kind: 'notice'; notice: NoticeKind }
  | { kind: 'connect' }
  | { kind: 'main' };

export function screenFor(view: PanelView): Screen {
  const paired = view.pairing.state === 'paired';
  switch (view.connection) {
    case 'otherHost':
    case 'serviceUnavailable':
    case 'hostMissing':
    case 'browserNotVerified':
    case 'browserMismatch':
      return { kind: 'notice', notice: view.connection };
    case 'connecting':
    case 'disconnected':
      return paired ? { kind: 'main' } : { kind: 'notice', notice: view.connection };
    case 'ready':
      return paired ? { kind: 'main' } : { kind: 'connect' };
  }
}

/**
 * Whether the paired panel can reach Atd. A run the shell reports as `disconnected` means its
 * progress is unconfirmed even when the channel itself answers, so it counts as lost too.
 */
export type Reach = 'ready' | 'connecting' | 'lost';

export function reachOf(view: PanelView): Reach {
  if (view.connection === 'connecting') return 'connecting';
  if (view.connection !== 'ready') return 'lost';
  return view.runs.some((run) => run.status === 'disconnected') ? 'lost' : 'ready';
}

/** The header's status line. */
export type LinkStatus = 'connected' | 'connecting' | 'notConnected';

export function linkStatus(view: PanelView): LinkStatus {
  if (view.connection === 'connecting') return 'connecting';
  return view.pairing.state === 'paired' && reachOf(view) === 'ready'
    ? 'connected'
    : 'notConnected';
}

/**
 * Open Atd and Computer Use Settings travel over the channel to the shell, which still answers
 * while only its service is down.
 */
export function shellAnswers(view: PanelView): boolean {
  return view.connection === 'ready' || view.connection === 'serviceUnavailable';
}

export function isActiveRun(run: RunView): boolean {
  return ACTIVE_RUN_STATUSES.includes(run.status);
}

/**
 * Why nothing in the panel can reach Atd now: the composer and the site switch both travel over
 * the channel of a paired Chrome. Null when they can. A missing host reads as not connected; its
 * notice already says how to finish setup.
 */
export type ChannelBlock =
  | 'notPaired'
  | 'connecting'
  | 'notConnected'
  | 'otherHost'
  | 'serviceUnavailable';

export function channelBlock(view: PanelView): ChannelBlock | null {
  if (view.pairing.state !== 'paired') return 'notPaired';
  switch (view.connection) {
    case 'ready':
      return null;
    case 'connecting':
      return 'connecting';
    case 'disconnected':
    case 'hostMissing':
    case 'browserNotVerified':
    case 'browserMismatch':
      return 'notConnected';
    case 'otherHost':
    case 'serviceUnavailable':
      return view.connection;
  }
}

/**
 * This website's permission (D6), offered in the More menu while the paired panel's window shows
 * a website: whether Atd may act on it in tasks the person starts, and why that cannot change now.
 */
export interface SiteState {
  origin: string;
  host: string;
  allowed: boolean;
  block: ChannelBlock | null;
}

export function siteOf(view: PanelView, page: ActivePage): SiteState | null {
  if (page.kind !== 'web' || screenFor(view).kind !== 'main') return null;
  return {
    origin: page.origin,
    host: page.host,
    allowed: view.sites.includes(page.origin),
    block: channelBlock(view),
  };
}

/**
 * Why the composer cannot send now, or null when it can. Atd must be reachable (a run the shell
 * reports as lost counts as unreachable), the window must show a tab to send from, and one request
 * runs per browser at a time. Any tab will do: from one that is no website, the request goes
 * without its page.
 */
export type ComposeBlock = ChannelBlock | 'page' | 'busy';

export function composeBlock(view: PanelView, page: ActivePage): ComposeBlock | null {
  const channel = channelBlock(view);
  if (channel) return channel;
  if (reachOf(view) === 'lost') return 'notConnected';
  if (page.kind === 'loading' || page.tabId === null) return 'page';
  return view.runs.some(isActiveRun) ? 'busy' : null;
}

/**
 * A run row's trailing control. A stop cannot reach Atd while it is unreachable, so the row offers
 * the step that can; finished runs and runs already stopping offer nothing.
 */
export type RunControl = 'stop' | 'reconnect' | 'none';

export function runControl(run: RunView, reach: Reach): RunControl {
  if (!isActiveRun(run)) return 'none';
  if (reach !== 'ready' || run.status === 'disconnected') return 'reconnect';
  return run.status === 'stopping' ? 'none' : 'stop';
}

/** Where pressing a run row goes: its tab, else the task in Atd, else nowhere. */
export type RunTarget = { kind: 'tab'; tabId: number } | { kind: 'app' } | null;

export function runTarget(run: RunView, reach: Reach): RunTarget {
  const tabId = run.focusTabId ?? run.tabs[0];
  if (tabId !== undefined) return { kind: 'tab', tabId };
  return reach === 'ready' ? { kind: 'app' } : null;
}

/** Runs that wait for the person (an approval, an answer, or a tab they took over). */
export function runNeedsPerson(run: RunView): boolean {
  return run.status === 'attention' || run.status === 'held';
}

/** Atd's reply to a request from this extension, shown under its run once it is done. */
export function runReply(run: SurfaceRun): SurfaceRun['result'] {
  return run.status === 'done' && run.fromExtension ? run.result : undefined;
}

/** The page behind a tab URL; anything but http(s) is not a website Atd can act on. */
export function pageOf(tab: chrome.tabs.Tab | undefined): ActivePage {
  const tabId = tab?.id !== undefined && tab.id >= 0 ? tab.id : null;
  const raw = tab?.url || tab?.pendingUrl;
  if (tabId === null || !raw || !URL.canParse(raw)) return { kind: 'other', tabId };
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'other', tabId };
  return { kind: 'web', tabId, origin: url.origin, host: url.host };
}
