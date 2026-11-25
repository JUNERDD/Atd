import { type Spring, springEasing } from '../motion.ts';

/**
 * The HUD's motion: the command island's (`IslandChoreography` and `MiniPanelChoreography` in
 * `apps/macos/Sources/AICore`), so the HUD in a tab moves as the island on the desktop does. One
 * glass shape that is a capsule while a run works and a card when it asks or answers: its height
 * (the thickness, across the edge it stands on) and its width (the length, along it) each run on
 * their own spring from their own start, so it swells before it stretches and settles in two
 * motions, a little past its rest and back. Content leaves before the shape moves and arrives
 * after it, out of a blur, scaling with the shape; a change within the same kind of content takes
 * its new size at once and scales with the shape as it springs there, so it swells and settles
 * with the glass. Only growth under the person's own input keeps content at its own size. Reduce
 * Motion takes the bounce out of every spring, keeps content at its own size, and drops scale and
 * blur, never the change itself.
 */

/** How the shape moves for one moment: each axis on its spring, after its delay (seconds). */
export interface ShapeMotion {
  thickness: Spring;
  thicknessDelay: number;
  length: Spring;
  lengthDelay: number;
}

function motion(thickness: Spring, length: Spring, thicknessDelay = 0, lengthDelay = 0) {
  return { thickness, thicknessDelay, length, lengthDelay } satisfies ShapeMotion;
}

/** Opening: the shape grows (or enters), about 7 % past its rest across and 5 % along. */
const EXPAND = motion({ response: 0.34, bounce: 0.36 }, { response: 0.42, bounce: 0.32 });
/** A card drawing into the capsule, a little past it and back out, once its content has left. */
const COLLAPSE = motion(
  { response: 0.3, bounce: 0.24 },
  { response: 0.36, bounce: 0.26 },
  0.05,
  0.02,
);
/** Any other shape shrinking: it waits for its content, then settles with less swing. */
const SHRINK = motion({ response: 0.3, bounce: 0.2 }, { response: 0.3, bounce: 0.2 }, 0.04, 0.04);
/** Growing or shrinking under the person's own input (the composer gaining a line): no bounce. */
export const IN_PLACE = motion({ response: 0.22, bounce: 0 }, { response: 0.22, bounce: 0 });
/** The entrance, and a change within the same kind of content, open as the shape grows. */
export const ENTRANCE = EXPAND;
export const RESIZE = EXPAND;

export interface Size {
  w: number;
  h: number;
}

/**
 * The shape's springs from `from` to `to`: growing opens, a card drawing into a capsule (`toRow`)
 * collapses, anything else shrinking waits for its content.
 */
export function shapeMotion(from: Size, to: Size, toRow: boolean): ShapeMotion {
  if (to.w * to.h >= from.w * from.h) return EXPAND;
  if (toRow && from.h > to.h) return COLLAPSE;
  return SHRINK;
}

/** The same moment without overshoot, for Reduce Motion. */
export function calm(moment: ShapeMotion): ShapeMotion {
  return {
    ...moment,
    thickness: { ...moment.thickness, bounce: 0 },
    length: { ...moment.length, bounce: 0 },
  };
}

/** Content's opacity, and its blur clearing, as it arrives. */
export const CONTENT_ARRIVAL: Spring = { response: 0.2, bounce: 0 };
/** Content leaves eased in over this long (seconds), to transparent and blurred. */
export const CONTENT_EXIT = 0.08;
/** The blur (px) of content while it is hidden. */
export const CONTENT_BLUR = 6;
/** Content that replaces other content arrives once that has left. */
export const REPLACING_DELAY = CONTENT_EXIT;
/** A leaving content stays mounted for its exit with a frame to spare (ms). */
export const UNMOUNT_DELAY_MS = (CONTENT_EXIT + 0.1) * 1000;
/** How far past its rest content grows with its shape's overshoot, never outgrowing the glass. */
export const FOLLOW_LIMIT = 1.06;

/** A piece of content that changes in place (a label, a glyph) crosses over through a lighter blur. */
export const PART_BLUR = 3;
export const PART_DELAY = 0.04;
export const PART_EXIT = 0.1;

/**
 * The pill the HUD enters from, as shares of its first shape's width and height, standing on the
 * middle of its anchor's edge with its corner scaled with its height, so a capsule enters as a
 * capsule; it is narrower than short in proportion, so the content, which scales to fit the shape,
 * starts with room above and below it.
 */
export const ENTRANCE_WIDTH = 0.4;
export const ENTRANCE_HEIGHT = 0.6;
/** The glass fades in as it opens (ms); under Reduce Motion it only fades, a little slower. */
export const ENTRANCE_FADE_MS = 160;
export const REDUCED_FADE_MS = 200;

/**
 * Leaving, the whole HUD shrinks a little toward its anchor's edge, its content still in it, as it
 * fades out: eased in, and quicker than the entrance, as dismissals are.
 */
export const EXIT_MS = 180;
export const EXIT_SCALE = 0.9;

/**
 * `element` arrives after `delay` (seconds): its opacity and its blur from `blur` px clearing
 * together on the content's spring; under Reduce Motion it only fades in. The blur is on content
 * only, never on the glass.
 */
export function arrive(element: HTMLElement, blur: number, delay: number, reduce: boolean): void {
  const { easing, duration } = springEasing(0, CONTENT_ARRIVAL.response, 0);
  element.animate(
    reduce ? { opacity: [0, 1] } : { opacity: [0, 1], filter: [`blur(${blur}px)`, 'blur(0px)'] },
    { duration, easing, delay: delay * 1000, fill: 'backwards' },
  );
}

/**
 * `element` leaves at once, eased in over `seconds` to transparent and blurred, from the opacity it
 * is drawn with now (it may still be arriving); under Reduce Motion it only fades out.
 */
export function leave(
  element: HTMLElement,
  blur: number,
  seconds: number,
  reduce: boolean,
): Animation {
  const drawn = getComputedStyle(element);
  const opacity = Number(drawn.opacity);
  // A blur still clearing goes on from where it is; any other filter (a hover's) starts over.
  const from = /^blur\([^)]*\)$/.test(drawn.filter) ? drawn.filter : 'blur(0px)';
  for (const animation of element.getAnimations()) animation.cancel();
  return element.animate(
    reduce
      ? { opacity: [opacity, 0] }
      : { opacity: [opacity, 0], filter: [from, `blur(${blur}px)`] },
    { duration: seconds * 1000, easing: 'ease-in', fill: 'forwards' },
  );
}
