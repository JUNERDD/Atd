/**
 * The finale's beats, in seconds from its start (bar 22 on the film's clock; the section is bars
 * 22–25, 52.8–60 s), snapped to the 0.15 s grid except the typing streams. Pure and DOM-free, so
 * the score reads the same times: `finaleKeystrokes(lang)` gives every keystroke the picture types.
 *
 * Bar 22 opens on the hit: the section starts on the caret the `everything` tiles converged into
 * (`FINALE_ENTRY`), which flares, grows into the lockup's caret and types the mark and the
 * wordmark, then (Return) the tagline, the block gliding up to stay centered. Bar 23 brings the shortcut, pressed as a chord on its last
 * beat. Bar 24's downbeat is the last chord: the address is typed, the specs settle, and everything
 * resolves to black by 60.0 s with the caret the last light to go.
 */
import type { Lang } from '../../../copy.ts';
import { bars, beats, steps } from '../../timeline.ts';
import { typeTimes, type TypePace } from '../../world/typing.ts';
import { content } from './content.ts';

/**
 * The finale's first frame, which `everything` must end on exactly (boundary contract v1): the
 * default `<DotField t={0} />` (no pulses) and `<Caret t={0} solid x={x} y={y} height={height} />`,
 * a 120 px caret centered on the frame's center (its default width is 6 % of its height). `x`, `y`
 * are the caret's top-left in frame px, as `Caret` takes them.
 */
export const FINALE_ENTRY = {
  height: 120,
  width: 120 * 0.06,
  x: 960 - (120 * 0.06) / 2,
  y: 540 - 120 / 2,
} as const;

export const FINALE_BEATS = {
  /** The downbeat HIT, the contract frame: the converged caret, still. */
  hit: 0,
  /**
   * One frame after the downbeat (off the sixteenth grid so the first frame stays exactly the
   * contract picture): the caret flares, a white ring floods the dots, the field jolts.
   */
  impact: 1 / 60,
  /** A sixteenth later the caret grows into the lockup's caret (a coral ring follows). */
  grow: steps(1),
  /** Beat 2: the caret types the mark, its drops snapping together (a coral-and-cool glint). */
  mark: beats(1),
  /** The wordmark's three keystrokes on straight sixteenths: A, t, d. */
  word: [steps(6), steps(7), steps(8)],
  /** Beat 4: Return. The caret drops to the line below, centered, and the block glides up. */
  ret: beats(3),
  /** The tagline starts typing a sixteenth after Return (stream: see `FINALE_TYPING.line`). */
  line: beats(3) + steps(1),
  /** Bar 23, beat 3 and a half: the shortcut's keycaps rise, one after another. */
  keys: steps(26),
  /** Bar 23, beat 4: ⌘ ⇧ Space pressed as a chord, released three sixteenths later. */
  chord: beats(7),
  chordUp: beats(7) + steps(3),
  /** Bar 24's downbeat: the last chord rings; the caret moves down and types the address. */
  ring: bars(2),
  url: bars(2),
  /** The specs settle in under the address two sixteenths later. */
  specs: bars(2) + steps(2),
  /** Everything fades from here... */
  fade: steps(39),
  /** ...to black here, held to the end of the film. */
  black: steps(47),
  end: bars(3),
} as const;

/** How one typed stream runs: from `at` at `pace`, with `seed` varying a person's rhythm. */
export interface TypeSpec {
  at: number;
  pace: TypePace;
  seed: number;
}

/** The tagline and the address, per language (Chinese types fewer, wider graphemes). */
export const FINALE_TYPING = {
  en: {
    line: { at: FINALE_BEATS.line, pace: 17, seed: 2 },
    url: { at: FINALE_BEATS.url, pace: 18, seed: 1 },
  },
  zh: {
    line: { at: FINALE_BEATS.line, pace: 7, seed: 2 },
    url: { at: FINALE_BEATS.url, pace: 18, seed: 1 },
  },
} as const satisfies Record<Lang, Record<'line' | 'url', TypeSpec>>;

/** A stream's keystroke times, exactly as the picture types them. */
export function streamTimes(text: string, spec: TypeSpec): number[] {
  return typeTimes(text, spec.at, spec.pace, spec.seed);
}

/**
 * Every keystroke of the finale, per stream, in section-local seconds, for the score's typing
 * ticks: the mark (one key), the wordmark, the tagline and the address. The chord is
 * `FINALE_BEATS.chord` / `chordUp`.
 */
export function finaleKeystrokes(lang: Lang): Record<'mark' | 'word' | 'line' | 'url', number[]> {
  const c = content[lang];
  const typing = FINALE_TYPING[lang];
  return {
    mark: [FINALE_BEATS.mark],
    word: [...FINALE_BEATS.word],
    line: streamTimes(c.line, typing.line),
    url: streamTimes(c.url, typing.url),
  };
}
