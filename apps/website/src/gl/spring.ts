/** One spring-driven value. Mutated in place so the frame loop allocates nothing. */
export interface Spring {
  value: number;
  velocity: number;
}

export function createSpring(value = 0): Spring {
  return { value, velocity: 0 };
}

/**
 * Advances a critically damped spring toward `target` with the closed-form solution, so it is exact
 * for any time step and never overshoots. `omega` is the natural frequency in rad/s; the value
 * settles within about 4.7 / omega seconds.
 */
export function stepSpring(spring: Spring, target: number, omega: number, dt: number): void {
  const offset = spring.value - target;
  const decay = Math.exp(-omega * dt);
  const slope = spring.velocity + omega * offset;
  spring.value = target + (offset + slope * dt) * decay;
  spring.velocity = (slope - omega * (offset + slope * dt)) * decay;
}

/** Jumps to `value` with no motion left. */
export function snapSpring(spring: Spring, value: number): void {
  spring.value = value;
  spring.velocity = 0;
}
