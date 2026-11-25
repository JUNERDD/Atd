import { h } from '../dom.ts';
import { reducedMotion } from '../motion.ts';
import { fitRow } from './compact.ts';
import {
  CONTENT_BLUR,
  CONTENT_EXIT,
  ENTRANCE,
  ENTRANCE_FADE_MS,
  ENTRANCE_HEIGHT,
  ENTRANCE_WIDTH,
  EXIT_MS,
  EXIT_SCALE,
  IN_PLACE,
  REDUCED_FADE_MS,
  REPLACING_DELAY,
  RESIZE,
  UNMOUNT_DELAY_MS,
  arrive,
  calm,
  leave,
  shapeMotion,
} from './island.ts';
import { type AnchorPoint, type Box, ShapeMorph } from './morph.ts';
import { changeInPlace, snapshot } from './parts.ts';

/** What the stage shows: a content and what kind of change leads to it. */
export interface StageContent {
  node: HTMLElement;
  shape: 'row' | 'card' | 'compose';
  /** Content of the same scene changes in place; another scene replaces it. */
  scene: string;
}

export interface StageEvents {
  /** The shape came to rest. */
  settled(): void;
  /** The exit is over: nothing shows any more. */
  gone(): void;
}

/**
 * The capsule's glass shape and the faces it shows (the island's content layers). The capsule's
 * layout is always its current content's own; the glass and the faces move over it. It enters out
 * of a pill at its anchor's edge, morphs between contents, changes a content in place, and leaves
 * as one piece; a show while it leaves turns it back from where it is.
 */
export class IslandStage {
  readonly shape: HTMLDivElement;
  private readonly morph: ShapeMorph;
  private face: HTMLDivElement | null = null;
  private content: StageContent | null = null;
  private readonly leaving = new Map<HTMLDivElement, number>();
  private phase: 'hidden' | 'shown' | 'leaving' = 'hidden';
  private exiting: Animation[] = [];
  private readonly observer = new ResizeObserver(() => this.resized());

  constructor(
    private readonly capsule: HTMLElement,
    anchor: () => AnchorPoint,
    private readonly events: StageEvents,
  ) {
    this.shape = h('div', { class: 'hud-shape glass', attrs: { 'aria-hidden': 'true' } });
    capsule.append(this.shape);
    this.morph = new ShapeMorph(this.shape, anchor, () => events.settled());
  }

  /** Whether anything of the HUD is still on its way somewhere. */
  get moving(): boolean {
    return this.morph.moving || this.phase === 'leaving';
  }

  /** Shows `next`: it enters, turns the exit back, changes in place, or replaces what shows. */
  present(next: StageContent): void {
    const reduce = reducedMotion();
    if (this.phase === 'hidden') return this.enter(next, reduce);
    if (this.phase === 'leaving') this.turnBack(reduce);
    const previous = this.content;
    this.content = next;
    // The composer is one node for the life of the tab: it changes size on its own (`resized`).
    if (previous?.node === next.node) return;
    if (previous?.scene === next.scene && this.face) return this.update(previous, next, reduce);
    this.replace(next, reduce);
  }

  /** Leaves as one piece: content stays in the glass as both shrink a little toward the anchor. */
  dismiss(): void {
    if (this.phase !== 'shown') return;
    this.phase = 'leaving';
    const reduce = reducedMotion();
    const timing: KeyframeAnimationOptions = {
      duration: reduce ? REDUCED_FADE_MS : EXIT_MS,
      easing: 'ease-in',
      fill: 'forwards',
    };
    // Each piece fades on its own: a fading ancestor would cut the glass off from the page behind.
    const pieces: HTMLElement[] = [this.shape, ...(this.face ? [this.face] : [])];
    this.exiting = pieces.map((piece) =>
      piece.animate({ opacity: [Number(getComputedStyle(piece).opacity), 0] }, timing),
    );
    if (!reduce) {
      const scale = getComputedStyle(this.capsule).scale;
      this.exiting.push(
        this.capsule.animate({ scale: [scale === 'none' ? '1' : scale, `${EXIT_SCALE}`] }, timing),
      );
    }
    const fade = this.exiting[0];
    if (fade) fade.onfinish = () => this.gone();
  }

  private enter(next: StageContent, reduce: boolean): void {
    this.phase = 'shown';
    this.content = next;
    const face = this.mount(next);
    const target = this.measure();
    this.observer.observe(this.capsule);
    // The capsule's room: a wider window can give a crowded row its labels back.
    if (this.capsule.parentElement) this.observer.observe(this.capsule.parentElement);
    if (reduce) {
      this.morph.place(target);
      this.shape.animate({ opacity: [0, 1] }, { duration: REDUCED_FADE_MS, easing: 'ease' });
      return arrive(face, 0, 0, true);
    }
    // Out of a pill on the anchor's edge, a capsule as a capsule; content grows with it at once.
    const pill: Box = {
      w: target.w * ENTRANCE_WIDTH,
      h: target.h * ENTRANCE_HEIGHT,
      r: target.r * ENTRANCE_HEIGHT,
    };
    this.morph.track(face, target, 'scale');
    this.morph.to(target, ENTRANCE, pill);
    this.shape.animate({ opacity: [0, 1] }, { duration: ENTRANCE_FADE_MS, easing: 'ease-out' });
    arrive(face, CONTENT_BLUR, 0, false);
  }

