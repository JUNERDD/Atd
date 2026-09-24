/**
 * Bounds one projected details object. Every string and list goes through the same tracker, so
 * a projector cannot forget to report that it dropped characters or items (`truncated`).
 */
export interface Clamp {
  /** `value` cut to at most `max` UTF-16 units, never splitting a surrogate pair. */
  text(value: string, max: number): string;
  /** The first `max` items. */
  list<T>(items: readonly T[], max: number): T[];
  /** Records a drop the projector made itself (an invalid or unsafe item). */
  drop(): void;
  readonly truncated: boolean;
}

export function createClamp(): Clamp {
  let truncated = false;
  return {
    text(value, max) {
      if (value.length <= max) return value;
      truncated = true;
      const code = value.charCodeAt(max - 1);
      const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
      return value.slice(0, end);
    },
    list(items, max) {
      if (items.length <= max) return [...items];
      truncated = true;
      return items.slice(0, max);
    },
    drop() {
      truncated = true;
    },
    get truncated() {
      return truncated;
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The string items of `value`, or `[]` when it is not an array. */
export function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
