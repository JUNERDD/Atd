/**
 * The opening display's script: what the LED board shows at each moment of the intro, and where its
 * cursor stands when it opens into the screen.
 */
import type { FieldState } from '../../dots/field.ts';
import type { Box, FieldRaster, RasterSpec } from '../../dots/raster.ts';
import { typingAt, typingSeconds } from '../../dots/typing.ts';
import { clamp01, easeIn, ramp } from '../../motion/ease.ts';
import { DISPLAY_WORDS, HEIGHT, INTRO, WIDTH } from '../../timeline.ts';

export const INTRO_SPEC: RasterSpec = {
  width: WIDTH,
  height: HEIGHT,
  pitch: 14,
  words: DISPLAY_WORDS,
  box: { x: WIDTH * 0.07, y: HEIGHT * 0.15, width: WIDTH * 0.86, height: HEIGHT * 0.5 },
  fontFamily: "'Inter Variable'",
  fontWeight: 900,
};

/** The name has lit fully once the power-on sweep reaches its last dots. */
const NAME_LANDS = 1.4;

export function introState(t: number): FieldState {
  let word = 0;
  let shown = DISPLAY_WORDS[0].length;
  let typing = false;
  let settle = t - NAME_LANDS;
  for (const change of INTRO.changes) {
    if (t < change.at) break;
    const local = t - change.at;
    const frame = typingAt(local, change.from, change.to);
    const length = typingSeconds(change.from, change.to);
    word = DISPLAY_WORDS.indexOf(frame.incoming ? change.to : change.from);
    shown = frame.shown;
    typing = local < length;
    settle = local - length;
  }
  return {
    time: t,
    boot: t,
    word,
    shown,
    typing,
    settle,
    cursor: t >= INTRO.morph ? 'off' : t >= INTRO.dissolve - 0.25 ? 'steady' : 'blink',
    dissolve: clamp01((t - INTRO.dissolve) / 0.55),
    field: 0.13,
    art: 0.9,
  };
}

/** The dive: the board swells about its cursor as the word dissolves, as if moving into it. */
export function diveScale(t: number): number {
  return 1 + 0.42 * ramp(t, INTRO.dissolve, INTRO.morph + 0.5 - INTRO.dissolve, easeIn);
}

/** The last word's cursor, which the screen opens out of. */
export function finalCursor(raster: FieldRaster): Box {
  const last = raster.words[raster.words.length - 1];
  const box = last?.cursors[last.cursors.length - 1];
  if (!box) throw new Error('The display has no words.');
  return box;
}

/** That cursor as the dive has scaled it at time `t`: about its own center, so it stays put. */
export function cursorAt(raster: FieldRaster, t: number): Box {
  const box = finalCursor(raster);
  const scale = diveScale(t);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    x: cx - (box.width * scale) / 2,
    y: cy - (box.height * scale) / 2,
    width: box.width * scale,
    height: box.height * scale,
  };
}