  /** What shows leaves into a blur as the shape starts to move; `next` arrives after it. */
  private replace(next: StageContent, reduce: boolean): void {
    if (this.face) this.retire(this.face, reduce);
    const face = this.mount(next);
    const target = this.measure();
    const moment = shapeMotion(this.morph.drawn(), target, next.shape === 'row');
    this.morph.track(face, target, reduce ? 'clip' : 'scale');
    this.morph.to(target, reduce ? calm(moment) : moment);
    arrive(face, CONTENT_BLUR, REPLACING_DELAY, reduce);
  }

  /**
   * The same scene with new content, as the island changes a content of the same kind: laid out at
   * its new size at once and scaled with the shape as it springs there on the opening springs,
   * swelling and settling with it, while what changed crosses over in place.
   */
  private update(previous: StageContent, next: StageContent, reduce: boolean): void {
    const face = this.face;
    if (!face) return;
    const before = snapshot(face, previous.node);
    if (previous.node.parentNode === face) previous.node.replaceWith(next.node);
    else face.prepend(next.node);
    this.fit(next);
    const target = this.measure();
    changeInPlace(face, before, next.node, reduce);
    this.morph.track(face, target, reduce ? 'clip' : 'scale');
    this.morph.to(target, reduce ? calm(RESIZE) : RESIZE);
  }

  /**
   * The content changed size on its own (the composer's field gaining a line, the window), or its
   * room did and a row laid itself out again: the shape follows on a quick spring with no bounce,
   * the content at its own size, so the text under the caret holds still.
   */
  private resized(): void {
    const face = this.face;
    if (this.phase !== 'shown' || !face || !this.content) return;
    this.fit(this.content);
    const target = this.measure();
    const at = this.morph.target;
    if (Math.abs(target.w - at.w) < 0.5 && Math.abs(target.h - at.h) < 0.5) return;
    this.morph.track(face, target, this.morph.follows(face) ?? 'clip');
    this.morph.to(target, IN_PLACE);
  }

  /** A show during the exit: the HUD comes back from where the fade and the shrink have it. */
  private turnBack(reduce: boolean): void {
    this.phase = 'shown';
    const pieces: HTMLElement[] = [this.shape, ...(this.face ? [this.face] : [])];
    const opacities = pieces.map((piece) => Number(getComputedStyle(piece).opacity));
    const scale = getComputedStyle(this.capsule).scale;
    for (const animation of this.exiting) animation.cancel();
    this.exiting = [];
    const timing = { duration: reduce ? REDUCED_FADE_MS : ENTRANCE_FADE_MS, easing: 'ease-out' };
    pieces.forEach((piece, index) =>
      piece.animate({ opacity: [opacities[index] ?? 0, 1] }, timing),
    );
    if (scale !== 'none') this.capsule.animate({ scale: [scale, '1'] }, timing);
  }

  private gone(): void {
    if (this.phase !== 'leaving') return;
    this.phase = 'hidden';
    for (const animation of this.exiting) animation.cancel();
    this.exiting = [];
    this.observer.disconnect();
    this.morph.stop();
    // A Map deletes its current entry safely while it is iterated.
    for (const face of this.leaving.keys()) this.drop(face);
    this.face?.remove();
    this.face = null;
    this.content = null;
    this.events.gone();
  }

  /**
   * `next` becomes the content, in the capsule's shape for it. The shape changes only now, once
   * what showed has kept its own size to leave in.
   */
  private mount(next: StageContent): HTMLDivElement {
    this.capsule.classList.toggle('card', next.shape !== 'row');
    this.capsule.classList.toggle('compose', next.shape === 'compose');
    const face = h('div', { class: 'hud-face' }, next.node);
    this.capsule.append(face);
    this.face = face;
    this.fit(next);
    return face;
  }

  /**
   * A content placed in the capsule lays itself out for the room it has before the shape takes its
   * size: a row stays one line by showing its secondary actions as icons (`compact.ts`).
   */
  private fit(content: StageContent): void {
    if (content.shape === 'row') fitRow(content.node);
  }

  /** `face` stops being the content: it keeps its size and anchor as it leaves into a blur. */
  private retire(face: HTMLDivElement, reduce: boolean): void {
    const style = getComputedStyle(face);
    const size = { w: parseFloat(style.width), h: parseFloat(style.height) };
    face.style.setProperty('width', `${size.w}px`);
    face.style.setProperty('height', `${size.h}px`);
    face.classList.add('leaving');
    face.inert = true;
    face.setAttribute('aria-hidden', 'true');
    this.morph.track(face, size, this.morph.follows(face) ?? (reduce ? 'clip' : 'scale'));
    leave(face, CONTENT_BLUR, CONTENT_EXIT, reduce);
    this.leaving.set(
      face,
      window.setTimeout(() => this.drop(face), UNMOUNT_DELAY_MS),
    );
    if (this.face === face) this.face = null;
  }

  private drop(face: HTMLDivElement): void {
    clearTimeout(this.leaving.get(face));
    this.leaving.delete(face);
    this.morph.untrack(face);
    face.remove();
  }

  /** The capsule's own layout: the shape at rest, with its corner. */
  private measure(): Box {
    const style = getComputedStyle(this.capsule);
    const w = parseFloat(style.width);
    const h = parseFloat(style.height);
    return { w, h, r: Math.min(parseFloat(style.borderTopLeftRadius) || 0, h / 2) };
  }
}
