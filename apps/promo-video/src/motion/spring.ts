/**
 * Springs in closed form, described the way Apple's frameworks describe them: a response (the
 * period of the undamped motion, in seconds) and a damping ratio (1 settles without overshoot,
 * lower values bounce). Closed form means any frame can be evaluated on its own, in any order,
 * which is how Remotion renders, and it also gives the velocity that tilt and blur follow.
 */
export interface Spring {
  response: number;
  damping: number;
}

export const springs = {
  /** Settles without overshoot: text, fades, the camera's final approach. */
  smooth: { response: 0.55, damping: 1 },
  /** Quick and nearly flat: small controls and state changes. */
  snappy: { response: 0.38, damping: 0.86 },
  /** Windows and panels: a whisper of overshoot, as on macOS. */
  window: { response: 0.52, damping: 0.8 },
  /** Things that pop into place: badges, toolbars, bubbles. */
  pop: { response: 0.42, damping: 0.58 },
  /** A lively bounce for playful accents. */
  bouncy: { response: 0.5, damping: 0.66 },
  /** The camera: weighty, unhurried, no overshoot to speak of. */
  camera: { response: 1.15, damping: 0.94 },
} as const satisfies Record<string, Spring>;

/** Remaining displacement toward the target and its derivative, `t` seconds after release. */
function displacement(t: number, { response, damping }: Spring): [number, number] {
  const omega = (2 * Math.PI) / response;
  const a = damping * omega;
  if (damping < 1) {
    const b = omega * Math.sqrt(1 - damping * damping);
    const envelope = Math.exp(-a * t);
    return [
      envelope * (Math.cos(b * t) + (a / b) * Math.sin(b * t)),
      (-envelope * (omega * omega) * Math.sin(b * t)) / b,
    ];
  }
  if (damping === 1) {
    const envelope = Math.exp(-omega * t);
    return [envelope * (1 + omega * t), -omega * omega * t * envelope];
  }
  const b = omega * Math.sqrt(damping * damping - 1);
  const envelope = Math.exp(-a * t);
  return [
    envelope * (Math.cosh(b * t) + (a / b) * Math.sinh(b * t)),
    (-envelope * (omega * omega) * Math.sinh(b * t)) / b,
  ];
}

/** Progress from 0 to 1 (overshooting with damping below 1), `t` seconds after `at`. */
export function springAt(t: number, at: number, spring: Spring = springs.smooth): number {
  if (t <= at) return 0;
  return 1 - displacement(t - at, spring)[0];
}

/** The same spring's velocity, in progress per second. */
export function springVelocity(t: number, at: number, spring: Spring = springs.smooth): number {
  if (t <= at) return 0;
  return -displacement(t - at, spring)[1];
}

/** A value that springs from `from` to `to` at `at`, then holds. */
export function springTo(
  t: number,
  at: number,
  from: number,
  to: number,
  spring: Spring = springs.smooth,
): number {
  return from + (to - from) * springAt(t, at, spring);
}
