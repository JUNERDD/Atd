import { PREVIEW_STRING_CHARS } from '../_constants/limits';
import type { JsonNodeType } from '../_types/node';

function typeOf(value: unknown): JsonNodeType {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'primitive';
}

/** Wordless collapsed glyphs: counts for branches, quoted text for strings, literals as-is. */
export function previewFor(value: unknown): string {
  const type = typeOf(value);
  switch (type) {
    case 'object': {
      const size = Object.keys(value as Record<string, unknown>).length;
      return size === 0 ? '{}' : `{${size}}`;
    }
    case 'array': {
      const size = (value as ReadonlyArray<unknown>).length;
      return size === 0 ? '[]' : `[${size}]`;
    }
    case 'primitive': {
      if (typeof value === 'string') {
        if (value.length <= PREVIEW_STRING_CHARS) return JSON.stringify(value);
        return JSON.stringify(`${value.slice(0, PREVIEW_STRING_CHARS)}…`);
      }
      return String(value);
    }
    default: {
      const unexpected: never = type;
      return unexpected;
    }
  }
}
