/**
 * What every section's cues share: how far a cue must sit over the music at a moment (the level
 * curve `createCues` reads), the two kinds of writing (a person's keystrokes against the app's
 * write-back glitter) and the chimes, tuned to whatever chord the score is playing.
 */
import type { Cues } from '../../../audio/cue-bus.ts';
import { bars, RELEASE_DURATION, RELEASE_SECTIONS } from '../../timeline.ts';
import { chime, grain, keystroke } from '../effects/ui.ts';
import { chordAt } from '../music/harmony.ts';

/**
 * How far cues sit over the music from each moment on, [from seconds, level]: at face value over
 * the open's sparse bed, lifted once the drop's groove comes in, more under the grooves and the
 * build, and just over the breakdown's and the finale's lighter textures.
 */
const OVER_THE_MUSIC: readonly (readonly [number, number])[] = [
  [0, 1],
  [RELEASE_SECTIONS.open.start + bars(2), 1.8],
  [RELEASE_SECTIONS.writeback.start, 2.2],
  [RELEASE_SECTIONS.choose.start, 1.6],
  [RELEASE_SECTIONS.yours.start, 2.2],
  [RELEASE_SECTIONS.everything.start, 2.3],
  [RELEASE_SECTIONS.finale.start, 1.5],
];

/** A cue that leads into a change by less than this takes the level it leads into. */
const LEAD_IN = 0.2;

/** The level curve for `createCues`: a multiplier on a cue's gain at `at` seconds. */
export function levelAt(at: number): number {
  const time = Math.min(RELEASE_DURATION - 1e-6, at + LEAD_IN);
  let level = 1;
  for (const [from, value] of OVER_THE_MUSIC) if (time >= from) level = value;
  return level;
}

/** The chord root sounding at `at`, as a MIDI note at or above `low`. */
export function rootAbove(at: number, low: number): number {
  const pitchClass = chordAt(at).root % 12;
  return low + ((pitchClass - (low % 12) + 12) % 12);
}

/**
 * A person typing: one keystroke per time, each a little different, panned near `position`.
 * Times may repeat (graphemes typed together) and are sounded once.
 */
export function typing(
  cues: Cues,
  times: readonly number[],
  offset: number,
  gain: number,
  position = 0,
): void {
  for (const at of distinct(times)) {
    const voice = keystroke(cues.random, 0.9 + 0.2 * cues.random());
    const accent = 0.75 + 0.25 * cues.random();
    cues.place(voice, offset + at, gain * accent, position + 0.1 * (cues.random() - 0.5), 0.06);
  }
}

/** E major pentatonic from E5 up: the write-back's glitter climbs through it. */
const GLITTER = [76, 78, 80, 83, 85, 88, 90, 92, 95, 97];

/**
 * The app writing back: a grain per pasted chunk, climbing the pentatonic as the answer fills in
 * and drifting from `from` to `to` across the field. Lighter, faster and brighter than typing.
 */
export function writeBack(
  cues: Cues,
  times: readonly number[],
  offset: number,
  gain: number,
  [from, to]: readonly [number, number] = [-0.25, 0.25],
): void {
  const chunks = distinct(times);
  const span = Math.max(1, chunks.length - 1);
  chunks.forEach((at, index) => {
    const p = index / span;
    const step = Math.min(GLITTER.length - 1, Math.floor(p * 6 + (index % 2) * 1.5));
    const voice = grain(GLITTER[step] ?? 88, cues.random);
    cues.place(voice, offset + at, gain * (0.7 + 0.3 * p), from + (to - from) * p, 0.35);
  });
}

/** "Written": two notes rising a fourth onto the chord's root, bright and short. */
export function written(cues: Cues, at: number, gain: number, position = 0): void {
  const root = rootAbove(at, 83);
  cues.place(chime([root - 5, root]), at, gain, position, 0.45);
}

/** "Copied", lighter than Written: the root and its fifth above, struck almost together. */
export function copied(cues: Cues, at: number, gain: number, position = 0): void {
  const root = rootAbove(at, 83);
  cues.place(chime([root, root + 7], 0.04, 0.3), at, gain, position, 0.4);
}

/** A list's times with consecutive repeats removed. */
export function distinct(times: readonly number[]): number[] {
  return times.filter((time, index) => index === 0 || time !== times[index - 1]);
}
