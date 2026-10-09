/**
 * The film's one clock. Every scene and every sound is placed on this timeline, in seconds, and the
 * soundtrack script reads the same module, so a keystroke's click lands on the frame its dot lights
 * and each cut falls on the score's downbeat (120 BPM: a beat every 0.5 s, a bar every 2 s).
 *
 * Pure and DOM-free, so Node can run it under type stripping.
 */
import { typingSeconds } from './dots/typing.ts';

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;

/** Thirty bars. */
export const DURATION = 30 * BAR;

export function toFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

/** The LED display the film opens on: the name, then what it stands for. */
export const DISPLAY_WORDS = ['Atd', 'Anything', 'Anytime', 'Anywhere'] as const;

export const INTRO = {
  start: 0,
  /** Each change starts on a downbeat and types at the website hero's pace. */
  changes: [
    { at: 2, from: 'Atd', to: 'Anything' },
    { at: 4, from: 'Anything', to: 'Anytime' },
    { at: 6, from: 'Anytime', to: 'Anywhere' },
  ],
  /** The tagline rises under the display once the last word is typed. */
  tagline: 6 + typingSeconds('Anytime', 'Anywhere') - 0.25,
  /** The word dissolves, leaving its block cursor... */
  dissolve: 8.5,
  /** ...which opens into the Mac's screen, settled before the beat drops at 10 s. */
  morph: 8.95,
  morphLength: 0.9,
} as const;

/** The interface scenes, in order, two bars each on the one desktop. */
export const CASE_IDS = [
  'summon',
  'chat',
  'selection',
  'screenshot',
  'mini',
  'models',
  'apps',
  'automations',
] as const;

export type CaseId = (typeof CASE_IDS)[number];

export const CASE_LENGTH = 2 * BAR;
export const CASES_START = 10;

export function caseStart(id: CaseId): number {
  return CASES_START + CASE_IDS.indexOf(id) * CASE_LENGTH;
}

/** The screen card's life: from the cursor's morph until it falls back behind the features. */
export const STAGE = {
  start: INTRO.morph,
  end: CASES_START + CASE_IDS.length * CASE_LENGTH + 0.45,
  /** When the card starts to fall back, before the last case ends. */
  exit: CASES_START + CASE_IDS.length * CASE_LENGTH - 0.35,
} as const;

/**
 * Each case's beats, in seconds from its start. The scene animates these moments and the
 * soundtrack sounds them.
 */
export const CHOREO = {
  summon: { keys: [0.12, 0.27, 0.42], panel: 0.55, welcome: 1.05 },
  chat: { earlier: 0.2, ask: 0.7, status: 1.25, tools: 1.5, answer: 1.75, actions: 2.75 },
  selection: { page: 0.15, highlight: 0.75, toolbar: 1.35 },
  screenshot: {
    windows: 0.05,
    dim: 0.4,
    select: 0.6,
    bars: 1.1,
    steps: [1.3, 1.55, 1.8],
    mosaic: 2.05,
    hint: 2.3,
    capture: 3.05,
  },
  mini: { rail: 0.15, menu: 0.6, pointer: 0.7, click: 2.0 },
  models: { window: 0.05, rows: 0.4 },
  apps: { list: 0.1, launch: 1.15 },
  automations: { window: 0.05, rows: 0.4 },
} as const satisfies Record<CaseId, unknown>;

/**
 * The feature cells, one per capability on the website (`cells`), then the privacy promise, whose
 * ring lights on its downbeat.
 */
export const FEATURES = { start: 42, end: 46, tiles: 0.35, stagger: 0.14, cells: 5 } as const;
export const PRIVACY = { start: 46, end: 50, ring: 0.04, nevers: [1.2, 1.5, 1.8] } as const;

/** The display powers on again for the call to action, and the film holds on it. */
export const OUTRO = {
  start: 50,
  end: DURATION,
  /** In seconds from the outro's start. */
  title: 1.5,
  keys: [2.3, 2.45, 2.6],
  button: 2.9,
  /** The picture fades out over the last beats as the final chord rings. */
  fade: DURATION - 1.2,
} as const;
