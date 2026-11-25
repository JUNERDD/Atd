import { type Spring, type SpringCurve, springCurve } from '../motion.ts';
import { FOLLOW_LIMIT, type ShapeMotion, type Size } from './island.ts';

/** The glass shape as drawn: its size and its corner, in px. */
export interface Box extends Size {
  r: number;
}

/**
 * How a face (one content of the HUD) follows the shape while it moves: centred on it and scaled to
 * fit inside it, up to `FOLLOW_LIMIT` past its rest (`scale`, as content arrives, leaves or changes),
 * or at its own size, clipped to it (`clip`, as it grows under the person's own input, and under
 * Reduce Motion).
 */
export type Follow = 'scale' | 'clip';

/**
 * The point that stays put as the shape and its faces change size: shares of their width and
 * height (0 left or top, 0.5 the middle, 1 right or bottom), the HUD's anchor.
 */
export interface AnchorPoint {
  x: number;
  y: number;
}

interface Track extends Size {
  follow: Follow;
}

/** The most (px) a change still has to go when it ends: half a pixel on a Retina display. */
const REST_TOLERANCE = 0.25;

/** One change of an axis's target: `change` px on its spring from `start` (ms). */
interface Move {
  change: number;
  start: number;
  curve: SpringCurve;
  /** The spring's angular frequency, which scales its speed into its remaining swing. */
  omega: number;
}

/**
 * One axis of the shape (the island's `MiniPanelAxisAnimation`): each change of its target runs on
 * its own spring after its own delay, added to the changes still running, which go on to where
 * they were going, overshoot and all. For springs that is retargeting them with their velocity;
 * starting a new spring from where the axis is would damp the swing a change in flight still has.
 */
class Axis {
  private moves: Move[] = [];

  constructor(private to: number) {}

  /** The axis heads for `to` on `spring`, from `delay` seconds after `now` (ms). */
  add(to: number, spring: Spring, delay: number, now: number): void {
    const change = to - this.to;
    this.to = to;
    // Too small to see move: it is there at once.
    if (Math.abs(change) <= REST_TOLERANCE) return;
    const omega = (2 * Math.PI) / spring.response;
    this.moves.push({ change, start: now + delay * 1000, curve: springCurve(spring), omega });
  }

  value(now: number): number {
    let value = this.to;
    for (const move of this.moves) {
      const time = (now - move.start) / 1000;
      value -= move.change * (time <= 0 ? 1 : 1 - move.curve.at(time));
    }
    return value;
  }

  /**
   * Drops the changes that can no longer move the axis by more than `REST_TOLERANCE`, and says
   * whether any is left. A spring's remaining swing is bounded by its distance from rest and its
   * speed over its frequency, so a change that rests once rests from then on.
   */
  settle(now: number): boolean {
    this.moves = this.moves.filter((move) => {
      const time = (now - move.start) / 1000;
      if (time <= 0) return true;
      const left = 1 - move.curve.at(time);
      const speed = move.curve.velocity(time) / move.omega;
      return Math.hypot(left, speed) * Math.abs(move.change) > REST_TOLERANCE;
    });
    return this.moves.length > 0;
  }
}

const px = (value: number) => `${value.toFixed(2)}px`;

/**
 * The HUD's glass shape in motion (the island's `morph`): its width on the length spring, its
 * height and corner on the thickness spring, each read from the analytic springs every frame, so a
 * new target takes over from wherever the shape is, its swing included. The faces it tracks
 * follow it on the same frame. At rest the shape and its faces carry no inline geometry: the shape
 * fills the capsule, whose layout is the content's own.
 */
export class ShapeMorph {
  private axes: { w: Axis; h: Axis; r: Axis } | null = null;
  private rest: Box = { w: 0, h: 0, r: 0 };
  private readonly faces = new Map<HTMLElement, Track>();
  private frame = 0;

  constructor(
    private readonly shape: HTMLElement,
    private readonly anchor: () => AnchorPoint,
    /** The shape came to rest. */
    private readonly settled: () => void,
  ) {}

  get moving(): boolean {
    return this.axes !== null;
  }

  /** Where the shape is headed, or stands. */
  get target(): Box {
    return this.rest;
  }

  /** The shape as drawn at `time`. */
  drawn(time = performance.now()): Box {
    const axes = this.axes;
    if (!axes) return this.rest;
    return { w: axes.w.value(time), h: axes.h.value(time), r: axes.r.value(time) };
  }

