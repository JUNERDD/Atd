/**
 * The release score's form, bar by bar: which groove the drums play and how loud each layer is.
 * The film's sections (`RELEASE_SECTIONS` in `timeline.ts`) set the arc: a sparse open with the caret's pulse, the
 * drop at bar 2, groove A under the write-back, groove B with hold charges under choose, a lighter
 * breakdown for yours, a build through everything with a riser into bar 22, and the finale's hit,
 * hook and ringing chord. The one-off gestures (pulses, charges, swells, hits) are in `gestures.ts`.
 */
/** The drum patterns `drums.ts` knows. */
export type Groove = 'none' | 'a' | 'b' | 'light' | 'lift' | 'four' | 'roll' | 'last';

/** How the electric piano plays: off, offbeat stabs, a syncopated comp, or held chords. */
export type Keys = 'none' | 'stabs' | 'comp' | 'held';
/** How the plucked string plays: off, eighth arpeggios, sixteenth arpeggios, or the hook. */
export type Strings = 'none' | 'eighths' | 'sixteenths' | 'hook';
/** How the sub plays: off, one long note per chord, or locked to the kick. */
export type Bass = 'none' | 'long' | 'locked';

export interface Feel {
  groove: Groove;
  /** The pad's level and its cutoff across the bar, in Hz. */
  pad: number;
  padCutoff: readonly [number, number];
  keys: Keys;
  keysLevel: number;
  strings: Strings;
  stringsLevel: number;
  bass: Bass;
  bassLevel: number;
  /** Typing ticks on the sixteenths between the hats, 0 for none. */
  ticks: number;
}

const QUIET: Feel = {
  groove: 'none',
  pad: 0,
  padCutoff: [900, 900],
  keys: 'none',
  keysLevel: 0,
  strings: 'none',
  stringsLevel: 0,
  bass: 'none',
  bassLevel: 0,
  ticks: 0,
};

/** Groove A: the write-back's walk. Kick on 1, the "and" of 2 and the "e" of 3; comped keys. */
const GROOVE_A: Feel = {
  groove: 'a',
  pad: 0.075,
  padCutoff: [1400, 1900],
  keys: 'comp',
  keysLevel: 0.12,
  strings: 'none',
  stringsLevel: 0,
  bass: 'locked',
  bassLevel: 0.22,
  ticks: 0.045,
};

/** Groove B: choose's drive. Busier kick, open hats, sixteenth strings. */
const GROOVE_B: Feel = {
  ...GROOVE_A,
  groove: 'b',
  padCutoff: [1700, 2400],
  keys: 'stabs',
  keysLevel: 0.11,
  strings: 'sixteenths',
  stringsLevel: 0.11,
  ticks: 0.05,
};

/** The breakdown: no kick drum pattern, held keys, eighth strings, shaker and ticks. */
const LIGHT: Feel = {
  groove: 'light',
  pad: 0.1,
  padCutoff: [1100, 1600],
  keys: 'held',
  keysLevel: 0.13,
  strings: 'eighths',
  stringsLevel: 0.11,
  bass: 'long',
  bassLevel: 0.16,
  ticks: 0.025,
};

/** The film's 25 bars. */
export const FORM: readonly Feel[] = [
  // open: the caret pulses over a dark bed; bar 1 retypes and rises into the drop.
  { ...QUIET, pad: 0.05, padCutoff: [500, 800] },
  { ...QUIET, pad: 0.06, padCutoff: [800, 1500], ticks: 0 },
  // bar 2: the drop, the hook's call.
  { ...GROOVE_A, groove: 'b', keys: 'stabs' },
  // writeback: groove A, the hook's answer and its extension, then the destinations montage.
  GROOVE_A,
  GROOVE_A,
  GROOVE_A,
  { ...GROOVE_A, strings: 'eighths', stringsLevel: 0.1 },
  { ...GROOVE_A, strings: 'eighths', stringsLevel: 0.11 },
  // choose: groove B; the hook returns over the tap and the hold.
  GROOVE_B,
  GROOVE_B,
  GROOVE_B,
  GROOVE_B,
  { ...GROOVE_B, groove: 'lift' },
  // yours: four lighter one-bar vignettes.
  LIGHT,
  LIGHT,
  LIGHT,
  { ...LIGHT, strings: 'sixteenths' },
  // everything: the hook on the strings, then layer on layer to the riser.
  {
    ...LIGHT,
    groove: 'a',
    pad: 0.07,
    keysLevel: 0.09,
    bass: 'locked',
    strings: 'hook',
    stringsLevel: 0.13,
  },
  { ...GROOVE_A, strings: 'hook', stringsLevel: 0.15, padCutoff: [1500, 2000] },
  { ...GROOVE_B, groove: 'four', padCutoff: [1800, 2600], keysLevel: 0.14, stringsLevel: 0.15 },
  {
    ...GROOVE_B,
    groove: 'four',
    pad: 0.09,
    padCutoff: [2200, 3200],
    keysLevel: 0.15,
    stringsLevel: 0.16,
  },
  {
    ...GROOVE_B,
    groove: 'roll',
    pad: 0.1,
    padCutoff: [2600, 4200],
    keysLevel: 0.17,
    stringsLevel: 0.18,
  },
  // finale: the hit on E, the hook resolving, the last chord ringing out.
  { ...GROOVE_B, padCutoff: [2400, 2600], keys: 'stabs' },
  { ...GROOVE_B, padCutoff: [2600, 3000], keys: 'stabs' },
  { ...QUIET, groove: 'last', pad: 0.08, padCutoff: [2600, 900], keys: 'held', keysLevel: 0.09 },
];
