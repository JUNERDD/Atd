import { springAt, springs, type Spring } from '../../motion/spring.ts';

/**
 * How far an element has arrived, `age` seconds after it appeared, on `spring`: 0 before, 1 at
 * rest (overshooting a little on a bouncy spring). `undefined` means it is simply there.
 *
 * Components hand this to their stylesheet as `--in`; `.pk-arrive` (tokens.css) fades the element
 * in, lifts it into place and grows the room it takes, so content below or above it moves along.
 */
export function arrival(age: number | undefined, spring: Spring = springs.smooth): number {
  return age === undefined ? 1 : springAt(age, 0, spring);
}

/** Whether something with this `age` is on screen yet. */
export function present(age: number | undefined): boolean {
  return age === undefined || age >= 0;
}

/**
 * The selection toolbar's entrance (`SelectionToolbarEntrance`): a `CASpringAnimation` with a
 * perceptual duration of 0.32 s and a bounce of 0.15, which is damping 0.85.
 */
export const SELECTION_SPRING: Spring = { response: 0.32, damping: 0.85 };
