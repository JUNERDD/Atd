/** A card stays in place this long before its answers count, as Chrome's own prompts wait. */
const SETTLE_MS = 500;
/** The visibility check's interval; IntersectionObserver v2 requires at least 100 ms. */
const CHECK_DELAY_MS = 100;

/**
 * IntersectionObserver v2's options, which TypeScript's DOM library does not describe yet:
 * `trackVisibility` asks the browser whether the target is unoccluded and undistorted (no opacity,
 * filter, blending or non-translation transform on it or its ancestors), reported as `isVisible`.
 */
interface VisibilityInit extends IntersectionObserverInit {
  trackVisibility: boolean;
  delay: number;
}

/**
 * Without IntersectionObserver v2 the HUD cannot know that a page is not covering or disguising
 * its card, so its answers are refused (fail closed): the request is answered in Atd instead.
 */
const SUPPORTED =
  typeof IntersectionObserverEntry !== 'undefined' &&
  'isVisible' in IntersectionObserverEntry.prototype;

/** Whether a click on a guarded control may act: yes, not yet (it just moved), or not here. */
export type GuardVerdict = 'allowed' | 'settling' | 'covered';

/**
 * Keeps clicks on the HUD's run-affecting card controls (Allow once, Don't allow, an input's
 * options) from being tricked: a click counts only while the browser reports the card fully
 * visible (IntersectionObserver v2: nothing of the page over it, nothing applied to the page's
 * root or the HUD's host that could disguise it), and not while the card or its answers are still
 * moving (a drag, a snap, its glass morphing, its content arriving) nor within 500 ms of it
 * appearing, moving or changing size.
 *
 * While a click would wait, the capsule carries `data-settling` and its guarded controls look
 * inactive, so a click that does nothing is not a surprise.
 *
 * The observed target is `sentinel`: a transparent box the HUD's layer keeps exactly over the
 * capsule, above it and with no effects of its own. The capsule itself cannot be the target
 * because its glass is a backdrop filter, which the browser counts as a distortion of everything
 * inside it; the sentinel shares every ancestor a page could affect, and any page content over
 * the capsule covers it too.
 */
export class ClickGuard {
  private observer: IntersectionObserver | null = null;
  private identity: string | null = null;
  private visible = false;
  private appearedAt = 0;
  private movedAt = 0;
  private rect: DOMRect | null = null;
  private settleTimer = 0;

  /**
   * `frame` spans the layer (the sentinel's containing block), so the sentinel can be placed;
   * `moving` says whether the capsule or what it shows is still on its way somewhere.
   */
  constructor(
    private readonly capsule: HTMLElement,
    private readonly frame: HTMLElement,
    private readonly sentinel: HTMLElement,
    private readonly moving: () => boolean,
  ) {}

  /**
   * The capsule shows guarded controls for `identity` (a request and its revision), or none for
   * `null`. A new identity counts as a new card appearing; the same one re-rendered does not.
   */
  present(identity: string | null): void {
    if (identity === this.identity) return;
    this.identity = identity;
    if (identity === null) return this.stop();
    this.appearedAt = performance.now();
    this.sentinel.hidden = false;
    this.touch();
    this.markSettling();
    if (!SUPPORTED || this.observer) return;
    const init: VisibilityInit = { trackVisibility: true, delay: CHECK_DELAY_MS, threshold: 0 };
    this.observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) this.visible = 'isVisible' in entry && entry.isVisible === true;
    }, init);
    this.observer.observe(this.sentinel);
  }

  /** The capsule may have moved or changed size: the sentinel follows, and the wait starts again. */
  touch(): void {
    if (this.identity === null) return;
    const rect = this.capsule.getBoundingClientRect();
    const last = this.rect;
    if (last && sameBox(last, rect)) return;
    this.rect = rect;
    this.movedAt = performance.now();
    const frame = this.frame.getBoundingClientRect();
    const style = this.sentinel.style;
    style.setProperty('left', `${rect.left - frame.left}px`);
    style.setProperty('top', `${rect.top - frame.top}px`);
    style.setProperty('width', `${rect.width}px`);
    style.setProperty('height', `${rect.height}px`);
    this.markSettling();
  }

  /** Whether a click on a guarded control may act now, and if not, why. */
  verdict(): GuardVerdict {
    if (this.identity === null || this.settling()) return 'settling';
    return SUPPORTED && this.visible ? 'allowed' : 'covered';
  }

  private settling(): boolean {
    const now = performance.now();
    // Motion moves the card or its answers under the pointer: wait for them to come to rest.
    return this.moving() || now - this.appearedAt < SETTLE_MS || now - this.movedAt < SETTLE_MS;
  }

  /** Shows the wait on the capsule (`data-settling`) and looks again once it may be over. */
  private markSettling(): void {
    clearTimeout(this.settleTimer);
    const settling = this.identity !== null && this.settling();
    this.capsule.toggleAttribute('data-settling', settling);
    if (!settling) return;
    const rest = Math.max(this.appearedAt, this.movedAt) + SETTLE_MS - performance.now();
    this.settleTimer = window.setTimeout(() => this.markSettling(), Math.max(rest, CHECK_DELAY_MS));
  }

  private stop(): void {
    clearTimeout(this.settleTimer);
    this.capsule.removeAttribute('data-settling');
    this.observer?.disconnect();
    this.observer = null;
    this.visible = false;
    this.rect = null;
    this.sentinel.hidden = true;
  }
}

function sameBox(a: DOMRect, b: DOMRect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}
