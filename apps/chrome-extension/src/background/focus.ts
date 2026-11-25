import type { SendFrame } from './native.ts';
import type { Store } from './store.ts';
import type { Surfaces } from './surfaces.ts';
import { webOrigin } from './urls.ts';

interface Focus {
  tabId: number;
  eligible: boolean;
}

/**
 * `focus.state` (S9): the active tab of the focused Chrome window, and whether the extension's
 * selection bar serves it, so the shell's native selection toolbar yields to the extension only
 * then. Eligible means paired and ready, a top-level http(s) page whose content script is alive,
 * not incognito, and focus not inside a frame (the bar cannot see selections in frames).
 *
 * The state is computed again on every event that can change it (tab activation, window focus,
 * navigation, the content script coming or going, focus moving into or out of a frame, pairing
 * and connection), one computation at a time, and sent only when it differs from what was sent.
 * When no window of this profile has focus (`windows.onFocusChanged` with `WINDOW_ID_NONE`: focus
 * moved to another app or another profile's window), the tab sent last is sent as not eligible:
 * the shell yields its toolbar while any connected profile of the frontmost Chrome last reported
 * `eligible: true`, so a profile the person left must withdraw it. A closed channel forgets what
 * was sent; the next connection first hears the tab reported last as not eligible, then the state
 * anew, so no `eligible: true` outlives a reconnect. Only a paired extension reports: while it is
 * not paired nothing is sent, and once paired again it starts the same way as after a reconnect.
 */
export class FocusState {
  /** Tabs whose top frame reported focus inside a frame (an iframe, embed or object). */
  private readonly inFrame = new Set<number>();
  private sent: Focus | undefined;
  /** The tab reported last on a closed connection, withdrawn first on the next one. */
  private withdraw: number | undefined;
  /** Connection and pairing as last seen, so other store changes do not recompute. */
  private gate = '';
  private dirty = false;
  private running = false;

  /** `send` delivers to the shell once it answered `hello` (it drops the frame otherwise). */
  constructor(
    private readonly store: Store,
    private readonly surfaces: Surfaces,
    private readonly send: SendFrame,
  ) {}

  /** Content `focus {inFrame}`. */
  noteFrame(tabId: number, inFrame: boolean): void {
    if (inFrame === this.inFrame.has(tabId)) return;
    if (inFrame) this.inFrame.add(tabId);
    else this.inFrame.delete(tabId);
    this.schedule();
  }

  /** The tab's content script went away or the tab closed; a new document starts outside frames. */
  contentGone(tabId: number): void {
    this.inFrame.delete(tabId);
    this.schedule();
  }

  /** A store change: recomputes only when the connection or the pairing changed. */
  stateChanged(): void {
    const { connection, pairing } = this.store.state;
    const gate = `${connection}:${pairing.state}`;
    if (gate === this.gate) return;
    this.gate = gate;
    this.schedule();
  }

  /**
   * The channel closed (or the pairing ended): the next connection (or pairing) is told the state
   * again, after a withdrawal.
   */
  reset(): void {
    this.withdraw = this.sent?.tabId ?? this.withdraw;
    this.sent = undefined;
  }

  /** Recomputes soon; calls while a computation runs fold into one more. */
  schedule(): void {
    this.dirty = true;
    if (!this.running) void this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    while (this.dirty) {
      this.dirty = false;
      try {
        await this.update();
      } catch (error) {
        console.warn('[atd] could not report the focused tab', error);
      }
    }
    this.running = false;
  }

  private async update(): Promise<void> {
    if (!this.paired()) return this.reset();
    if (this.withdraw !== undefined) {
      const withdrawn = { tabId: this.withdraw, eligible: false };
      if (!this.deliver(withdrawn)) return;
      this.sent = withdrawn;
      this.withdraw = undefined;
    }
    const next = await this.current();
    if (next === undefined) return;
    if (next.tabId === this.sent?.tabId && next.eligible === this.sent.eligible) return;
    if (this.deliver(next)) this.sent = next;
  }

  private paired(): boolean {
    return this.store.state.pairing.state === 'paired';
  }

  /** Sends `focus` while paired (the pairing may end while the focused tab is looked up). */
  private deliver(focus: Focus): boolean {
    return this.paired() && this.send({ t: 'focus.state', ...focus });
  }

  private async current(): Promise<Focus | undefined> {
    const window = await chrome.windows.getLastFocused().catch(() => undefined);
    if (window?.focused !== true || window.id === undefined)
      return this.sent === undefined ? undefined : { tabId: this.sent.tabId, eligible: false };
    const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    if (tab?.id === undefined) return undefined;
    return { tabId: tab.id, eligible: this.eligible(tab.id, tab) };
  }

  private eligible(tabId: number, tab: chrome.tabs.Tab): boolean {
    return (
      this.store.state.connection === 'ready' &&
      webOrigin(tab.url ?? '') !== undefined &&
      this.surfaces.hasContent(tabId) &&
      !tab.incognito &&
      !this.inFrame.has(tabId)
    );
  }
}
