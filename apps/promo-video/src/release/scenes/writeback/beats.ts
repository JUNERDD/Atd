/**
 * The writeback section's beats, in seconds from its start (bar 3 on the film's clock; the section
 * is bars 3–8, 7.2–19.2 s), snapped to the 0.15 s grid except the typing streams. Pure and
 * DOM-free, so the score reads the same times: `writebackKeystrokes(lang)` gives every chunk the
 * app types, `WRITEBACK_CLICKS` the pointer's presses, `WRITEBACK_ISLAND` the island's phases and
 * `WRITEBACK_MONTAGE` the montage's hits. `atRelease('writeback', t)` turns any of them into
 * film time.
 *
 * Bars 3–5 (local 0–7.2) are one round trip in a note: ⌥ held, a drag selects the rough
 * paragraph, the selection toolbar grows out of it, Polish writing is clicked, the camera follows
 * the answer down to the command island (Running → Writing…) and back up as the polished text
 * types into the note at the shipped pace, then pulls back for Written as the island collapses.
 * Bars 6–7 (local 7.2–12) cut through the three write-back destinations, half a bar each, then
 * the fallback for a field that cannot take text: the island grows into the answer card, its Copy
 * is clicked and it turns to "Copied"; that demo's selection floods the frame into the bare dot
 * field that `choose` opens on. (A "Copy to the clipboard" run is not light: it runs in the panel,
 * so the island never shows it; the answer card's Copy is the island's real "Copied".)
 */
import type { Lang } from '../../../copy.ts';
import { bars, beats, steps } from '../../timeline.ts';
import { typeTimes } from '../../world/typing.ts';
import { content } from './content.ts';

export const WRITEBACK_BEATS = {
  /** Frame 0 is the bare Stage the open's wipe revealed (camera at rest, Finder, no windows). */
  start: 0,
  /** The note's window fades up and the menu bar turns to its app; the camera sets off toward it. */
  windowIn: steps(1),
  push: steps(1),
  /** The ⌥ hint keycap appears by the pointer, then goes down as the pointer reaches the text. */
  optionHint: steps(6),
  optionDown: steps(7),
  /** Beat 3: the mouse goes down at the paragraph's start ("Select." lands with it). */
  dragDown: beats(2),
  /** The drag reaches the paragraph's end and the mouse comes up. */
  dragUp: steps(14),
  /** The toolbar grows out of the selection; ⌥ comes up with it. */
  toolbar: steps(15),
  /** The pointer settles on Polish writing, and clicks it on beat 6 ("Ask." lands). */
  hover: steps(19),
  click: beats(5),
  /** The toolbar is gone a moment after the click (it never takes the keyboard). */
  toolbarOut: beats(5) + steps(1),
  /** The camera's one continuous move: down to the island with the click. */
  cameraDown: beats(5),
  /** The island grows at the bottom centre: Running, the name shimmering. */
  island: steps(21),
  /** The answer is ready: Writing…; the camera heads back up to the note. */
  writing: steps(28),
  cameraUp: beats(7.5),
  /** Bar 5's downbeat: the polished text starts typing over the selection ("It writes back."). */
  type: bars(2),
  /** Written ✓ (a cool glint on the island); the camera pulls back to show note and island. */
  done: beats(9),
  cameraWide: beats(9),
  /** The island collapses 1.5 s after Written (`CommandProgressState.doneDuration`). */
  islandOut: beats(11.5),
  /** The round trip's words leave a sixteenth before the island, gone before the cut at 7.2. */
  wordsOut: steps(45),
  /** Bar 6's downbeat: the destinations montage (four half-bar hits, see `WRITEBACK_MONTAGE`). */
  destinations: bars(3),
  /**
   * The fallback demo's selection floods the frame from 11.55, solid at 11.75, cleared to the dots
   * by 11.95, so the section's last frames are the bare field.
   */
  flood: steps(77),
  floodLength: 0.2,
  floodRelease: 0.2,
  /** The section's end, the cut to `choose`. */
  end: bars(5),
} as const;

