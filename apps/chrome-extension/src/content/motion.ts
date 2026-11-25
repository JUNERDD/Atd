import { signal } from './lifetime.ts';

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

/** Whether the person asked for reduced motion (live: read it when animating). */
export function reducedMotion(): boolean {
  return reduceQuery.matches;
}

export function onReducedMotionChange(listener: () => void): void {
  reduceQuery.addEventListener('change', listener, { signal });
}

export interface SpringTiming {
  /** A CSS `linear()` easing that traces the spring. */
  easing: string;
  /** Milliseconds until it settles within 0.2% of its target. */
  duration: number;
}

const SAMPLES = 48;
const SETTLED = 0.002;

/**
 * A damped spring as a CSS `linear()` easing, from rest (or `v0`, the release velocity in progress
 * per second) to the target. `response` is the perceptual duration in seconds and `bounce` 0…1, as
 * SwiftUI and `CASpringAnimation(perceptualDuration:bounce:)` take them: 0 is critically damped
 * (the pointer's glide, no overshoot), the HUD's snap uses a slight bounce. Ported from the
 * prototype's `springEasing`, with the critically damped case it divided by zero for.
 */
export function springEasing(v0 = 0, response = 0.42, bounce = 0.15): SpringTiming {
  const omega = (2 * Math.PI) / response;
  const zeta = 1 - bounce;
  let offset: (time: number) => number;
  let duration: number;
  if (zeta >= 1) {
    // Critically damped: 1 - x(t) = e^(-ωt) (1 + (ω - v0) t).
    const k = omega - v0;
    offset = (time) => Math.exp(-omega * time) * (1 + k * time);
    duration = 0;
    while (duration < 3 && Math.abs(offset(duration)) > SETTLED) duration += 0.001;
  } else {
    const decay = zeta * omega;
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    const c = (decay - v0) / damped;
    offset = (time) =>
      Math.exp(-decay * time) * (Math.cos(damped * time) + c * Math.sin(damped * time));
    duration = Math.log((1 + Math.abs(c)) / SETTLED) / decay;
  }
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) points.push((1 - offset((duration * i) / SAMPLES)).toFixed(4));
  points[SAMPLES] = '1';
  return { easing: `linear(${points.join(', ')})`, duration: Math.round(duration * 1000) };
}
