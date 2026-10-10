/**
 * The film's one clock. Every scene and every sound is placed on this timeline, in seconds, and the
 * soundtrack script reads the same module, so a click lands on the frame its button presses and
 * each cut falls on the score's downbeat (120 BPM: a beat every 0.5 s, a bar every 2 s).
 *
 * Pure and DOM-free, so Node can run it under type stripping.
 */

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;

/** Thirty-two bars. */
export const DURATION = 32 * BAR;

export function toFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * The film's sections, back to back, each cut on a downbeat: the shortcut that opens it, the three
 * chapters the name stands for, the models and the privacy promise, and the shortcut that closes it.
 */
export const SECTIONS = {
  open: { start: 0, end: 8 },
  anywhere: { start: 8, end: 24 },
  anything: { start: 24, end: 42 },
  anytime: { start: 42, end: 52 },
  yours: { start: 52, end: 56 },
  finale: { start: 56, end: DURATION },
} as const;

export type SectionId = keyof typeof SECTIONS;

export function sectionLength(id: SectionId): number {
  return SECTIONS[id].end - SECTIONS[id].start;
}

/** How long each chapter's word holds before the camera flies through it into the chapter. */
export const CHAPTER_TITLE = { in: 0, out: 1.4 } as const;

/**
 * Each section's beats, in seconds from the start of its section. The scenes animate these moments
 * and the soundtrack sounds them; a pair is a [start, end] span.
 */
export const CHOREO = {
  open: {
    /** ⌘, ⇧, Space. */
    keys: [1, 1.5, 2],
    bloom: 2,
    /** Two drops of light set off from opposite corners... */
    drops: 2.3,
    /** ...and lock into the Drops mark. */
    mark: 3.5,
    wordmark: 4.25,
    tagline: 5,
    exit: 7.4,
  },
  anywhere: {
    selection: {
      start: 1.4,
      /** The cursor drags across the paragraph. */
      drag: [2, 3],
      toolbar: 3.25,
      click: 4,
      panel: 4.25,
      /** The translation streams into the panel. */
      stream: [4.6, 5.8],
    },
    screenshot: {
      start: 6,
      /** The ⌘ ⇧ 2 hint, a key at a time. */
      keys: [6, 6.12, 6.24],
      freeze: 6.4,
      /** Element boxes snap under the gliding cursor. */
      hover: [6.8, 7.3, 7.8],
      /** A scroll grows the box to its parent card. */
      grow: 8.2,
      select: 8.6,
      toolbar: 9,
      spotlight: 9.4,
      steps: [9.8, 10.15],
      done: 10.6,
    },
    mini: {
      start: 11,
      /** The cursor picks a PDF up in Finder... */
      pickup: 11.3,
      /** ...the pill reaches for it and swells into the drop card... */
      magnet: 11.9,
      drop: 12.6,
      /** ...and squashes back to the edge. */
      settle: 13.1,
    },
    summon: {
      start: 14,
      /** ⌘, ⇧, Space. */
      keys: [14, 14.25, 14.5],
      panel: 14.6,
      /** The camera dives into the panel; the next chapter cuts in at the section's end. */
      dive: 15.2,
    },
  },
  anything: {
    work: {
      start: 1.5,
      typing: [1.5, 2.6],
      send: 2.75,
      plan: 3.1,
      subagents: 4,
      /** Tool cards stream in, one per beat. */
      tools: [4.3, 4.8, 5.3],
      approval: 5.8,
      allow: 6.3,
      answer: [6.8, 8],
      /** When each of the five todos ticks. */
      todos: [3.6, 4.6, 5.6, 6.6, 8],
      saved: 8.2,
    },
    app: {
      start: 9,
      typing: [9, 9.7],
      send: 9.8,
      build: 10,
      built: 11.2,
      /** The app's window springs out of the panel. */
      open: 11.5,
      /** Habit checks fill in. */
      use: [12, 12.4, 12.8],
      /** The cursor drags its card out onto the wallpaper, where it lands as a pin. */
      pin: 13.2,
      pinned: 14,
    },
    tools: {
      start: 14.5,
      /** A command, a skill and an automation, each made on request, slam in on the beat... */
      cards: [14.75, 15.5, 16.25],
      /** ...and each confirms this long after it lands. */
      confirm: 0.4,
      /** The camera pulls out with the automation card, into the night. */
      pullOut: 17,
    },
  },
  anytime: {
    timelapse: {
      start: 1.4,
      /** The clock runs from dusk to dawn over this span, the film's only linear motion. */
      clock: [1.4, 5.4],
      idle: 2.2,
      /** Files land in the watched folder. */
      files: [2.6, 3, 3.4, 3.8],
      run: 4.2,
      dawn: 5.2,
      notices: [5.5, 5.85],
    },
    memory: {
      start: 6.5,
      /** The user types the correction... */
      typing: [6.6, 7.3],
      /** ...and sends it. */
      correct: 7.45,
      remembered: 7.9,
      /** A later answer uses it on its own. */
      later: 8.7,
    },
  },
  yours: {
    marks: 0.2,
    local: 1.4,
    promise: 2.2,
    exit: 3.6,
  },
  finale: {
    keys: [0.5, 0.75, 1],
    /** The drops set off from the last key's light and lock into the mark. */
    drops: 1.05,
    mark: 1.3,
    wordmark: 2,
    line: 2.8,
    cta: 3.6,
    url: 4,
    specs: 4.4,
    /** The picture fades out over the last bars as the final chord rings. */
    fade: 6.8,
  },
} as const satisfies Record<SectionId, unknown>;

/** An absolute time on the film's clock for a beat in a section. */
export function at(section: SectionId, seconds: number): number {
  return SECTIONS[section].start + seconds;
}
