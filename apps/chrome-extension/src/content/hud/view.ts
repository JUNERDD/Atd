import askCss from '../ask/ask.css?inline';
import { focusedAct, h, refocus } from '../dom.ts';
import { Layer, sheet } from '../hosts.ts';
import { reducedMotion } from '../motion.ts';
import { wireDrag } from './drag.ts';
import { ClickGuard } from './guard.ts';
import hudCss from './hud.css?inline';
import { HudMover } from './mover.ts';
import { isArrow } from './position.ts';
import { signal } from '../lifetime.ts';

/** What the capsule shows: one run state, or the composer. */
export interface HudContent {
  node: HTMLElement;
  shape: 'row' | 'card' | 'compose';
  /** The composer is a dialog; run states are a polite live status. */
  role: 'dialog' | 'status';
  label: string;
  /** Equal keys mean equal content: the capsule is left alone (and keeps its focus). */
  key: string;
  /** The request whose answers the content offers (`ClickGuard`), or null. */
  guarded: string | null;
}

const EASE_OUT = 'cubic-bezier(.22,.9,.3,1)';
const MOVE_SHORTCUTS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  .map((key) => `Control+Alt+Meta+${key}`)
  .join(' ');

/**
 * The HUD's layer and capsule. It swaps content in place with a measured resize, enters rising
 * from its anchor's edge and leaves with a fade (fades only under Reduce Motion), and moves on
 * ⌃⌥⌘ + arrows anywhere in the tab (⌥⌘ + arrows switch Chrome's tabs, ⌃⌥ + arrows belong to common
 * window managers) or plain arrows while focus is on one of its buttons. Its layer is in the page
 * only while the capsule shows (and through its exit).
 */
export class HudView {
  readonly layer: Layer;
  readonly capsule: HTMLDivElement;
  readonly mover: HudMover;
  readonly guard: ClickGuard;
  private readonly inner: HTMLDivElement;
  private readonly moved: () => void;
  private current: HudContent | null = null;
  private shown = false;

