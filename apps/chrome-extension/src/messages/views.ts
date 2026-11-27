import type { ChromePrefs, PointerPhase, RunResult, RunView } from '../channel/payloads.ts';
import type { RichBlock } from '../rich-text/tree.ts';
import type { ExtensionSettings } from './settings.ts';

/**
 * The state the service worker projects for the extension's own surfaces. The background owns the
 * channel and every Chrome API side effect; the content script and the panel render these views
 * and send intents back (`content.ts`, `panel.ts`). This file has only type imports, so the
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
 * channel dropped meanwhile, and `unknown` for any code this version does not know. The panel
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
 * Why an ask failed, as a code the surface that asked (the in-page ask or the panel's composer)
 * shows localized copy for: the shell's `ask.failed` codes (`otherHost`, `serviceUnavailable`,
 * anything else → `failed`), or the background's own refusals (`notConnected`, `notPaired`,
 * `tooLong`: the text exceeds what Atd accepts).
 */
export type AskFailure =
  | 'notConnected'
  | 'notPaired'
  | 'tooLong'
  | 'otherHost'
  | 'serviceUnavailable'
  | 'failed';

/**
 * Atd's answer to an ask, posted to the surface that sent it: Atd took it (`taskId`/`runId` name
 * the run it started) or refused it (`reason`).
 */
export interface AskStatus {
  type: 'ask.status';
  requestId: string;
  state: 'accepted' | 'failed';
  reason?: AskFailure;
  taskId?: string;
  runId?: string;
}

/**
 * A run's reply as the surfaces show it: `text` is the Markdown as Atd sent it (what Copy copies),
 * `clipped` whether the shell clipped it, `state` whether the run is still writing it
 * (`RunResultSchema`), and `blocks` the tree the HUD and the panel render, which the service
 * worker parses (`rich-text/parse.ts`) so neither surface carries a parser.
 */
export interface ReplyView extends RunResult {
  blocks: RichBlock[];
}

/** Whether `reply` is a live message of a run still under way, not its answer. */
export function isLive(reply: Pick<RunResult, 'state'>): boolean {
  return reply.state !== undefined;
}

/** A run as the surfaces get it: the shell's `RunView`, its reply ready to render. */
export type SurfaceRun = Omit<RunView, 'result'> & { result?: ReplyView };

/** This tab's site and whether the person allowed Atd to act there (the panel's switch, D6). */
export interface SiteView {
  origin: string;
  host: string;
  allowed: boolean;
}

/**
 * Where Atd's panel opens from a surface's own control (the in-page ask's Open side panel):
 * Chrome's side panel, or the toolbar popup where a browser has no side panel API.
 */
export type PanelSurface = 'sidePanel' | 'popup';

/**
 * Everything one tab's content script renders. `run` is the run owning this tab (the latest one),
 * kept with status `disconnected` while the channel is down so the HUD shows the last known state
 * without claiming progress. `busy` means a run is active somewhere in this browser, which keeps
 * the in-page ask from sending (one request per browser at a time). `panel` is where Atd's panel
 * opens from the in-page ask, or null where the browser can open it from neither.
 */
export interface TabView {
  tabId: number;
  connection: Connection;
  paired: boolean;
  prefs: ChromePrefs;
  run: SurfaceRun | null;
  busy: boolean;
  site: SiteView | null;
  panel: PanelSurface | null;
}

/** The live pointer for this tab, in CSS px of its viewport (the `pointer` frame minus routing). */
export interface PointerView {
  phase: Exclude<PointerPhase, 'cleared'>;
  /** The step kind in progress (`ComputerStepKind`), or '' when the host reports none. */
  label: string;
  rect?: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
}

/**
 * Everything the panel renders (Chrome's side panel, or the toolbar popup where a browser has no
 * side panel). The panel follows its window's active tab itself.
 */
export interface PanelView {
  connection: Connection;
  pairing: PairingView;
  /** The browser name shown before pairing (shell-verified from `welcome`, else `browserLabel`). */
  profileLabel: string;
  prefs: ChromePrefs;
  /** Runs tied to this Chrome; active ones become `disconnected` while the channel is down. */
  runs: SurfaceRun[];
  /** Origins the person allowed (the panel's site switch). */
  sites: string[];
  /** The ask command's shortcut as Chrome shows it (e.g. `⇧⌘K`), '' when unassigned. */
  askShortcut: string;
}

/**
 * One of the extension's commands as `chrome.commands.getAll` reports it, in Chrome's order:
 * the manifest's (`ask-on-page`) and the one Chrome adds for the toolbar button
 * (`_execute_action`), which does what a click does.
 */
export interface ShortcutView {
  name: string;
  /** As Chrome shows it (e.g. `⇧⌘K`), '' when unassigned. */
  shortcut: string;
  /** The manifest's description in Chrome's language, '' for `_execute_action`. */
  description: string;
}

/**
 * Everything the options page renders: the extension's own settings, the command shortcuts
 * (changed only on Chrome's shortcut page), the websites the person allowed (D6), and the
 * connection to Atd, whose language the page follows (D13).
 */
export interface OptionsView {
  connection: Connection;
  pairing: PairingView;
  /** The browser name shown before pairing (as in `PanelView`). */
  profileLabel: string;
  prefs: ChromePrefs;
  settings: ExtensionSettings;
  /** Origins the person allowed, as in `PanelView`. */
  sites: string[];
  shortcuts: ShortcutView[];
  /**
   * Where the panel opens in this browser: the toolbar choice exists only with Chrome's side panel
   * (`sidePanel`); with the popup, or nowhere, a click always opens the popup.
   */
  panel: PanelSurface | null;
}

/** Runs the HUD and the panel treat as in progress. */
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

/**
 * Whether the person can reply to `run`'s conversation (its task): this extension started it and
 * it has ended, as Atd takes one run per task at a time. A reply is the task's next run, so the
 * agent continues with everything said so far.
 */
export function canReply(run: Pick<RunView, 'fromExtension' | 'status'>): boolean {
  return run.fromExtension && ENDED_RUN_STATUSES.includes(run.status);
}

/**
 * What one turn of a conversation is called: the person's own request for it (`prompt`), else,
 * for a run Atd started, its task's title.
 */
export function turnTitle(run: Pick<RunView, 'prompt' | 'title'>): string {
  return run.prompt?.trim() || run.title;
}