/** The write-back destinations, in the settings' order, each demonstrated for half a bar. */
export const DESTINATIONS = ['replaceSelection', 'insertAfterSelection', 'insertAtCursor'] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** The montage's demos: the three destinations, then the answer card for a field that can't take text. */
export const MONTAGE_DEMOS = [...DESTINATIONS, 'unwritten'] as const;
export type DemoId = (typeof MONTAGE_DEMOS)[number];

/** How long each demo holds, from its hit: half a bar (eight sixteenths). */
export const DEMO_LENGTH = bars(0.5);

/**
 * Each demo's hit (a hard cut on the half bar, its label rising with it), when it ends, and, for
 * the three destinations, when the answer starts typing at the shipped pace: two sixteenths after
 * the hit. The fallback types nothing; its answer card grows on the hit (`WRITEBACK_ISLAND`).
 */
export const WRITEBACK_MONTAGE = MONTAGE_DEMOS.map((id, index) => {
  // Counted in sixteenths from the section's start, so every time is frame-exact.
  const hit = 48 + 8 * index;
  return {
    id,
    at: steps(hit),
    type: id === 'unwritten' ? null : steps(hit + 2),
    until: steps(hit + 8),
  };
});

/**
 * The fallback demo: the island grows into the answer card on the hit (10.8), the pointer settles
 * on Copy (11.1) and clicks it on beat 19's "e" (11.25), and the card turns to "Copied".
 */
export const FALLBACK = {
  card: steps(72),
  hover: steps(74),
  copy: steps(75),
} as const;

/** The pointer's presses: down and up around the drag, the click on Polish writing, and Copy. */
export const WRITEBACK_CLICKS = [
  { at: WRITEBACK_BEATS.dragDown, kind: 'down' },
  { at: WRITEBACK_BEATS.dragUp, kind: 'up' },
  { at: WRITEBACK_BEATS.click, kind: 'click' },
  { at: FALLBACK.copy, kind: 'click' },
] as const;

/**
 * The island's phases (enter, morphs, exit) through the round trip, then the fallback demo's
 * answer card and its "Copied". `out` is where it starts to leave (0.18 s ease-in).
 */
export const WRITEBACK_ISLAND = {
  working: WRITEBACK_BEATS.island,
  writing: WRITEBACK_BEATS.writing,
  done: WRITEBACK_BEATS.done,
  out: WRITEBACK_BEATS.islandOut,
  card: FALLBACK.card,
  copied: FALLBACK.copy,
} as const;

/** The narrative words' landings: each lands on the beat its action happens. */
export const WRITEBACK_WORDS = {
  select: WRITEBACK_BEATS.dragDown,
  ask: WRITEBACK_BEATS.click,
  back: WRITEBACK_BEATS.type,
} as const;

/** The polished answer's chunk times, at the app's own write-back pace (4 characters / 20 ms). */
export function answerTimes(lang: Lang): number[] {
  return typeTimes(content[lang].note.polished, WRITEBACK_BEATS.type, 'shipped');
}

/** A demo's answer's chunk times, empty for the fallback (its answer shows on the card). */
export function demoTimes(lang: Lang, id: DemoId): number[] {
  const hit = WRITEBACK_MONTAGE.find((demo) => demo.id === id);
  if (!hit || hit.type === null) return [];
  return typeTimes(content[lang].montage.demos[id].answer, hit.type, 'shipped');
}

/** Distinct times in a list of per-grapheme times: one per chunk the app pastes. */
function chunks(times: readonly number[]): number[] {
  return times.filter((time, index) => index === 0 || time !== times[index - 1]);
}

/**
 * Every chunk the section types, per stream, in section-local seconds: for the score's typing
 * ticks. The app pastes four graphemes every 20 ms, so each entry is one paste (a tick), not one
 * key. The round trip's answer ends before `done` in both languages.
 */
export function writebackKeystrokes(lang: Lang): {
  answer: number[];
  demos: Record<Destination, number[]>;
} {
  return {
    answer: chunks(answerTimes(lang)),
    demos: {
      replaceSelection: chunks(demoTimes(lang, 'replaceSelection')),
      insertAfterSelection: chunks(demoTimes(lang, 'insertAfterSelection')),
      insertAtCursor: chunks(demoTimes(lang, 'insertAtCursor')),
    },
  };
}
