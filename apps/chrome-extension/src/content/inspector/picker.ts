import { fromOwnLayer, insideOwnLayer } from '../hosts.ts';
import { signal } from '../lifetime.ts';

/**
 * The pointer and click events a picker keeps from the page: the page reacts to none of them while
 * the person points at its elements. The wheel still scrolls it.
 */
const SWALLOWED = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'pointercancel',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'dragstart',
  'selectstart',
] as const;

/**
 * After a pick the page still gets none of these for this long, so the second click of a
 * double-click (or a press that ends after the pick) never reaches the element just picked.
 */
const TRAIL_MS = 500;

export interface PickerEvents {
  /** The pickable element under the pointer changed or moved; null where there is none. */
  hover(element: Element | null): void;
  /** The person clicked `element`: picking is over (the page's clicks stay blocked briefly). */
  picked(element: Element): void;
  /** Esc: picking is over without a pick. */
  canceled(): void;
  /** The picker has let go of the page's events. */
  released(): void;
}

/**
 * The highlight's box, which takes the pointer over an embedded document (an iframe, an embed)
 * while picking: events inside a frame belong to its own document and never pass this window, so
 * the box over it keeps them for the picker instead.
 */
export interface Shield {
  /** Whether `node` is the shield's layer host. */
  hosts(node: unknown): boolean;
}

/**
 * One round of picking an element of the top document. Its listeners are on the window in the
 * capture phase, ahead of the page's own, and exist only from construction to `dispose`; events
 * on Atd's own layers pass untouched, so the composer and the HUD keep working and are never
 * picked, except those on the shield, which are the picker's. Hit testing runs at most once a
 * frame and sees through the shield. An element inside a page's shadow root is picked as its
 * shadow host, which is what the document shows of it.
 */
export class Picker {
  private readonly controller = new AbortController();
  private phase: 'picking' | 'trailing' = 'picking';
  private point: { x: number; y: number } | null = null;
  private hovered: Element | null = null;
  private frame = 0;
  private trail = 0;

  constructor(
    private readonly events: PickerEvents,
    private readonly shield: Shield,
  ) {
    const listening = AbortSignal.any([this.controller.signal, signal]);
    const blocking = { capture: true, passive: false, signal: listening };
    for (const type of SWALLOWED)
      addEventListener(type, (event) => this.intercept(event), blocking);
    addEventListener('keydown', (event) => this.key(event), blocking);
    const following = { capture: true, passive: true, signal: listening };
    addEventListener('scroll', () => this.schedule(), following);
  }

  /** Whether the person is still choosing (not yet in the short trail after a pick). */
  get picking(): boolean {
    return this.phase === 'picking' && !this.controller.signal.aborted;
  }

  /** Lets go of the page's events at once; nothing more is reported. */
  dispose(): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.trail);
    this.hovered = null;
    this.events.released();
  }

  private intercept(event: Event): void {
    const shielded = event.composedPath().some((node) => this.shield.hosts(node));
    if (!shielded && fromOwnLayer(event)) {
      if (event.type === 'pointermove') this.leave();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.phase !== 'picking') return;
    if (event instanceof PointerEvent && event.type === 'pointermove') {
      this.point = { x: event.clientX, y: event.clientY };
      this.schedule();
    } else if (event instanceof PointerEvent && event.type === 'pointerout') {
      // Into an embedded document, or out of the window: what is there now decides.
      if (event.relatedTarget !== null) return;
      this.point = { x: event.clientX, y: event.clientY };
      this.schedule();
    } else if (event instanceof MouseEvent && event.type === 'click' && event.button === 0) {
      // A click a key made on the page (no pointer, `detail` 0) is kept from it but picks nothing.
      if (event.detail > 0) this.pick(event.clientX, event.clientY);
    }
  }

  private key(event: KeyboardEvent): void {
    if (this.phase !== 'picking' || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dispose();
    this.events.canceled();
  }

  private pick(x: number, y: number): void {
    const element = this.hit(x, y);
    if (element === null) return;
    this.phase = 'trailing';
    cancelAnimationFrame(this.frame);
    this.trail = window.setTimeout(() => this.dispose(), TRAIL_MS);
    this.events.picked(element);
  }

  private leave(): void {
    this.point = null;
    if (this.hovered === null) return;
    this.hovered = null;
    this.events.hover(null);
  }

  private schedule(): void {
    if (this.frame !== 0 || this.phase !== 'picking') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.point === null || this.phase !== 'picking') return;
      const element = this.hit(this.point.x, this.point.y);
      if (element === null && this.hovered === null) return;
      this.hovered = element;
      // Also for the same element: it may have moved with the page.
      this.events.hover(element);
    });
  }

  /** The topmost pickable element at a point, looking through the shield; none over the HUD. */
  private hit(x: number, y: number): Element | null {
    for (const element of document.elementsFromPoint(x, y)) {
      if (!this.shield.hosts(element)) return pickable(element);
    }
    return null;
  }
}

/** The page's own elements, short of the whole page itself; never one of Atd's layers. */
function pickable(element: Element | null): Element | null {
  if (element === null || element === document.documentElement || element === document.body) {
    return null;
  }
  return insideOwnLayer(element) ? null : element;
}
