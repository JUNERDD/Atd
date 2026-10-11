/**
 * The open section's beats, in seconds from its start (bar 0 on the film's clock; the section is
 * bars 0–3, 0–7.2 s), snapped to the 0.15 s grid except the typing streams. Pure and DOM-free, so
 * the score reads the same times: `openKeystrokes(lang)` gives every keystroke the picture types.
 *
 * Bar 0 is the caret alone, blinking as the grid fades in, then the rough line pouring out of it;
 * bar 1 selects the line and rewrites it in place at the app's own write-back pace, leaving it to
 * be read; bar 2's downbeat is the drop (the title slams in); bar 2's last beat is the caret wipe
 * into the Stage.
 */
import type { Lang } from '../../../copy.ts';
import { bars, beats, FPS, steps } from '../../timeline.ts';
import { typeTimes, type TypePace } from '../../world/typing.ts';
import { content } from './content.ts';

const WIPE = bars(3) - beats(1);
const LAST = bars(3) - 1 / FPS;

export const OPEN_BEATS = {
  /** The first frame: black, the caret already blinking on beat 1 at the frame's center. */
  start: 0,
  /** The grid and the ink lift out of black over half a bar. */
  gridIn: 0,
  gridLength: bars(0.5),
  /** The caret's idle blinks before it types (each a soft pulse ring in the dots). */
  blinks: [0, beats(1)],
  /**
   * The rough line starts typing on the "and" of beat 2 (stream: see `OPEN_TYPING.rough`) and is
   * done by ~2.5 s, leaving a breath before the selection.
   */
  rough: steps(6),
  /** Bar 1, beat 2: a drag selection sweeps the line in the coral wash. */
  select: beats(5),
  selectLength: steps(3),
  /**
   * Bar 1, beat 3: the selection is replaced, the polished line typed at the shipped pace; it
   * then reads for a beat and a half before the drop.
   */
  retype: beats(6),
  /** The DROP, bar 2's downbeat: "Atd" slams in, the line leaves, a white ring floods the dots. */
  drop: bars(2),
  /** "0.8" slams in a sixteenth after "Atd" (a second, lighter ring from its center). */
  version: bars(2) + steps(1),
  /** Bar 2, beat 2: the title line is typed under the title. */
  titleLine: beats(9),
  /**
   * Bar 2, beat 4: the caret wipe sets off. It completes on the section's last frame (one frame
   * short of the beat), which therefore already shows `writeback`'s first frame (boundary contract
   * v1: the outgoing scene ends exactly on the incoming one's first picture).
   */
  wipe: WIPE,
  /** Measured to the last frame itself, so the sweep's progress is exactly 1 there. */
  wipeLength: LAST - WIPE,
  /** The section's last frame (the incoming picture, at its own t = 0) and its end, the cut. */
  last: LAST,
  end: bars(3),
} as const;

/** How one typed stream runs: from `at` at `pace`, with `seed` varying a person's rhythm. */
export interface TypeSpec {
  at: number;
  pace: TypePace;
  seed: number;
}

/**
 * Each typed stream, per language (Chinese types fewer, wider graphemes, so slower per grapheme).
 * The polished line runs at the app's shipped write-back pace in both.
 */
export const OPEN_TYPING = {
  en: {
    rough: { at: OPEN_BEATS.rough, pace: 20, seed: 2 },
    polished: { at: OPEN_BEATS.retype, pace: 'shipped', seed: 0 },
    titleLine: { at: OPEN_BEATS.titleLine, pace: 16, seed: 2 },
  },
  zh: {
    rough: { at: OPEN_BEATS.rough, pace: 7, seed: 2 },
    polished: { at: OPEN_BEATS.retype, pace: 'shipped', seed: 0 },
    titleLine: { at: OPEN_BEATS.titleLine, pace: 6, seed: 2 },
  },
} as const satisfies Record<Lang, Record<'rough' | 'polished' | 'titleLine', TypeSpec>>;

/** A stream's keystroke times, exactly as the picture types them. */
export function streamTimes(text: string, spec: TypeSpec): number[] {
  return typeTimes(text, spec.at, spec.pace, spec.seed);
}

/**
 * Every keystroke of the open, per stream, in section-local seconds: for the score's typing
 * ticks (`rough` by a person, `polished` the app writing back, `titleLine` by a person).
 */
export function openKeystrokes(lang: Lang): Record<'rough' | 'polished' | 'titleLine', number[]> {
  const c = content[lang];
  const typing = OPEN_TYPING[lang];
  return {
    rough: streamTimes(c.rough, typing.rough),
    polished: streamTimes(c.polished, typing.polished),
    titleLine: streamTimes(c.titleLine, typing.titleLine),
  };
}
