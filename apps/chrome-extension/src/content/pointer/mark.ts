import type { PointerView } from '../../messages/views.ts';
import { drawnBox, h } from '../dom.ts';
import { Layer } from '../hosts.ts';
import { t } from '../i18n.ts';
import { atdMark } from '../mark.ts';
import { reducedMotion, springEasing } from '../motion.ts';
import {
  GLIDE_LIMIT,
  RING_OUTSET,
  type Point,
  type Rect,
  anchorFor,
  cutToViewport,
  distance,
  fieldBar,
  labelOrigin,
  scrollBar,
} from './geometry.ts';
import {
  type MarkPhase,
  type PointerAction,
  isDashed,
  markPhase,
  pointerAction,
  pointerLabel,
} from './labels.ts';
import pointerCss from './pointer.css?inline';
import { signal } from '../lifetime.ts';

/** `PointerFramePolicy.completionHold`: a finished step's mark stays this long, then fades. */
const COMPLETION_HOLD_MS = 800;
/** `PointerStyle.glideResponse`: a critically damped glide. */
const GLIDE = springEasing(0, 0.25, 0);
/** The mark's fade-out (`.pm`), after which its layer leaves the page. */
const FADE_OUT_MS = 200;

interface Placed {
  phase: MarkPhase;
  action: PointerAction;
  rect: Rect;
  anchor: Point;
}

const SVG = 'http://www.w3.org/2000/svg';

/** The classic arrow with its tip at the origin (`PointerStyle.arrowPath`, y down). */
function arrow(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'pm-arrow');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 13 20');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M0 0L0 17L4.2 13.2L7.2 19.8L9.8 18.6L6.9 12.2L12.2 12.2Z');
  svg.append(path);
  return svg;
}

function place(element: HTMLElement, rect: Rect): void {
  element.style.setProperty('left', `${rect.x}px`);
  element.style.setProperty('top', `${rect.y}px`);
  element.style.setProperty('width', `${rect.width}px`);
  element.style.setProperty('height', `${rect.height}px`);
}

/**
 * The tab's live pointer (`PointerMark.swift`), drawn from the shell's `pointer` frames for this
 * tab: display only, never input. It glides between nearby targets (not under Reduce Motion, never
 * a long jump), fades in where it appears, plays a ripple for a sent click, holds a finished step
 * briefly and goes as soon as the page under it may have moved (a scroll other than its own, a
 * resize). Rects arrive in the CSS px of the viewport the host observed and are scaled to this one.
 * Its layer is in the page only while a mark shows (and through its fade).
 */
export class PointerLayer {
  private readonly layer: Layer;
  private readonly mark: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly ripple: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly pill: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private placed: Placed | null = null;
  private holdTimer = 0;
  private leaveTimer = 0;
  /** Until when page input is likely the host's own (it is dispatching), for activity reports. */
  dispatchingUntil = 0;

  /**
   * @param clicked Told where each click the host dispatches lands, in viewport CSS px, as its
   *   ripple plays (the tab's light answers it).
   */
  constructor(private readonly clicked: (at: Point) => void) {
    this.layer = new Layer('atd-pointer', [pointerCss]);
    this.layer.root.setAttribute('aria-hidden', 'true');
    this.ring = h('div', { class: 'pm-ring' });
    this.bar = h('div', { class: 'pm-bar', attrs: { hidden: true } });
    this.ripple = h('div', { class: 'pm-ripple' });
    this.tip = h('div', { class: 'pm-tip' }, arrow());
    this.label = h('span');
    this.pill = h('div', { class: 'pm-pill' }, atdMark(12), this.label);
    this.mark = h('div', { class: 'pm' }, this.ring, this.bar, this.ripple, this.tip, this.pill);
    this.layer.root.append(this.mark);
    this.layer.root.style.setProperty('--p-glide', GLIDE.easing);
    this.layer.root.style.setProperty('--p-glide-ms', `${GLIDE.duration}ms`);
    addEventListener(
      'scroll',
      () => {
        if (this.placed && this.placed.action.kind !== 'scroll') this.hide();
      },
      { capture: true, passive: true, signal },
    );
    addEventListener('resize', () => this.hide(), { signal });
  }

