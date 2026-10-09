/**
 * The pace of a word change on the LED display, as a person at a keyboard would make it: backspace
 * pressed once, then held so it repeats, a beat on the empty line, then the next word typed with the
 * uneven rhythm of real keystrokes. All in seconds. The values match the website hero
 * (apps/website/src/gl/typing.ts), so the film's display types like the page's.
 *
 * Pure and DOM-free: the soundtrack script reads the same schedule to place each key's click.
 */

/** Before the first backspace lands: the cursor stops blinking and the press begins. */
const ERASE_LEAD = 0.08;
/** A held key's delay before it starts repeating, then the repeat interval. */
const REPEAT_DELAY = 0.2;
const REPEAT_STEP = 0.045;
/** The empty line's beat before the next word starts. */
const PAUSE = 0.3;
/** A keystroke's mean interval and how far a single one strays from it, as a share. */
const TYPE_STEP = 0.09;
const TYPE_SPREAD = 0.5;
/** The finished word holds this long with a steady cursor before it starts to blink. */
const LAND = 0.12;

/** The cursor blinks on and off every this many seconds while a word rests. */
export const CURSOR_BLINK = 0.53;

function charsOf(word: string): string[] {
  return Array.from(word);
}

/** A steady 0–1 roll per word and keystroke, so every render types a word with the same rhythm. */
function roll(word: string, index: number): number {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  hash = Math.imul(hash ^ (index + 1), 2654435761);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}

/** When each character of the outgoing word goes, last first, from the change's start. */
function eraseTimes(count: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? ERASE_LEAD : ERASE_LEAD + REPEAT_DELAY + (i - 1) * REPEAT_STEP,
  );
}

/** When each character of the incoming word appears, first first, from its first keystroke. */
function typeTimes(word: string): number[] {
  const times: number[] = [];
  let at = 0;
  charsOf(word).forEach((_, i) => {
    if (i > 0) at += TYPE_STEP * (1 + TYPE_SPREAD * (2 * roll(word, i) - 1));
    times.push(at);
  });
  return times;
}

/** When typing starts: after the last backspace and the beat on the empty line. */
function typeStart(from: string): number {
  const erase = eraseTimes(charsOf(from).length);
  return (erase[erase.length - 1] ?? 0) + PAUSE;
}

/** How long a change from `from` to `to` takes, start to landing. */
export function typingSeconds(from: string, to: string): number {
  const typed = typeTimes(to);
  return typeStart(from) + (typed[typed.length - 1] ?? 0) + LAND;
}

/** Every key press of a change, from its start: backspaces first, then the new word's keys. */
export function keystrokeTimes(from: string, to: string): { erase: number[]; type: number[] } {
  const start = typeStart(from);
  return {
    erase: eraseTimes(charsOf(from).length),
    type: typeTimes(to).map((at) => start + at),
  };
}

export interface TypingFrame {
  /** The word on the board is the incoming one (the outgoing has been erased). */
  incoming: boolean;
  /** Characters of that word showing, from its first. */
  shown: number;
}

/** The board `seconds` into a change from `from` to `to`. */
export function typingAt(seconds: number, from: string, to: string): TypingFrame {
  const count = charsOf(from).length;
  const start = typeStart(from);
  if (seconds < start - PAUSE) {
    const erased = eraseTimes(count).filter((at) => seconds >= at).length;
    return { incoming: false, shown: count - erased };
  }
  if (seconds < start) return { incoming: true, shown: 0 };
  return { incoming: true, shown: typeTimes(to).filter((at) => seconds - start >= at).length };
}
