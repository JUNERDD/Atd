import { signal } from './lifetime.ts';

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');

/** Whether the person asked for reduced motion (live: read it when animating). */
export function reducedMotion(): boolean {
  return reduceQuery.matches;
}

export function onReducedMotionChange(listener: () => void): void {
  reduceQuery.addEventListener('change', listener, { signal });
}

/** A spring as SwiftUI and `CASpringAnimation(perceptualDuration:bounce:)` take it. */
export interface Spring {
  /** The perceptual duration, in seconds. */
  response: number;
  /** 0…1: 0 is critically damped (no overshoot). */
  bounce: number;
}

/** A damped spring's progress from 0 to its target 1, over time in seconds. */
export interface SpringCurve {
  at(time: number): number;
  /** Progress per second. */
  velocity(time: number): number;
  /** Seconds until it stays within 0.2% of its target. */
  settle: number;
}

const SAMPLES = 48;
const SETTLED = 0.002;

/**
 * A damped spring from rest (or `v0`, its initial velocity in progress per second) to its target:
 * the analytic solution, so a motion can be read at any moment and handed on with its velocity.
 * Bounce ≥ 0 only; Reduce Motion asks for 0.
 */
export function springCurve({ response, bounce }: Spring, v0 = 0): SpringCurve {
  const omega = (2 * Math.PI) / response;
  const zeta = 1 - Math.min(Math.max(bounce, 0), 0.95);
  if (zeta >= 1) {
    // Critically damped: 1 - x(t) = e^(-ωt) (1 + (ω - v0) t).
    const k = omega - v0;
    const offset = (time: number) => Math.exp(-omega * time) * (1 + k * time);
    let settle = 0;
    while (settle < 3 && Math.abs(offset(settle)) > SETTLED) settle += 0.001;
    return {
      at: (time) => 1 - offset(time),
      velocity: (time) => Math.exp(-omega * time) * (v0 + omega * k * time),
      settle,
    };
  }
  const decay = zeta * omega;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const c = (decay - v0) / damped;
  return {
    at: (time) =>
      1 - Math.exp(-decay * time) * (Math.cos(damped * time) + c * Math.sin(damped * time)),
    velocity: (time) =>
      -Math.exp(-decay * time) *
      ((c * damped - decay) * Math.cos(damped * time) -
        (decay * c + damped) * Math.sin(damped * time)),
    settle: Math.log((1 + Math.abs(c)) / SETTLED) / decay,
  };
}

export interface SpringTiming {
  /** A CSS `linear()` easing that traces the spring. */
  easing: string;
  /** Milliseconds until it settles within 0.2% of its target. */
  duration: number;
}

/**
 * A damped spring as a CSS `linear()` easing, for the Web Animations API: `response` is the
 * perceptual duration in seconds and `bounce` 0…1. 0 is critically damped (the pointer's glide,
 * no overshoot); the HUD's snap uses a slight bounce. Ported from the prototype's `springEasing`.
 */
export function springEasing(v0 = 0, response = 0.42, bounce = 0.15): SpringTiming {
  const curve = springCurve({ response, bounce }, v0);
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) points.push(curve.at((curve.settle * i) / SAMPLES).toFixed(4));
  points[SAMPLES] = '1';
  return { easing: `linear(${points.join(', ')})`, duration: Math.round(curve.settle * 1000) };
}