  /** `moved` follows every change of the capsule's place or size (the light's bloom follows it). */
  constructor(moved: () => void) {
    this.layer = new Layer('atd-hud', [sheet(hudCss), sheet(askCss)]);
    this.inner = h('div', { class: 'hud-in' });
    this.capsule = h('div', { class: 'hud glass', attrs: { hidden: true } }, this.inner);
    const wrap = h('div', { class: 'wrap' }, this.capsule);
    const sentinel = h('div', {
      class: 'hud-guard',
      attrs: { hidden: true, 'aria-hidden': 'true' },
    });
    this.layer.root.append(wrap, sentinel);
    this.guard = new ClickGuard(this.capsule, wrap, sentinel);
    this.moved = () => {
      this.guard.touch();
      moved();
    };
    this.mover = new HudMover(wrap, this.capsule, this.moved);
    this.capsule.setAttribute('aria-keyshortcuts', MOVE_SHORTCUTS);
    wireDrag(this.capsule, this.mover, this.moved);
    addEventListener('resize', () => this.guard.touch(), { signal });
    this.capsule.addEventListener('keydown', (event) => {
      const onButton = event.target instanceof HTMLButtonElement;
      const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (onButton && plain && isArrow(event.key)) {
        event.preventDefault();
        this.mover.step(event.key);
      }
    });
    // Keys pressed on the HUD are Atd's: a page's own shortcuts must not see them.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.capsule.addEventListener(type, (event) => event.stopPropagation());
    }
    addEventListener(
      'keydown',
      (event) => {
        if (!this.shown || !isArrow(event.key) || event.shiftKey) return;
        if (!(event.ctrlKey && event.altKey && event.metaKey)) return;
        event.preventDefault();
        event.stopPropagation();
        this.mover.step(event.key);
      },
      { capture: true, signal },
    );
  }

  get visible(): boolean {
    return this.shown;
  }

  /**
   * Whether `event` happened on the capsule (for outside-click handling). From the page's side a
   * closed shadow root shows only its host, and the host passes the pointer through everywhere but
   * the capsule, so the host in the path means the capsule was hit.
   */
  contains(event: Event): boolean {
    const host = this.layer.element;
    return host !== null && event.composedPath().includes(host);
  }

  /** Shows `content`, or hides the capsule for `null`; `rebuilt` content replaces even an equal key. */
  show(content: HudContent | null, rebuilt = false): void {
    if (!content) return this.hide();
    const same = this.current?.key === content.key && this.current.label === content.label;
    if (this.shown && same && !rebuilt) {
      this.guard.present(content.guarded);
      return;
    }
    this.layer.mount();
    const before = this.shown ? this.capsule.getBoundingClientRect() : null;
    const focused = focusedAct(this.layer.activeElement);
    const swapped = this.current?.shape === 'compose' || content.shape === 'compose';
    const changedShape = this.current !== null && this.current.shape !== content.shape;
    if (this.current?.node !== content.node) this.inner.replaceChildren(content.node);
    this.current = content;
    this.capsule.classList.toggle('card', content.shape !== 'row');
    this.capsule.classList.toggle('compose', content.shape === 'compose');
    this.capsule.setAttribute('role', content.role);
    this.capsule.setAttribute('aria-label', content.label);
    if (content.role === 'status') this.capsule.setAttribute('aria-live', 'polite');
    else this.capsule.removeAttribute('aria-live');
    this.capsule.hidden = false;
    refocus(this.inner, focused);
    const reduce = reducedMotion();
    this.guard.present(content.guarded);
    if (!this.shown) {
      this.shown = true;
      const rise = this.mover.anchor.v === 'top' ? -6 : 6;
      const entry = this.capsule.animate(
        reduce
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: `translateY(${rise}px) scale(.97)` },
              { opacity: 1, transform: 'none' },
            ],
        { duration: reduce ? 150 : 260, easing: EASE_OUT },
      );
      entry.onfinish = () => this.guard.touch();
    } else if (before && !reduce) {
      if (swapped && changedShape) {
        this.inner.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
      }
      this.animateResize(before);
    }
    this.moved();
  }

  private animateResize(before: DOMRect): void {
    const after = this.capsule.getBoundingClientRect();
    if (Math.abs(after.width - before.width) <= 1 && Math.abs(after.height - before.height) <= 1) {
      return;
    }
    const resize = this.capsule.animate(
      [
        { width: `${before.width}px`, height: `${before.height}px` },
        { width: `${after.width}px`, height: `${after.height}px` },
      ],
      { duration: 260, easing: EASE_OUT },
    );
    resize.onfinish = () => this.guard.touch();
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.current = null;
    this.guard.present(null);
    const reduce = reducedMotion();
    const fade = this.capsule.animate(
      reduce
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0, transform: 'scale(.97)' },
          ],
      { duration: reduce ? 150 : 200, easing: 'ease' },
    );
    fade.onfinish = () => {
      if (this.shown) return;
      this.capsule.hidden = true;
      this.inner.replaceChildren();
      this.layer.unmount();
    };
    this.moved();
  }

  /** The capsule's centre in viewport px while shown; else where it would appear. */
  center(): [number, number] {
    if (this.shown) {
      const rect = this.capsule.getBoundingClientRect();
      return [rect.left + rect.width / 2, rect.top + rect.height / 2];
    }
    const { v, h: horizontal } = this.mover.anchor;
    const x =
      horizontal === 'left' ? 136 : horizontal === 'right' ? innerWidth - 136 : innerWidth / 2;
    return [x, v === 'top' ? 44 : innerHeight - 44];
  }

  /** Glow effects off also stills the step text's shimmer. */
  setEffects(on: boolean): void {
    this.layer.root.dataset.effects = on ? 'on' : 'off';
  }
}