  /** How `face` follows the shape now, or null when it stands at rest. */
  follows(face: HTMLElement): Follow | null {
    return this.faces.get(face)?.follow ?? null;
  }

  /** `face`, laid out at `size`, follows the shape until it comes to rest. */
  track(face: HTMLElement, size: Size, follow: Follow): void {
    this.faces.set(face, { ...size, follow });
    if (this.axes) this.draw(performance.now());
  }

  untrack(face: HTMLElement): void {
    this.faces.delete(face);
    clearFollow(face);
  }

  /** Stands the shape at `box` at once. */
  place(box: Box): void {
    this.rest = box;
    this.finish(false);
  }

  /**
   * Moves the shape to `to` on `motion`: on top of the motion still running, or from `from` (the
   * entrance's pill), or from rest.
   */
  to(to: Box, motion: ShapeMotion, from?: Box): void {
    const now = performance.now();
    if (from || !this.axes) {
      const start = from ?? this.rest;
      this.axes = { w: new Axis(start.w), h: new Axis(start.h), r: new Axis(start.r) };
    }
    const { thickness, thicknessDelay, length, lengthDelay } = motion;
    this.axes.w.add(to.w, length, lengthDelay, now);
    this.axes.h.add(to.h, thickness, thicknessDelay, now);
    this.axes.r.add(to.r, thickness, thicknessDelay, now);
    this.rest = to;
    if (this.done(now)) return this.finish(true);
    // The first frame is written now, so nothing paints at the target before the shape moves.
    this.draw(now);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  /** Forgets every face and leaves the shape at rest (the HUD left). */
  stop(): void {
    this.finish(false);
  }

  private readonly tick = (time: number): void => {
    this.frame = 0;
    if (!this.axes) return;
    if (this.done(time)) return this.finish(true);
    this.draw(time);
    this.frame = requestAnimationFrame(this.tick);
  };

  private done(time: number): boolean {
    const axes = this.axes;
    if (!axes) return true;
    // Every axis drops what has come to rest, not only the first still moving.
    const moving = [axes.w, axes.h, axes.r].map((axis) => axis.settle(time));
    return !moving.includes(true);
  }

  private draw(time: number): void {
    const box = this.drawn(time);
    const corner = Math.max(0, Math.min(box.r, box.h / 2));
    const style = this.shape.style;
    style.setProperty('width', px(Math.max(box.w, 0)));
    style.setProperty('height', px(Math.max(box.h, 0)));
    style.setProperty('border-radius', px(corner));
    const anchor = this.anchor();
    for (const [face, track] of this.faces) follow(face, track, { ...box, r: corner }, anchor);
  }

  private finish(settled: boolean): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.axes = null;
    for (const name of ['width', 'height', 'border-radius']) this.shape.style.removeProperty(name);
    for (const face of this.faces.keys()) clearFollow(face);
    this.faces.clear();
    if (settled) this.settled();
  }
}

/**
 * Writes how `face` (laid out at `track`'s size, its anchor point on the shape's) stands on the
 * shape `box`: centred on it and scaled to fit, or clipped to it at its own size.
 */
function follow(face: HTMLElement, track: Track, box: Box, anchor: AnchorPoint): void {
  const style = face.style;
  if (track.follow === 'scale') {
    const fit = Math.min(box.w / track.w, box.h / track.h);
    const scale = Math.min(Math.max(fit, 0.01), FOLLOW_LIMIT);
    const dx = (box.w - track.w) * (0.5 - anchor.x);
    const dy = (box.h - track.h) * (0.5 - anchor.y);
    style.setProperty('transform', `translate(${px(dx)}, ${px(dy)}) scale(${scale.toFixed(4)})`);
    return;
  }
  // Negative where the glass is wider than the face: what moves or fades past the face's new edge
  // shows as far as the glass does.
  const spareW = track.w - box.w;
  const spareH = track.h - box.h;
  const inset = [
    spareH * anchor.y,
    spareW * (1 - anchor.x),
    spareH * (1 - anchor.y),
    spareW * anchor.x,
  ].map(px);
  style.setProperty('clip-path', `inset(${inset.join(' ')} round ${px(box.r)})`);
  face.dataset.follow = 'clip';
}

function clearFollow(face: HTMLElement): void {
  face.style.removeProperty('transform');
  face.style.removeProperty('clip-path');
  delete face.dataset.follow;
}
