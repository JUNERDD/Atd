import { createGeneratorEasing, generateLinearEasing, spring } from 'motion';

/** A spring as WAAPI runs it: its settle time in milliseconds and a sampled `linear()` easing. */
export interface SpringTiming {
  duration: number;
  easing: string;
}

/**
 * SwiftUI's `.smooth` spring (bounce 0) at `visualDuration` seconds of pace, sampled into a
 * `linear()` easing so `Element.animate` runs it on the compositor. Motion's spring follows
 * SwiftUI's model (pace and bounce, not stiffness and damping), so the curve matches the native
 * one; the animation lasts until the spring settles, about one and a half times the pace.
 */
export function smoothSpring(visualDuration: number): SpringTiming {
  const { ease, duration } = createGeneratorEasing({ visualDuration, bounce: 0 }, 100, spring);
  const milliseconds = duration * 1000;
  return { duration: milliseconds, easing: generateLinearEasing(ease, milliseconds) };
}

/** Whether the engine animates elements itself; jsdom does not, so motion there ends at once. */
export function canAnimate(element: Element): boolean {
  return typeof element.animate === 'function';
}
