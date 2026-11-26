import type { ContentMessage } from '../messages/content.ts';
import type { ContentReply } from './surfaces.ts';
import type { TransitionGate } from './transition-gate.ts';

type CaptureIntent = Extract<ContentMessage, { type: 'transition.capture' }>;

export interface TransitionCaptureDeps {
  gate: TransitionGate;
  /**
   * Whether a run is in the tab: its HUD shows one (`shownRun`), or Atd accepted the person's ask
   * with its page there and the run is on its way (`RunLinks.starting`). Only such a tab plays a
   * transition.
   */
  engaged(tabId: number): boolean;
}

/**
 * Chrome refuses more than `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` calls a second per
 * extension. Calls are counted over a sliding window, a little longer than Chrome's, because a
 * slot is taken when the request arrives and Chrome counts the call a moment later.
 */
const CAPTURE_WINDOW_MS = 1050;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

/**
 * The frames page transitions play over (`content/transition/`): `chrome.tabs.captureVisibleTab`
 * of the asking tab, as JPEG. A tab gets only its own pixels: it is captured only while it is the
 * active tab of its window, checked before the capture and again after it (a tab switched away
 * meanwhile gets nothing), and the frame goes back only to the document that asked. Only a tab a
 * run is in may ask (the frame can hold cross-origin frames' pixels, which its own renderer
 * otherwise never sees). The `<all_urls>` host permission is what lets the extension capture;
 * pages no content script runs on (chrome://, the Web Store) never ask.
 *
 * The takeover's request also holds the agent's screenshots and input to the tab (`hold`) from
 * the moment it arrives until the content script ends the transition (`end`); a capture that fails
 * releases its hold at once.
 */
export class TransitionCaptures {
  /** When the calls inside the current window were made (`performance.now()`). */
  private calls: number[] = [];

  constructor(private readonly deps: TransitionCaptureDeps) {}

  capture(tabId: number, intent: CaptureIntent, reply: ContentReply): void {
    const { requestId, hold } = intent;
    if (!this.deps.engaged(tabId) || !this.takeSlot()) {
      reply({ type: 'transition.frame', requestId, jpeg: null });
      return;
    }
    if (hold) this.deps.gate.hold(tabId, requestId);
    void captureTab(tabId).then((jpeg) => {
      const delivered = reply({ type: 'transition.frame', requestId, jpeg });
      if (hold && (jpeg === null || !delivered)) this.deps.gate.release(tabId, requestId);
    });
  }

  end(tabId: number, requestId: string): void {
    this.deps.gate.release(tabId, requestId);
  }

  private takeSlot(): boolean {
    const now = performance.now();
    this.calls = this.calls.filter((at) => now - at < CAPTURE_WINDOW_MS);
    if (this.calls.length >= chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) return false;
    this.calls.push(now);
    return true;
  }
}

/** The tab's visible area as base64 JPEG, or null when it is not (or stopped being) on show. */
async function captureTab(tabId: number): Promise<string | null> {
  try {
    const before = await chrome.tabs.get(tabId);
    if (!before.active) return null;
    const url = await chrome.tabs.captureVisibleTab(before.windowId, {
      format: 'jpeg',
      quality: 92,
    });
    // `captureVisibleTab` takes whatever its window shows: never hand this tab another one's.
    const after = await chrome.tabs.get(tabId);
    if (!after.active || after.windowId !== before.windowId) return null;
    return url.startsWith(JPEG_PREFIX) ? url.slice(JPEG_PREFIX.length) : null;
  } catch (error) {
    console.info('[atd] could not capture a tab for its transition', error);
    return null;
  }
}
