/**
 * The release score's harmony and hook. It lives in C♯ minor and lifts to E major, its relative
 * major, for the finale: the same notes, a new home. The minor loop is i–VI–III–VII (C♯m9, Amaj9,
 * Eadd9, B6/9); the breakdown brightens to Amaj9, E/G♯, F♯m9, Bsus; the finale lands on E after a
 * IV–V turn and rings on Emaj9.
 *
 * The hook is two bars for the pulse lead: a syncopated climb up the C♯ minor triad (3+3+2 on the
 * sixteenths) that falls back a step at a time, then an answer that settles on C♯. In the finale the
 * answer turns upward instead and resolves on G♯, the major third of E: the lift.
 */
import { bars, BEAT, STEP } from '../../timeline.ts';

export interface Chord {
  name: string;
  /** The bass note (MIDI), in the sub's register. */
  root: number;
  /** The electric piano's and the pad's voicing (MIDI), near middle C. */
  voicing: readonly number[];
  /** Chord tones an octave or so above the voicing, for the plucked arpeggios. */
  arp: readonly number[];
}

const CSM9: Chord = {
  name: 'C♯m9',
  root: 37,
  voicing: [61, 64, 68, 71, 75],
  arp: [68, 71, 73, 75, 76, 80],
};
const AMAJ9: Chord = {
  name: 'Amaj9',
  root: 33,
  voicing: [57, 61, 64, 68, 71],
  arp: [68, 69, 71, 73, 76, 80],
};
const EADD9: Chord = {
  name: 'Eadd9',
  root: 40,
  voicing: [59, 64, 66, 68, 71],
  arp: [66, 68, 71, 76, 78, 80],
};
const B69: Chord = {
  name: 'B6/9',
  root: 35,
  voicing: [59, 63, 66, 68, 73],
  arp: [66, 68, 71, 73, 75, 78],
};
const E_G_SHARP: Chord = { ...EADD9, name: 'E/G♯', root: 44 };
const FSM9: Chord = {
  name: 'F♯m9',
  root: 42,
  voicing: [57, 61, 64, 68, 69],
  arp: [66, 68, 69, 73, 76, 80],
};
const BSUS: Chord = {
  name: 'Bsus4',
  root: 35,
  voicing: [59, 64, 66, 71, 73],
  arp: [66, 71, 73, 76, 78, 83],
};
/** The last chord: Emaj9 with the low E doubled, ringing from bar 24 to the end. */
export const LAST_CHORD: Chord = {
  name: 'Emaj9',
  root: 40,
  voicing: [52, 59, 63, 66, 68, 71],
  arp: [68, 71, 75, 78, 80, 83],
};

/** A chord change: the bar, the beat within it it lands on, and the chord. */
type Change = readonly [bar: number, beat: number, chord: Chord];

/** Every chord change in the film, bar by bar (see the handoff's form table). */
const CHANGES: readonly Change[] = [
  [0, 0, CSM9], // open: the bed under the caret
  [2, 0, CSM9], // the drop: hook call
  [3, 0, AMAJ9], // writeback: hook answer
  [4, 0, EADD9],
  [5, 0, B69],
  [6, 0, AMAJ9], // destinations montage
  [7, 0, B69],
  [8, 0, CSM9], // choose: tap; the hook returns
  [9, 0, AMAJ9], // hold
  [10, 0, EADD9],
  [11, 0, B69], // where it goes
  [12, 0, AMAJ9],
  [12, 2, B69],
  [13, 0, AMAJ9], // yours: lighter
  [14, 0, E_G_SHARP],
  [15, 0, FSM9],
  [16, 0, BSUS],
  [16, 2, B69],
  [17, 0, CSM9], // everything: the build
  [18, 0, AMAJ9],
  [19, 0, EADD9],
  [20, 0, B69],
  [21, 0, AMAJ9],
  [21, 2, B69],
  [22, 0, EADD9], // finale: the hit lands on E
  [23, 0, AMAJ9],
  [23, 2, B69],
  [24, 0, LAST_CHORD], // rings to the end
];

/** A chord as it sounds: from `start` for `seconds`. */
export interface Span {
  chord: Chord;
  start: number;
  seconds: number;
  bar: number;
}

/** Every chord span in order; the last one runs to `end`. */
export function spans(end: number): Span[] {
  return CHANGES.map(([bar, beat, chord], index) => {
    const start = bars(bar) + beat * BEAT;
    const next = CHANGES[index + 1];
    const until = next ? bars(next[0]) + next[1] * BEAT : end;
    return { chord, start, seconds: until - start, bar };
  });
}

/** The chord sounding at a time. */
export function chordAt(seconds: number): Chord {
  let chord = CSM9;
  for (const [bar, beat, next] of CHANGES) {
    if (bars(bar) + beat * BEAT <= seconds + 1e-9) chord = next;
  }
  return chord;
}

/** A hook note on the sixteenth grid: first step, length in steps, MIDI note. */
type HookNote = readonly [step: number, steps: number, note: number];

/** Bar one: the climb (C♯ E G♯, 3+3+2) and the fall back to E, with a D♯ pickup. */
const CALL: readonly HookNote[] = [
  [0, 3, 73],
  [3, 3, 76],
  [6, 2, 80],
  [8, 2, 78],
  [10, 4, 76],
  [14, 2, 75],
];
/** Bar two in minor: E held, a drop to B, home on C♯. */
const ANSWER: readonly HookNote[] = [
  [16, 6, 76],
  [22, 2, 71],
  [24, 8, 73],
];
/** Bar three over E: the same rhythm from B, climbing to the phrase's peak on B and leaning on A. */
const CALL_HIGH: readonly HookNote[] = [
  [0, 3, 71],
  [3, 3, 76],
  [6, 2, 80],
  [8, 2, 83],
  [10, 4, 80],
  [14, 2, 81],
];
/** Bar four over B: the A falls to F♯, held, then C♯ and D♯ leave the phrase open. */
const ANSWER_OPEN: readonly HookNote[] = [
  [16, 6, 78],
  [22, 2, 73],
  [24, 8, 75],
];
/** The finale's answer: E, B, then up through D♯ and F♯ to G♯ on the last chord. */
const RESOLVE: readonly HookNote[] = [
  [16, 6, 76],
  [22, 2, 71],
  [24, 4, 75],
  [28, 4, 78],
  [32, 24, 80],
];

/** The hook's phrases: the two-bar statement, its four-bar extension, and the resolution. */
export const HOOK = {
  statement: [...CALL, ...ANSWER],
  phrase: [...CALL, ...ANSWER, ...shift(CALL_HIGH, 32), ...shift(ANSWER_OPEN, 32)],
  finale: [...CALL, ...RESOLVE],
} as const;

function shift(notes: readonly HookNote[], steps: number): HookNote[] {
  return notes.map(([step, length, note]) => [step + steps, length, note]);
}

/** A hook phrase as timed notes from `start` seconds (lengths a touch short so notes articulate). */
export function hookNotes(phrase: readonly HookNote[], start: number, legato = 0.92) {
  return phrase.map(([step, length, note]) => ({
    at: start + step * STEP,
    length: length * STEP * legato,
    note,
  }));
}
