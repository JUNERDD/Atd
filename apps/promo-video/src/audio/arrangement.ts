/**
 * The score's form: which part of the arrangement each bar plays, on which chord, and how each
 * part feels. Every boundary is read from the film's sections and beats, so moving a section on
 * the timeline moves the music with it.
 *
 * The key is D major: its open, ringing fifths (D and A) suit the glass bells and the light, and the
 * effects' pentatonic voices sit on the same notes.
 */
import { at, BAR, CHOREO, DURATION, SECTIONS } from '../timeline.ts';

export interface Chord {
  root: number;
  pad: number[];
  arp: number[];
  /** The ninth, rung by the bells on downbeats. */
  ninth: number;
}

const D: Chord = { root: 38, pad: [50, 57, 61, 64, 66], arp: [62, 66, 69, 73, 76], ninth: 76 };
const BM: Chord = { root: 35, pad: [47, 54, 57, 61, 62], arp: [59, 62, 66, 69, 73], ninth: 73 };
const G: Chord = { root: 31, pad: [43, 50, 54, 57, 61], arp: [55, 62, 66, 69, 74], ninth: 81 };
const A: Chord = { root: 33, pad: [45, 52, 54, 59, 61], arp: [57, 61, 64, 66, 71], ninth: 71 };

/**
 * The arrangement's parts: the intro under the keys and the mark, the drop into "Anywhere", the
 * lift into "Anything", the night breakdown, its dawn, the beat coming back for memory, the build
 * under the models, the finale and the last chord ringing.
 */
export type Part =
  | 'intro'
  | 'drop'
  | 'lift'
  | 'night'
  | 'dawn'
  | 'memory'
  | 'build'
  | 'finale'
  | 'ring';

export type Drums = 'none' | 'light' | 'drive' | 'half' | 'return' | 'build' | 'full' | 'last';

interface Feel {
  /** Pad level and its low-pass cutoff from the part's first bar to its last. */
  pad: number;
  padCutoff: [number, number];
  pluck: 'none' | 'eighths' | 'sixteenths';
  pluckGain: number;
  /** A low-pass over the plucks, opening across the part; at 8 kHz and above it is left off. */
  pluckTone: [number, number];
  drums: Drums;
}

export const FEEL: Record<Part, Feel> = {
  intro: {
    pad: 0.1,
    padCutoff: [700, 1900],
    pluck: 'eighths',
    pluckGain: 0.075,
    pluckTone: [1000, 4200],
    drums: 'none',
  },
  drop: {
    pad: 0.078,
    padCutoff: [1600, 1800],
    pluck: 'sixteenths',
    pluckGain: 0.1,
    pluckTone: [5000, 6500],
    drums: 'light',
  },
  lift: {
    pad: 0.095,
    padCutoff: [2100, 2400],
    pluck: 'sixteenths',
    pluckGain: 0.125,
    pluckTone: [9000, 9000],
    drums: 'drive',
  },
  night: {
    pad: 0.095,
    padCutoff: [900, 1050],
    pluck: 'eighths',
    pluckGain: 0.06,
    pluckTone: [850, 1100],
    drums: 'half',
  },
  dawn: {
    pad: 0.095,
    padCutoff: [1050, 2100],
    pluck: 'eighths',
    pluckGain: 0.07,
    pluckTone: [1200, 3200],
    drums: 'half',
  },
  memory: {
    pad: 0.085,
    padCutoff: [1700, 1900],
    pluck: 'sixteenths',
    pluckGain: 0.085,
    pluckTone: [2600, 3400],
    drums: 'return',
  },
  build: {
    pad: 0.085,
    padCutoff: [1300, 3200],
    pluck: 'sixteenths',
    pluckGain: 0.1,
    pluckTone: [1800, 6500],
    drums: 'build',
  },
  finale: {
    pad: 0.095,
    padCutoff: [2300, 2300],
    pluck: 'sixteenths',
    pluckGain: 0.125,
    pluckTone: [9000, 9000],
    drums: 'full',
  },
  ring: {
    pad: 0.09,
    padCutoff: [1900, 1900],
    pluck: 'none',
    pluckGain: 0,
    pluckTone: [9000, 9000],
    drums: 'last',
  },
};

/** The bar a moment falls in. */
export function barOf(seconds: number): number {
  return Math.floor(seconds / BAR + 1e-6);
}

/** The bar the final chord lands on: the last downbeat before the picture starts to fade. */
export const RING_START = barOf(at('finale', CHOREO.finale.fade)) * BAR;

/**
 * Each part's first bar and its chord loop. The intro and the drop walk D, Bm, G, A and land on
 * the A so the next part resolves home; the lift starts on G for a brighter climb; the night sits
 * on Bm and G, dawn on A, memory back on D.
 */
const PLAN: [Part, number, Chord[]][] = [
  ['intro', barOf(SECTIONS.open.start), [D, BM, G, A]],
  ['drop', barOf(SECTIONS.anywhere.start), [D, BM, G, A]],
  ['lift', barOf(SECTIONS.anything.start), [G, A, BM, D]],
  ['night', barOf(SECTIONS.anytime.start), [BM, G]],
  ['dawn', barOf(at('anytime', CHOREO.anytime.timelapse.dawn)), [A]],
  ['memory', barOf(at('anytime', CHOREO.anytime.memory.start)), [D, BM]],
  ['build', barOf(SECTIONS.yours.start), [G, A]],
  ['finale', barOf(SECTIONS.finale.start), [D, BM, G]],
  ['ring', barOf(RING_START), [D]],
];

export interface BarPlan {
  bar: number;
  /** In seconds. */
  start: number;
  part: Part;
  chord: Chord;
  /** The bar's place in its part, from 0, and the part's length in bars. */
  nth: number;
  count: number;
  /** The part after this one; the last beat before a drop is left empty so the hit lands. */
  next: Part | undefined;
}

/** The parts that land on their first downbeat, and want a beat of air before it. */
const HITS: ReadonlySet<Part> = new Set(['drop', 'lift', 'finale', 'ring']);

export function plan(): BarPlan[] {
  const bars = Math.round(DURATION / BAR);
  const out: BarPlan[] = [];
  PLAN.forEach(([part, from, chords], index) => {
    const following = PLAN[index + 1];
    const until = following ? following[1] : bars;
    for (let bar = from; bar < until; bar++) {
      const nth = bar - from;
      const chord = chords[nth % chords.length] ?? D;
      out.push({
        bar,
        start: bar * BAR,
        part,
        chord,
        nth,
        count: until - from,
        next: following?.[0],
      });
    }
  });
  return out;
}

/** Whether a bar's last beat is the breath before a part that hits. */
export function breathes(bar: BarPlan): boolean {
  return bar.nth === bar.count - 1 && bar.next !== undefined && HITS.has(bar.next);
}

/** The finale's bell line, one bar per chord: [bar, beat, note, beats held]. */
export const MELODY: [number, number, number, number][] = [
  [0, 0, 78, 1],
  [0, 1, 81, 1],
  [0, 2, 76, 2],
  [1, 0, 74, 1],
  [1, 1, 78, 1],
  [1, 2, 73, 2],
  [2, 0, 71, 1],
  [2, 1, 74, 1],
  [2, 2, 81, 1],
  [2, 3, 78, 1],
];

/** The final chord, rung on the bells over the held pad. */
export const LAST_CHORD = [74, 78, 81, 86];
