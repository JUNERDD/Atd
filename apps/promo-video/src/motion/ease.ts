import { Easing } from 'remotion';

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** The emphasized ease-out: a quick start and a long, quiet settle. */
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
/** For things leaving: a soft start that accelerates away. */
export const easeIn = Easing.bezier(0.55, 0, 0.75, 0.2);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 over `length` seconds from `at`, eased and clamped. */
export function ramp(t: number, at: number, length: number, easing = easeOut): number {
  return easing(clamp01((t - at) / length));
}

/** A deterministic 0–1 value per integer key, for scatter that renders the same every time. */
export function hash01(key: number): number {
  let h = Math.imul(key ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
