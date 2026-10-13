import { clamp01, easeIn, easeOut } from '../../motion/ease.ts';
import { springAt, type Spring } from '../../motion/spring.ts';
import { DISPLAY, type Point } from '../world/points.ts';

/**
 * The command island's motion (`IslandChoreography`, `MiniPanelChoreography`), pure so any frame
 * can be computed alone. SwiftUI's `spring(duration, bounce)` is the film's
 * `{ response: duration, damping: 1 - bounce }`.
 *
 * The island is one glass shape standing on a point 24 pt above the work area's bottom, centred,
 * so every shape grows upward out of that edge. It enters at its first shape's size, from 0.9 of
 * it and 4 pt lower, while it fades in; between contents it morphs, its height on one spring and
 * its width on another; it leaves as one piece, shrinking to 0.9 as it fades out.
 */
export interface IslandSize {
  width: number;
  height: number;
}

/** One content the island shows from `at`, at its own size; `card` keeps an 18 pt corner. */
export interface IslandStep {
  at: number;
  size: IslandSize;
  card?: boolean;
}

/** The capsule's height: a 28 pt control in 4 pt of padding. */
export const CAPSULE_HEIGHT = 36;
/** The card's corner, constant through its morphs. */
export const CARD_RADIUS = 18;
/** The shape's bottom edge sits this far above the work area's bottom. */
export const ISLAND_MARGIN = 24;
/** Where the island stands on a display without a Dock: the middle of its bottom edge. */
export const ISLAND_HOME: Point = { x: DISPLAY.width / 2, y: DISPLAY.height - ISLAND_MARGIN };

/** The entrance's shape spring (0.32 s, bounce 0.15) and its fade. */
const ENTER: Spring = { response: 0.32, damping: 0.85 };
const ENTER_FADE = 0.16;
const EXIT = 0.18;
/** A growing morph: height (and corner) on one spring, width on a slower one. */
const GROW_HEIGHT: Spring = { response: 0.34, damping: 0.64 };
const GROW_WIDTH: Spring = { response: 0.42, damping: 0.68 };
/** A shrinking morph waits for its content to leave, then both axes follow. */
const SHRINK: Spring = { response: 0.3, damping: 0.8 };
const SHRINK_DELAY = 0.04;
/** Content arrives on this spring, its blur clearing from 6 pt; it leaves eased in over 0.08 s. */
const CONTENT: Spring = { response: 0.2, damping: 1 };
const CONTENT_EXIT = 0.08;
const CONTENT_BLUR = 6;
/** Content scales with its shape up to this far past its rest. */
const FOLLOW_LIMIT = 1.06;

export interface IslandShape {
  width: number;
  height: number;
  radius: number;
}

export interface IslandLayer {
  /** Index of the step this content belongs to. */
  index: number;
  opacity: number;
  blur: number;
  /** Its scale as it follows the shape (1 at rest). */
  scale: number;
}

export interface IslandFrame {
  /** Whether the island is on screen at all. */
  shown: boolean;
  shape: IslandShape;
  /** The whole island's opacity, scale about its bottom edge's middle, and drop (pt). */
  opacity: number;
  scale: number;
  drop: number;
  layers: IslandLayer[];
}

const cornerOf = (step: IslandStep) => (step.card ? CARD_RADIUS : step.size.height / 2);
const area = (size: IslandSize) => size.width * size.height;

/** The shape at `t`: each morph adds its change on its own springs, as the camera's shots do. */
function shapeAt(t: number, steps: readonly IslandStep[]): IslandShape {
  const first = steps[0];
  if (!first) return { width: 0, height: 0, radius: 0 };
  const shape = { width: first.size.width, height: first.size.height, radius: cornerOf(first) };
  for (let index = 1; index < steps.length; index++) {
    const from = steps[index - 1];
    const to = steps[index];
    if (!from || !to) continue;
    const shrinks = area(to.size) < area(from.size);
    const across = shrinks
      ? springAt(t, to.at + SHRINK_DELAY, SHRINK)
      : springAt(t, to.at, GROW_HEIGHT);
    const along = shrinks ? across : springAt(t, to.at, GROW_WIDTH);
    shape.height += (to.size.height - from.size.height) * across;
    shape.radius += (cornerOf(to) - cornerOf(from)) * across;
    shape.width += (to.size.width - from.size.width) * along;
  }
  return shape;
}

