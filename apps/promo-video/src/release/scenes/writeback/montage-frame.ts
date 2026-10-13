/**
 * The destinations montage's framing, apart from its components: which demo is on screen, its
 * camera (a hard cut to each framing on its hit, then a slow drift in), where the fallback demo's
 * selection sits in the frame, which the flood grows from, and where its answer card's Copy is.
 */
import type { Lang } from '../../../copy.ts';
import { answerCardLayout, type AnswerCardSpec } from '../../../kit/product/answer-card.ts';
import { textButtonWidth } from '../../../kit/product/island-metrics.ts';
import { strings } from '../../../kit/product/strings.ts';
import { cameraAt, REST_SHOT, type CameraState } from '../../../kit/world/camera.ts';
import { textWidthAt } from '../../../kit/world/measure.ts';
import { FRAME_SCALE, type Point, type Rect } from '../../../kit/world/points.ts';
import { HEIGHT, WIDTH } from '../../timeline.ts';
import { WRITEBACK_MONTAGE } from './beats.ts';
import type { DemoContent, WritebackContent } from './content.ts';
import { DEMO_SHOTS, DEMO_TEXT, demoShots, ISLAND_ANCHOR } from './layout.ts';

/** The demo on screen at `t` (the last whose hit has passed). */
export function demoAt(t: number) {
  const hits = WRITEBACK_MONTAGE.filter((demo) => t >= demo.at);
  return hits[hits.length - 1] ?? WRITEBACK_MONTAGE[0];
}

/** The demo's camera at `t`: framed at its hit (a hard cut), drifting in. */
export function demoCamera(t: number): CameraState {
  const demo = demoAt(t);
  if (!demo) return cameraAt(t, [REST_SHOT]);
  const framing = DEMO_SHOTS[demo.id];
  return cameraAt(t, demoShots(demo.at, framing.zoom, framing.y));
}

/**
 * The target's box on the display (its first line): it follows `before` on the paragraph's first
 * line, set in the demo's type.
 */
export function targetBox(demo: DemoContent): Rect {
  const width = (text: string) => textWidthAt(text, DEMO_TEXT.weight, DEMO_TEXT.size);
  return {
    x: DEMO_TEXT.left + width(demo.before),
    y: DEMO_TEXT.top,
    width: width(demo.target),
    height: DEMO_TEXT.line,
  };
}

/** A display box in frame px under the camera `state`. */
function onFrame(box: Rect, state: CameraState): Rect {
  return {
    x: WIDTH / 2 + (box.x * FRAME_SCALE - state.x) * state.zoom,
    y: HEIGHT / 2 + (box.y * FRAME_SCALE - state.y) * state.zoom,
    width: box.width * FRAME_SCALE * state.zoom,
    height: box.height * FRAME_SCALE * state.zoom,
  };
}

/** Where the fallback demo's selection sits in the frame when the flood sets off. */
export function floodFrom(c: WritebackContent, at: number): Rect {
  return onFrame(targetBox(c.montage.demos.unwritten), demoCamera(at));
}

/** The fallback's answer card, as the island shows it. */
export function fallbackCard(c: WritebackContent): AnswerCardSpec {
  const { command, answer, note } = c.montage.demos.unwritten;
  return { command, answer, note };
}

/**
 * The middle of the answer card's Copy button on the display: the footer's trailing button, inside
 * the card's 6 pt padding, the card standing centred on the island's anchor.
 */
export function copyButton(lang: Lang, card: AnswerCardSpec): Point {
  const { width } = answerCardLayout(lang, card);
  const button = textButtonWidth(strings[lang].command.answer.copy);
  return { x: ISLAND_ANCHOR.x + width / 2 - 6 - button / 2, y: ISLAND_ANCHOR.y - 6 - 16 };
}
