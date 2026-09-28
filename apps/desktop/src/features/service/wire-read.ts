/**
 * Field readers for service wire values that arrive as `unknown` over the bridge. Each returns an
 * empty value (never throws) when the field is missing or has another type, so a row parser can
 * decide which fields it requires.
 */

export function readObject(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

export function readString(value: unknown, key: string): string {
  const field = readObject(value, key);
  return typeof field === 'string' ? field : '';
}

export function readFlag(value: unknown, key: string): boolean {
  return readObject(value, key) === true;
}

export function readCount(value: unknown, key: string): number {
  const field = readObject(value, key);
  return typeof field === 'number' && Number.isInteger(field) && field >= 0 ? field : 0;
}

export function readStrings(value: unknown, key: string): string[] {
  const field = readObject(value, key);
  return Array.isArray(field)
    ? field.filter((item): item is string => typeof item === 'string')
    : [];
}

/** `enabled`, which catalogs predating it leave out: absent reads as on. */
export function readEnabled(value: unknown): boolean {
  const field = readObject(value, 'enabled');
  return typeof field === 'boolean' ? field : true;
}

/** The keys of a string map such as env or headers; the values are deliberately not read. */
export function readKeys(value: unknown, key: string): string[] {
  const field = readObject(value, key);
  return typeof field === 'object' && field !== null && !Array.isArray(field)
    ? Object.keys(field)
    : [];
}
