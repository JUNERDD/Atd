/**
 * The 0.8 release film's one clock: 100 BPM, a beat every 0.6 s (36 frames), a sixteenth every
 * 0.15 s (9 frames), a bar every 2.4 s (144 frames), 25 bars in all. Every section starts on a bar
 * line; each scene's own beats live in its `beats.ts`, in seconds from its section's start, and the
 * score reads the same modules, so a keystroke lands on the frame its tick sounds.
 *
 * Pure and DOM-free, so Node can run it under type stripping.
 */
import { FPS } from '../timeline.ts';

export { FPS, HEIGHT, toFrames, WIDTH } from '../timeline.ts';

export const BPM = 100;
export const BEAT = 60 / BPM;
/** A sixteenth note: the grid scene beats snap to (typing streams excepted). */
export const STEP = BEAT / 4;
export const BAR = 4 * BEAT;

/** `n` bars in seconds, rounded to the frame so section edges are exact (3 bars is 7.2, not 7.1999…). */
export function bars(n: number): number {
  return Math.round(n * BAR * FPS) / FPS;
}

/** `n` beats in seconds, frame-exact. */
export function beats(n: number): number {
  return Math.round(n * BEAT * FPS) / FPS;
}

/** `n` sixteenths in seconds, frame-exact. */
export function steps(n: number): number {
  return Math.round(n * STEP * FPS) / FPS;
}

/** Snaps a time to the nearest sixteenth. */
export function snap(seconds: number): number {
  return steps(Math.round(seconds / STEP));
}

/** Twenty-five bars: 60 s, 3600 frames. */
export const RELEASE_DURATION = bars(25);

function section(first: number, last: number) {
  return { bars: [first, last] as const, start: bars(first), end: bars(last) };
}

/**
 * The film's sections, back to back on bar lines: the caret's hook and the title drop, the round
 * trip of an answer written back, how a run is chosen and where it goes, the settings that make it
 * yours, everything Atd already does, and the sign-off.
 */
export const RELEASE_SECTIONS = {
  open: section(0, 3),
  writeback: section(3, 8),
  choose: section(8, 13),
  yours: section(13, 17),
  everything: section(17, 22),
  finale: section(22, 25),
} as const;

export type ReleaseSectionId = keyof typeof RELEASE_SECTIONS;

/** The sections in film order. */
export const RELEASE_SECTION_IDS = Object.keys(RELEASE_SECTIONS) as ReleaseSectionId[];

/** A section's start on the film's clock, in seconds. */
export function sectionStart(id: ReleaseSectionId): number {
  return RELEASE_SECTIONS[id].start;
}

/** A section's length, in seconds. */
export function releaseSectionLength(id: ReleaseSectionId): number {
  return RELEASE_SECTIONS[id].end - RELEASE_SECTIONS[id].start;
}

/** The film-clock time of a section-local moment (how the score places a scene's beats). */
export function atRelease(id: ReleaseSectionId, localSeconds: number): number {
  return RELEASE_SECTIONS[id].start + localSeconds;
}

/** Which beat a time falls in, counted from 0 (sections start on bar lines, so local time works). */
export function beatIndex(seconds: number): number {
  return Math.floor(seconds / BEAT + 1e-9);
}

/** How far into its beat a time is, 0 → 1. */
export function beatPhase(seconds: number): number {
  const phase = seconds / BEAT - beatIndex(seconds);
  return Math.min(1, Math.max(0, phase));
}
