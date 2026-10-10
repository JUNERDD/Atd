import type { Lang } from '../../copy.ts';
import { easeOut, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { strings } from './strings.ts';

/**
 * The habit tracker the film's agent builds: the data its window and its pin share. Names are the
 * scene's content; the kit only lays them out.
 */
export interface Habit {
  name: string;
}

/** One check in the week grid: habit row, day column (0 Monday … 6 Sunday), and when it fills. */
export interface HabitCheck {
  habit: number;
  day: number;
  /** Seconds on the clock when it is checked; omit for a check already there. */
  at?: number | undefined;
}

/** How far a check has filled at `time`: its disc pops in, then its tick draws. */
export function checkState(check: HabitCheck, time: number): { pop: number; draw: number } {
  if (check.at === undefined) return { pop: 1, draw: 1 };
  return {
    pop: springAt(time, check.at, springs.pop),
    draw: ramp(time, check.at + 0.08, 0.3, easeOut),
  };
}

/** The checks of one cell, if any. */
export function checkAt(
  checks: readonly HabitCheck[],
  habit: number,
  day: number,
): HabitCheck | undefined {
  return checks.find((check) => check.habit === habit && check.day === day);
}

/**
 * Monday to Sunday, `narrow` (one letter, or one character in Chinese) or `short` (`Thu`, `周四`).
 * They come from the kit's strings, so the film's font loader covers their glyphs.
 */
export function weekdays(lang: Lang, width: 'narrow' | 'short' = 'narrow'): string[] {
  return strings[lang].week[width].split(' ');
}
