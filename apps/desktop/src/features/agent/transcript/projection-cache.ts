import type { Block } from '../../../../electron/agent/transcript-schema';

/** A projection with the inputs it was built from, keyed by its first source block. */
export type ProjectionCache<T> = WeakMap<Block, { inputs: readonly unknown[]; value: T }>;

/**
 * The cached projection while its inputs are the same references, else a fresh one that replaces
 * it. Transcript patches keep unchanged blocks by reference, so a settled turn or activity group
 * keeps its identity across patches and its memoized view skips them. Keys are weak: a projection
 * goes away with the blocks it was built from.
 */
export function reuseProjection<T>(
  cache: ProjectionCache<T>,
  key: Block | undefined,
  inputs: readonly unknown[],
  build: () => T,
): T {
  const cached = key ? cache.get(key) : undefined;
  if (
    cached &&
    cached.inputs.length === inputs.length &&
    cached.inputs.every((input, index) => input === inputs[index])
  )
    return cached.value;
  const value = build();
  if (key) cache.set(key, { inputs, value });
  return value;
}
