/**
 * The dot grid's geometry and its pulses, as data. A pulse is a ring of light that leaves an origin
 * (a keystroke, a click, the island landing) and travels outward, lighting and slightly enlarging
 * the dots it passes, then fades. Both the frame-space `DotField` and the `Stage` wallpaper draw
 * from these functions, so a pulse looks the same on either, and they are pure, so the score can
 * read the same origins and times.
 */
import { smoothstep } from '../../motion/ease.ts';

/** The grid's pitch in frame pixels at rest (the Stage converts it to points). */
export const DOT_PITCH = 24;
/** A resting dot's radius, in frame pixels. */
export const DOT_RADIUS = 1.05;

export interface Pulse {
  /** The origin, in the field's own units (frame px for `DotField`, display points for `Stage`). */
  x: number;
  y: number;
  /** When it leaves the origin, in seconds on the caller's clock. */
  at: number;
  /** Peak brightness, 0–1 and beyond for a hit (default 1). */
  strength?: number;
  /** How fast the ring travels, in units per second (default 1100). */
  speed?: number;
  /** The light's color: white, or coral for the caret's own keystrokes (default white). */
  tint?: 'white' | 'coral';
}

/** How long a pulse lives, in seconds. */
export const PULSE_LIFE = 2.2;

export interface PulseRing {
  /** The ring's radius and half-width, in the field's units. */
  radius: number;
  width: number;
  /** Its brightness now, 0 once faded. */
  level: number;
  /** A brief flash at the origin as the pulse leaves it. */
  flash: number;
}

/** A pulse's ring at time `t`, or null before it leaves and after it fades. */
export function pulseRing(pulse: Pulse, t: number): PulseRing | null {
  const age = t - pulse.at;
  if (age < 0 || age > PULSE_LIFE) return null;
  const speed = pulse.speed ?? 1100;
  const strength = pulse.strength ?? 1;
  // The ring decelerates slightly as it spreads, and widens: a shock that relaxes into a swell.
  const radius = speed * age * (1 - 0.22 * (age / PULSE_LIFE));
  const width = 46 + 0.2 * radius;
  const level = strength * smoothstep(0, 0.04, age) * Math.exp(-age / 0.62);
  const flash = strength * Math.exp(-age / 0.12);
  return { radius, width, level, flash };
}

/** How lit a dot at `distance` from the origin is by a ring, 0–1+. */
export function ringLight(ring: PulseRing, distance: number): number {
  const offset = (distance - ring.radius) / ring.width;
  const ringPart = ring.level * Math.exp(-offset * offset);
  const flashPart = ring.flash * Math.exp(-((distance / 90) ** 2));
  return ringPart + flashPart;
}