  /** Draws `pointer` (null hides it); `frozen` while the channel is down. */
  update(pointer: PointerView | null, frozen: boolean): void {
    clearTimeout(this.holdTimer);
    if (!pointer?.rect) return this.hide();
    const action = pointerAction(pointer.label);
    const phase = markPhase(pointer.phase, action);
    if (!phase) return this.hide(true);
    const scale = pointer.viewport?.width ? innerWidth / pointer.viewport.width : 1;
    const scaled = {
      x: pointer.rect.x * scale,
      y: pointer.rect.y * scale,
      width: pointer.rect.width * scale,
      height: pointer.rect.height * scale,
    };
    const rect = cutToViewport(scaled, innerWidth, innerHeight);
    if (!rect) return this.hide();
    clearTimeout(this.leaveTimer);
    this.layer.mount();
    const anchor = anchorFor(rect);
    const previous = this.placed;
    const moved = !previous || !sameRect(previous.rect, rect);
    const glide =
      previous !== null &&
      moved &&
      !reducedMotion() &&
      distance(previous.anchor, anchor) <= GLIDE_LIMIT;
    this.mark.classList.toggle('glide', glide);
    if (!glide && moved) {
      // A mark that appears or jumps fades in where it lands.
      this.mark.classList.remove('shown');
      void this.mark.offsetWidth;
    }
    this.placed = { phase, action, rect, anchor };
    this.layOut();
    this.mark.classList.add('shown');
    this.mark.classList.toggle('frozen', frozen);
    const dispatched = phase === 'dispatching' || phase === 'typingField';
    if (dispatched) this.dispatchingUntil = Date.now() + 600;
    if (
      phase === 'dispatching' &&
      action.kind === 'click' &&
      (moved || previous?.phase !== phase)
    ) {
      this.ripple.classList.remove('go');
      void this.ripple.offsetWidth;
      this.ripple.classList.add('go');
      this.clicked(anchor);
    }
    if (phase === 'done') this.holdTimer = window.setTimeout(() => this.hide(), COMPLETION_HOLD_MS);
  }

  /** The channel went down or came back: a shown mark freezes or thaws in place. */
  setFrozen(frozen: boolean): void {
    this.mark.classList.toggle('frozen', frozen);
  }

  /** The language changed: the label follows. */
  relabel(): void {
    if (this.placed) this.layOut();
  }

  /**
   * The box around what the mark draws (ring, bar, arrow, label) in viewport CSS px, while its
   * layer is in the page (its fade-out too); null otherwise.
   */
  bounds(): DOMRectReadOnly | null {
    return this.layer.element ? drawnBox([this.ring, this.bar, this.tip, this.pill]) : null;
  }

  /** Hides the mark: with its fade, or at once for a failed step; then its layer leaves. */
  hide(now = false): void {
    clearTimeout(this.holdTimer);
    if (!this.layer.element) return;
    this.placed = null;
    this.mark.classList.remove('glide');
    if (now) this.mark.style.setProperty('transition-duration', '0s');
    this.mark.classList.remove('shown');
    if (now) requestAnimationFrame(() => this.mark.style.removeProperty('transition-duration'));
    clearTimeout(this.leaveTimer);
    this.leaveTimer = window.setTimeout(
      () => {
        if (!this.placed) this.layer.unmount();
      },
      now ? 0 : FADE_OUT_MS + 50,
    );
  }

  private layOut(): void {
    const placed = this.placed;
    if (!placed) return;
    const { rect, anchor, phase, action } = placed;
    place(this.ring, {
      x: rect.x - RING_OUTSET,
      y: rect.y - RING_OUTSET,
      width: rect.width + RING_OUTSET * 2,
      height: rect.height + RING_OUTSET * 2,
    });
    this.ring.classList.toggle('dashed', isDashed(phase));
    const bar =
      phase === 'typingField' && rect.width >= 12 && rect.height >= 12
        ? fieldBar(rect)
        : phase === 'dispatching' && action.kind === 'scroll' && action.direction
          ? scrollBar(action.direction, rect)
          : null;
    this.bar.hidden = bar === null;
    if (bar) place(this.bar, bar);
    this.ripple.style.setProperty('left', `${anchor.x}px`);
    this.ripple.style.setProperty('top', `${anchor.y}px`);
    this.tip.style.setProperty('transform', `translate(${anchor.x}px, ${anchor.y}px)`);
    this.label.textContent = pointerLabel(phase, action, t);
    const size = { width: this.pill.offsetWidth, height: this.pill.offsetHeight };
    const origin = labelOrigin(anchor, size, { width: innerWidth, height: innerHeight });
    this.pill.style.setProperty('transform', `translate(${origin.x}px, ${origin.y}px)`);
  }
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
