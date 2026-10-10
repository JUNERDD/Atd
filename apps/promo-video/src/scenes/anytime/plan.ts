/**
 * The Anytime section's layout and derived timing, in section-local seconds and display points.
 * The beats themselves are the timeline's (`CHOREO.anytime`); this file only places things on them.
 */
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { CHOREO } from '../../timeline.ts';
import { DISPLAY } from '../../kit/world/points.ts';

export const LAPSE = CHOREO.anytime.timelapse;
export const MEMORY = CHOREO.anytime.memory;

/** The cut from the dawn desktop to the panel close-up, inside a whip down the screen. */
export const CUT = MEMORY.start;
/** The desktop's whip starts a little before the cut, the close-up's a little before it too, so
 * both sides of the cut are moving at speed. */
export const WHIP_OUT = CUT - 0.13;
export const WHIP_IN = CUT - 0.07;

/** Notification banners: 344 pt wide, top-right, 12 pt under the menu bar, 86 pt apart. */
export const NOTICE_WIDTH = 344;
export const NOTICE_X = DISPLAY.width - 14 - NOTICE_WIDTH;
export const NOTICE_Y = [42, 128] as const;

/** Atd's status item in the menu bar (its 30 pt slot's center), right of the app menus. */
export const STATUS = { x: 1240, y: 15 };

/** The watched folder, where its owner keeps it on the desktop: down and left of the banners. */
export const FOLDER_SIZE = 72;
export const FOLDER = { x: 1060, y: 236 };
/** The folder art's center, where files land. */
export const FOLDER_ART = { x: FOLDER.x + (FOLDER_SIZE + 36) / 2, y: FOLDER.y + FOLDER_SIZE / 2 };

/** How long a file takes to fall into the folder; it lands on its beat. */
export const FALL = 0.46;

/** The clock's progress through the night, 0 (18:00) → 1 (08:59), linear. */
export function nightAt(t: number): number {
  return clamp01((t - LAPSE.clock[0]) / (LAPSE.clock[1] - LAPSE.clock[0]));
}

const NIGHT_MINUTES = 14 * 60 + 59;
const DAYS: Record<Lang, readonly [string, string]> = { en: ['Fri', 'Sat'], zh: ['周五', '周六'] };

/**
 * The menu bar clock at a point in the night, as each cut's macOS sets it: "Fri 6:00 PM" in
 * English, "周五 18:00" in Chinese (24-hour, zero-padded).
 */
export function clockAt(lang: Lang, progress: number): string {
  const minutes = 18 * 60 + Math.floor(clamp01(progress) * NIGHT_MINUTES);
  const day = DAYS[lang][minutes >= 24 * 60 ? 1 : 0];
  const hour = Math.floor(minutes / 60) % 24;
  const minute = String(minutes % 60).padStart(2, '0');
  if (lang === 'zh') return `${day} ${String(hour).padStart(2, '0')}:${minute}`;
  return `${day} ${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}
