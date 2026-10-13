/**
 * When each character of a typed line appears, and how the caret blinks. Pure and DOM-free, so the
 * score can sound every keystroke the picture shows from the same call.
 *
 * Paces: a number is a person typing at that many characters per second, with a deterministic,
 * human unevenness (a beat after a space, a longer one after punctuation); `shipped` is the app's
 * own write-back pace (`typedCount`, `TypingPace` in the shell: four characters every 20 ms,
 * capped so a long answer lands in about 1.2 s); `instant` shows the line at once.
 */
import { hash01 } from '../../motion/ease.ts';
import { typedCount } from '../../kit/product/island.ts';
import { graphemes } from '../../kit/world/text-units.ts';
import { BEAT, beatPhase } from '../timeline.ts';

export type TypePace = number | 'shipped' | 'instant';

/** A person's default pace, in characters per second. */
export const HUMAN_PACE = 16;

/** How long after a keystroke the caret stays solid before it resumes blinking, in seconds. */
export const CARET_HOLD = 0.32;

/**
 * The time each grapheme of `text` appears, typing from `at` at `pace`. `seed` varies a person's
 * rhythm between lines that share a pace.
 */
export function typeTimes(
  text: string,
  at: number,
  pace: TypePace = HUMAN_PACE,
  seed = 0,
): number[] {
  const units = graphemes(text);
  if (pace === 'instant') return units.map(() => at);
  if (pace === 'shipped') {
    const times: number[] = [];
    let elapsed = 0;
    for (let index = 0; index < units.length; index++) {
      while (typedCount(elapsed, units.length) < index + 1) elapsed += 0.02;
      times.push(at + elapsed);
    }
    return times;
  }
  const interval = 1 / pace;
  const times: number[] = [];
  let time = at;
  for (let index = 0; index < units.length; index++) {
    times.push(time);
    const unit = units[index] ?? '';
    let gap = interval * (0.6 + 0.8 * hash01(index * 31 + seed * 977 + 7));
    if (unit === ' ') gap *= 1.35;
    if (/[,.;:!?，。；：！？]/u.test(unit)) gap *= 2.4;
    time += gap;
  }
  return times;
}

/** How many of a line's graphemes are typed at `t`. */
export function typedAt(times: readonly number[], t: number): number {
  let count = 0;
  while (count < times.length && (times[count] ?? Infinity) <= t) count++;
  return count;
}

/** Whether the caret is held solid at `t`: typing is under way or a keystroke just landed. */
export function isTyping(times: readonly number[], t: number): boolean {
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) return false;
  return t >= first && t <= last + CARET_HOLD;
}

/**
 * The caret's opacity when it blinks: on through the first half of every beat, off through the
 * second, with a quick fade each way, so it pulses with the score (on at each beat).
 */
export function blinkAt(t: number): number {
  const phase = beatPhase(t);
  const fade = 0.05 / BEAT;
  if (phase < 0.5) return Math.min(1, phase / fade + 0.15);
  return Math.max(0, 1 - (phase - 0.5) / (fade * 1.6));
}
