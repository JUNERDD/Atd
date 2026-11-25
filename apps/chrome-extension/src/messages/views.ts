import type { ChromePrefs, PointerPhase, RunView } from '../channel/payloads.ts';

/**
 * The state the service worker projects for the extension's own surfaces. The background owns the
 * channel and every Chrome API side effect; the content script and the popup render these views
 * and send intents back (`content.ts`, `popup.ts`). This file has only type imports, so the
 * content script may import it without bundling TypeBox or the contracts.
 */

/**
 * The native channel as the surfaces see it. `ready`: Atd answered and its service runs.
 * `otherHost`: another Atd build owns the channel. `serviceUnavailable`: the shell runs but its
 * service does not answer. `hostMissing`: the browser finds no usable native host for this flavor
 * (Atd is not installed, has not set up this browser, or rejected the extension origin).
 * `browserNotVerified`: Atd rejected the browser because it lacks a valid Apple Developer ID
 * signature. `browserMismatch`: Atd rejected a paired connection because the browser's signature
 * no longer matches the paired browser. `disconnected`: the host exited or the connection broke;
 * the background reconnects with backoff.
 */
export type Connection =
  | 'connecting'
  | 'ready'
  | 'otherHost'
  | 'serviceUnavailable'
  | 'hostMissing'
  | 'browserNotVerified'
  | 'browserMismatch'
  | 'disconnected';

/**
 * Why pairing did not complete: the shell's `pair.state` reason codes, `notConnected` when the
 * channel dropped meanwhile, and `unknown` for any code this version does not know. The popup
 * shows localized copy for each, never the code.
 */
export const PAIR_FAILURES = [
  'busy',
  'cooldown',
  'unavailable',
  'failed',
  'otherHost',
  'serviceUnavailable',
  'denied',
  'notConnected',
  'unknown',
] as const;
export type PairFailure = (typeof PAIR_FAILURES)[number];

/**
 * Pairing with Atd. `pending` carries the 4-character code the person compares with the one in
 * Atd's confirmation; `denied`/`error` return to Connect… with the reason.
 */
export interface PairingView {
  state: 'unpaired' | 'pending' | 'paired' | 'denied' | 'error';
  code?: string;
  /** Atd's label for this pairing once paired (browser name or profile email). */
  label?: string;
  reason?: PairFailure;
}

/**
 * Why an in-page ask failed, as a code the HUD shows localized copy for: the shell's `ask.failed`
 * codes (`otherHost`, `serviceUnavailable`, anything else → `failed`), or the background's own
 * refusals (`notConnected`, `notPaired`, `tooLong`: the text exceeds what Atd accepts).
 */
export type AskFailure =
  | 'notConnected'
  | 'notPaired'
  | 'tooLong'
  | 'otherHost'
  | 'serviceUnavailable'
  | 'failed';

/** This tab's site and whether the person allowed Atd to act there (popup switch, D6). */
export interface SiteView {
  origin: string;
  host: string;
  allowed: boolean;
}

/**
 * Everything one tab's content script renders. `run` is the run owning this tab (the latest one),
 * kept with status `disconnected` while the channel is down so the HUD shows the last known state
 * without claiming progress. `busy` means a run is active somewhere in this browser, which keeps
 * the in-page ask closed (one request per browser at a time).
 */
export interface TabView {
  tabId: number;
  connection: Connection;
  paired: boolean;
  prefs: ChromePrefs;
  run: RunView | null;
  busy: boolean;
  site: SiteView | null;
}

/** The live pointer for this tab, in CSS px of its viewport (the `pointer` frame minus routing). */
export interface PointerView {
  phase: Exclude<PointerPhase, 'cleared'>;
  /** The step kind in progress (`ComputerStepKind`), or '' when the host reports none. */
  label: string;
  rect?: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
}

/** Everything the toolbar popup renders. The popup reads the active tab itself. */
export interface PopupView {
  connection: Connection;
  pairing: PairingView;
  /** The browser name shown before pairing (shell-verified from `welcome`, else `browserLabel`). */
  profileLabel: string;
  prefs: ChromePrefs;
  /** Runs tied to this Chrome; active ones become `disconnected` while the channel is down. */
  runs: RunView[];
  /** Origins the person allowed (popup switches). */
  sites: string[];
  /** The ask command's shortcut as Chrome shows it (e.g. `⇧⌘K`), '' when unassigned. */
  askShortcut: string;
}

/** Runs the HUD and popup treat as in progress. */
export const ACTIVE_RUN_STATUSES: readonly RunView['status'][] = [
  'working',
  'attention',
  'held',
  'stopping',
  'disconnected',
];

/**
 * Runs that have ended: their HUD offers Dismiss, and once it left a tab (dismissed, or hidden on
 * its own) it stays away from that tab until the run is live again.
 */
export const ENDED_RUN_STATUSES: readonly RunView['status'][] = ['done', 'stopped', 'failed'];
