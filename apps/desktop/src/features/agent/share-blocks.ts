import type { Block } from '../../client/agent/transcript-schema';

type Plain = Record<string, unknown>;

function isPlain(value: object): value is Plain {
  return Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Exact structural equality of JSON-shaped values: the same primitives, arrays of equal items, and
 * plain objects with the same keys in the same order holding equal values. Anything else, such as
 * a class instance, is equal only to itself.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (!isPlain(a) || !isPlain(b)) return false;
  const keys = Object.keys(a);
  const other = Object.keys(b);
  return (
    keys.length === other.length &&
    keys.every((key, index) => key === other[index] && sameValue(a[key], b[key]))
  );
}

/**
 * `next` with each block that equals the previous block of its id replaced by that previous
 * object. A snapshot that replaces a task's transcript (a reload or a reconnect) then keeps the
 * unchanged blocks by reference, as a patch does, so the renderer's projections and memoized rows
 * built from them still apply. Only whole equal blocks are reused, and neither list is changed.
 */
export function shareBlocks(previous: readonly Block[], next: Block[]): Block[] {
  const byId = new Map(previous.map((block) => [block.id, block]));
  return next.map((block) => {
    const kept = byId.get(block.id);
    return kept && sameValue(kept, block) ? kept : block;
  });
}