/**
 * Each content's presence: the first arrives with the island (its blur clearing alongside the
 * entrance), each later one once the content before it has left.
 */
function layersAt(t: number, steps: readonly IslandStep[], shape: IslandShape): IslandLayer[] {
  const layers: IslandLayer[] = [];
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    const arrive = index === 0 ? step.at : step.at + CONTENT_EXIT;
    if (t < arrive || (next && t > next.at + CONTENT_EXIT)) return;
    const shown = springAt(t, arrive, CONTENT);
    const leave = next ? easeIn(clamp01((t - next.at) / CONTENT_EXIT)) : 0;
    const fit = Math.min(shape.width / step.size.width, shape.height / step.size.height);
    layers.push({
      index,
      opacity: clamp01(shown) * (1 - leave),
      blur: (1 - clamp01(shown)) * CONTENT_BLUR + leave * CONTENT_BLUR,
      scale: Math.min(Math.max(fit, 0.01), FOLLOW_LIMIT),
    });
  });
  return layers;
}

/**
 * The island at `t` for contents `steps` (in time order, the first entering the island) and an
 * optional `exit` time.
 */
export function islandAt(t: number, steps: readonly IslandStep[], exit?: number): IslandFrame {
  const start = steps[0]?.at ?? 0;
  const shape = shapeAt(t, steps);
  const enter = springAt(t, start, ENTER);
  const leave = exit === undefined ? 0 : easeIn(clamp01((t - exit) / EXIT));
  return {
    shown: t >= start && leave < 1,
    shape,
    opacity: easeOut(clamp01((t - start) / ENTER_FADE)) * (1 - leave),
    scale: (0.9 + 0.1 * enter) * (1 - 0.1 * leave),
    drop: (1 - enter) * 4,
    layers: layersAt(t, steps, shape),
  };
}

/** The 8-spoke spinner's wave: one turn per 0.8 s in 24 steps, each spoke 0.1 s behind the last. */
const SPIN_PERIOD = 0.8;
const SPIN_STEPS = 24;
const SPIN_RAMP = 3;
const SPIN_TRAIL = 0.13;

/** The opacity of spoke `spoke` (0 points up, then clockwise) at `time` seconds. */
export function spokeOpacity(spoke: number, time: number): number {
  const local = (((time - (spoke * SPIN_PERIOD) / 8) % SPIN_PERIOD) + SPIN_PERIOD) % SPIN_PERIOD;
  const step = Math.floor((local / SPIN_PERIOD) * SPIN_STEPS);
  if (step <= SPIN_RAMP) return SPIN_TRAIL + ((1 - SPIN_TRAIL) * step) / SPIN_RAMP;
  return 1 - ((1 - SPIN_TRAIL) * (step - SPIN_RAMP)) / (SPIN_STEPS - SPIN_RAMP);
}

/**
 * How far running text's shimmer is into its sweep, 0 → 1, at `time` (`ShimmerSweep`): the band
 * crosses once every 2 s on one shared clock.
 */
export function sweepAt(time: number): number {
  return (((time / 2) % 1) + 1) % 1;
}

/**
 * How much of `count` characters (graphemes) the paced write-back has typed `elapsed` seconds into
 * it (`TypingPace`): 4 characters every 20 ms, the first chunk at once; past 240 characters the
 * chunks grow so the last is due by 1.2 s.
 */
export function typedCount(elapsed: number, count: number): number {
  if (elapsed < 0) return 0;
  const chunks = Math.min(60, Math.ceil(count / 4));
  const chunk = Math.max(4, Math.ceil(count / chunks));
  return Math.min(count, (Math.floor(elapsed / 0.02) + 1) * chunk);
}
