import askCss from '../ask/ask.css?inline';
import { focusedAct, h, refocus } from '../dom.ts';
import { Layer, sheet } from '../hosts.ts';
import { wireDrag } from './drag.ts';
import { ClickGuard } from './guard.ts';
import hudCss from './hud.css?inline';
import type { AnchorPoint } from './morph.ts';
import { HudMover } from './mover.ts';
import { isArrow } from './position.ts';
import { IslandStage, type StageContent } from './stage.ts';
import { signal } from '../lifetime.ts';

/** What the capsule shows: one run state, or the composer. */
export interface HudContent extends StageContent {
  /** The composer is a dialog; run states are a polite live status. */
  role: 'dialog' | 'status';
  label: string;
  /** Equal keys mean equal content: the capsule is left alone (and keeps its focus). */
  key: string;
  /** The request whose answers the content offers (`ClickGuard`), or null. */
  guarded: string | null;
}

const MOVE_SHORTCUTS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  .map((key) => `Control+Alt+Meta+${key}`)
  .join(' ');

/**
 * The HUD's layer and capsule. Its glass and content move as the command island's do
 * (`stage.ts`): it opens out of a pill at its anchor's edge, morphs between states, changes a state
 * in place, and leaves shrinking toward its anchor (fades only under Reduce Motion). It moves on
 * ⌃⌥⌘ + arrows anywhere in the tab (⌥⌘ + arrows switch Chrome's tabs, ⌃⌥ + arrows belong to common
 * window managers) or plain arrows while focus is on one of its buttons. Its layer is in the page
 * only while the capsule shows (and through its exit).
 */
export class HudView {
  readonly layer: Layer;
  readonly capsule: HTMLDivElement;
  readonly mover: HudMover;
  readonly guard: ClickGuard;
  private readonly stage: IslandStage;
  private readonly moved: () => void;
  private current: HudContent | null = null;
  private shown = false;

  /** `moved` follows every change of the capsule's place or size (the light follows it). */
  constructor(moved: () => void) {
    this.layer = new Layer('atd-hud', [sheet(hudCss), sheet(askCss)]);
    this.capsule = h('div', { class: 'hud', attrs: { hidden: true } });
    const wrap = h('div', { class: 'wrap' }, this.capsule);
    const sentinel = h('div', {
      class: 'hud-guard',
      attrs: { hidden: true, 'aria-hidden': 'true' },
    });
    this.layer.root.append(wrap, sentinel);
    this.moved = () => {
      this.guard.touch();
      moved();
    };
    this.stage = new IslandStage(this.capsule, () => this.anchorPoint(), {
      settled: () => this.moved(),
      gone: () => {
        if (this.shown) return;
        this.capsule.hidden = true;
        this.layer.unmount();
      },
    });
    this.guard = new ClickGuard(this.capsule, wrap, sentinel, () => this.moving());
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
    const focused = focusedAct(this.layer.activeElement);
    this.current = content;
    this.shown = true;
    this.capsule.setAttribute('role', content.role);
    this.capsule.setAttribute('aria-label', content.label);
    if (content.role === 'status') this.capsule.setAttribute('aria-live', 'polite');
    else this.capsule.removeAttribute('aria-live');
    this.capsule.hidden = false;
    this.stage.present(content);
    refocus(content.node, focused);
    this.guard.present(content.guarded);
    this.moved();
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.current = null;
    this.guard.present(null);
    this.stage.dismiss();
    this.moved();
  }

  /**
   * Whether the capsule is still on its way somewhere: the shape or its content moving, a glide,
   * the exit. Endless motion (the step's shimmer, a spinner) is not.
   */
  private moving(): boolean {
    if (this.stage.moving) return true;
    return this.capsule
      .getAnimations({ subtree: true })
      .some((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
  }

  private anchorPoint(): AnchorPoint {
    const { v, h: horizontal } = this.mover.anchor;
    return {
      x: horizontal === 'left' ? 0 : horizontal === 'right' ? 1 : 0.5,
      y: v === 'top' ? 0 : 1,
    };
  }

  /** The capsule's box in viewport px while shown; else roughly where it would appear. */
  bounds(): DOMRectReadOnly {
    if (this.shown) return this.capsule.getBoundingClientRect();
    const { v, h: horizontal } = this.mover.anchor;
    const x =
      horizontal === 'left' ? 136 : horizontal === 'right' ? innerWidth - 136 : innerWidth / 2;
    const y = v === 'top' ? 44 : innerHeight - 44;
    // A 272 × 44 capsule centred there.
    return new DOMRect(x - 136, y - 22, 272, 44);
  }

  /** Glow effects off also stills the step text's shimmer. */
  setEffects(on: boolean): void {
    this.layer.root.dataset.effects = on ? 'on' : 'off';
  }
}
