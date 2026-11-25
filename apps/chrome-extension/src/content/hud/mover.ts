import { reducedMotion, springEasing } from '../motion.ts';
import { type Anchor, type Arrow, HOME, sameAnchor, saveAnchor, stepAnchor } from './position.ts';

/** Release velocity, in px per ms. */
export interface Velocity {
  x: number;
  y: number;
}

const NUDGE: Record<Arrow, readonly [number, number]> = {
  ArrowLeft: [-6, 0],
  ArrowRight: [6, 0],
  ArrowUp: [0, -6],
  ArrowDown: [0, 6],
};

/**
 * Re-anchors the capsule and glides it to its new place on a spring (the prototype's `moveHud`,
 * `stepHud`), handing a drag's release velocity to the spring. Under Reduce Motion it fades in at
 * the new anchor instead of sliding.
 */
export class HudMover {
  anchor: Anchor = HOME;
  private glide: Animation | null = null;

  constructor(
    private readonly wrap: HTMLElement,
    private readonly capsule: HTMLElement,
    /** Called whenever the capsule moves, so the light can follow it. */
    private readonly moved: () => void,
  ) {
    this.place(HOME);
  }

  /** Sets the anchor without motion (the remembered place, before the HUD shows). */
  place(at: Anchor): void {
    this.anchor = at;
    this.wrap.dataset.v = at.v;
    this.wrap.dataset.h = at.h;
  }

  /** Re-anchors and glides there from wherever the capsule is drawn now. */
  move(at: Anchor, velocity: Velocity = { x: 0, y: 0 }): void {
    const before = this.capsule.getBoundingClientRect();
    const running = this.glide;
    this.glide = null;
    running?.cancel();
    this.place(at);
    saveAnchor(at);
    this.capsule.style.removeProperty('transform');
    const after = this.capsule.getBoundingClientRect();
    const ox = before.left - after.left;
    const oy = before.top - after.top;
    this.moved();
    if (Math.hypot(ox, oy) < 1) return;
    if (reducedMotion()) {
      this.capsule.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
      return;
    }
    // The release speed toward the anchor, as the spring's initial progress per second.
    const toward = (-(velocity.x * ox + velocity.y * oy) * 1000) / (ox * ox + oy * oy);
    const { easing, duration } = springEasing(Math.max(0, Math.min(30, toward)));
    const glide = this.capsule.animate(
      [{ transform: `translate(${ox}px, ${oy}px)` }, { transform: 'translate(0, 0)' }],
      { duration, easing },
    );
    this.glide = glide;
    glide.onfinish = () => {
      if (this.glide === glide) this.glide = null;
      this.moved();
    };
    glide.oncancel = glide.onfinish;
  }

  /** Moves one anchor for an arrow key; at an edge, a short nudge says so instead. */
  step(key: Arrow): void {
    const next = stepAnchor(this.anchor, key);
    if (!sameAnchor(next, this.anchor)) return this.move(next);
    if (reducedMotion() || this.glide) return;
    const [dx, dy] = NUDGE[key];
    this.capsule.animate(
      [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  /** Stops a glide under way and returns the offset it had reached, for a grab mid-glide. */
  takeGlide(): { x: number; y: number } {
    const glide = this.glide;
    if (!glide) return { x: 0, y: 0 };
    const matrix = new DOMMatrixReadOnly(getComputedStyle(this.capsule).transform);
    this.glide = null;
    glide.cancel();
    this.capsule.style.setProperty('transform', `translate(${matrix.m41}px, ${matrix.m42}px)`);
    return { x: matrix.m41, y: matrix.m42 };
  }
}
