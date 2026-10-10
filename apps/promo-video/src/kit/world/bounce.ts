/**
 * An icon's hop when something lands in it, purely from time: on each hit it squashes, springs up
 * and comes down in smaller and smaller bounces, like the Dock's. The latest hit wins.
 */
export interface Bounce {
  /** Height above rest, in the icon's sizes (0.18 at the first hop's peak). */
  lift: number;
  /** Squash at contact, 0–1: the icon widens and shortens by up to 12%. */
  squash: number;
}

const PERIOD = 0.32;
const DECAY = 4.2;

/** The bounce at time `t` after the latest of `hits` (seconds on the same clock). */
export function bounceAt(t: number, hits: readonly number[]): Bounce {
  const last = hits
    .filter((hit) => hit <= t)
    .reduce((latest, hit) => Math.max(latest, hit), -Infinity);
  if (!Number.isFinite(last)) return { lift: 0, squash: 0 };
  const u = t - last;
  const envelope = Math.exp(-DECAY * u);
  const phase = (Math.PI * u) / PERIOD;
  // A brief squash on the landing that starts it, then bouncing-ball hops.
  const landing = Math.exp(-u / 0.035) * (u < 0.12 ? 1 : 0);
  return {
    lift: 0.18 * Math.abs(Math.sin(phase)) * envelope * (u > 0.02 ? 1 : 0),
    squash: Math.min(1, landing + Math.max(0, Math.cos(phase)) ** 12 * envelope * 0.8),
  };
}
