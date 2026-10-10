/**
 * The light field's design, as data: the moods it can take, the soft blobs it is made of and how
 * each blob looks in each mood. `Light` renders it; scenes only pick a mood (or a blend of moods)
 * and a time. Positions are percentages of the field's box, so the same light fills the frame and
 * the Mac's wallpaper. Colors are named by palette token and resolved in CSS (`--light-<name>`).
 */
import { clamp01, smoothstep } from '../../motion/ease.ts';

export const MOODS = ['night', 'dusk', 'dawn', 'bright'] as const;
export type Mood = (typeof MOODS)[number];

/** A blend of moods by weight; weights need not sum to 1 (they are normalized). */
export type MoodWeights = Partial<Record<Mood, number>>;

export type LightColor = 'coral' | 'peach' | 'cyan' | 'indigo' | 'rim';

interface BlobLook {
  color: LightColor;
  /** Peak opacity of the blob's core, 0–1. */
  alpha: number;
  /** Extra vertical offset in this mood, in percent of the box (dusk sinks, dawn rises). */
  dy?: number;
}

export interface BlobDesign {
  /** Rest position of the center, in percent of the box. */
  x: number;
  y: number;
  /** Diameter, in percent of the box's width. */
  size: number;
  /** Drift amplitude (percent) and period (seconds) on each axis. */
  drift: { x: number; y: number; period: number };
  phase: number;
  looks: Record<Mood, BlobLook>;
}

/**
 * Six lights, after the onboarding guide: a warm pair low on the horizon, a cool pair high, an
 * indigo wash that holds the dark, and a rim highlight that only dawn and bright reveal.
 */
export const BLOBS: readonly BlobDesign[] = [
  {
    x: 22,
    y: 78,
    size: 78,
    drift: { x: 7, y: 4, period: 29 },
    phase: 0.3,
    looks: {
      night: { color: 'indigo', alpha: 0.5, dy: 6 },
      dusk: { color: 'coral', alpha: 0.82, dy: 6 },
      dawn: { color: 'coral', alpha: 0.7, dy: 4 },
      bright: { color: 'coral', alpha: 1 },
    },
  },
  {
    x: 64,
    y: 92,
    size: 70,
    drift: { x: 9, y: 3, period: 37 },
    phase: 2.1,
    looks: {
      night: { color: 'indigo', alpha: 0.38, dy: 8 },
      dusk: { color: 'peach', alpha: 0.62, dy: 4 },
      dawn: { color: 'peach', alpha: 0.95, dy: -2 },
      bright: { color: 'peach', alpha: 0.9 },
    },
  },
  {
    x: 80,
    y: 22,
    size: 72,
    drift: { x: 6, y: 6, period: 33 },
    phase: 4.4,
    looks: {
      night: { color: 'cyan', alpha: 0.32 },
      dusk: { color: 'indigo', alpha: 0.7 },
      dawn: { color: 'cyan', alpha: 0.72 },
      bright: { color: 'cyan', alpha: 1 },
    },
  },
  {
    x: 30,
    y: 14,
    size: 84,
    drift: { x: 8, y: 5, period: 41 },
    phase: 1.2,
    looks: {
      night: { color: 'indigo', alpha: 0.78 },
      dusk: { color: 'indigo', alpha: 0.8 },
      dawn: { color: 'indigo', alpha: 0.55 },
      bright: { color: 'indigo', alpha: 0.9 },
    },
  },
  {
    x: 52,
    y: 46,
    size: 46,
    drift: { x: 11, y: 7, period: 23 },
    phase: 5.6,
    looks: {
      night: { color: 'cyan', alpha: 0.14 },
      dusk: { color: 'coral', alpha: 0.32, dy: 10 },
      dawn: { color: 'rim', alpha: 0.3, dy: -8 },
      bright: { color: 'peach', alpha: 0.32, dy: 6 },
    },
  },
  {
    x: 92,
    y: 70,
    size: 52,
    drift: { x: 5, y: 8, period: 27 },
    phase: 3.3,
    looks: {
      night: { color: 'cyan', alpha: 0.2 },
      dusk: { color: 'coral', alpha: 0.5, dy: 6 },
      dawn: { color: 'peach', alpha: 0.55 },
      bright: { color: 'coral', alpha: 0.85 },
    },
  },
];

/** A mood or blend, as weights that sum to 1 in MOODS order. */
export function normalizeMood(mood: Mood | MoodWeights): Record<Mood, number> {
  const weights: MoodWeights = typeof mood === 'string' ? { [mood]: 1 } : mood;
  const total = MOODS.reduce((sum, name) => sum + Math.max(0, weights[name] ?? 0), 0);
  const out = { night: 0, dusk: 0, dawn: 0, bright: 0 };
  for (const name of MOODS) out[name] = total > 0 ? Math.max(0, weights[name] ?? 0) / total : 0;
  if (total === 0) out.night = 1;
  return out;
}

/** Two moods crossfaded: `progress` 0 is all `from`, 1 all `to`. */
export function blendMoods(from: Mood, to: Mood, progress: number): MoodWeights {
  const p = clamp01(progress);
  if (from === to) return { [from]: 1 };
  return { [from]: 1 - p, [to]: p };
}

/**
 * The anytime time-lapse's sky: dusk at 0, deep night through the middle, dawn at 1. `progress` is
 * the clock's linear progress; the moods hand over smoothly so the light never pops.
 */
export function timelapseMood(progress: number): MoodWeights {
  const p = clamp01(progress);
  const toNight = smoothstep(0.05, 0.4, p);
  const toDawn = smoothstep(0.62, 0.95, p);
  return { dusk: 1 - toNight, night: toNight * (1 - toDawn), dawn: toDawn };
}
