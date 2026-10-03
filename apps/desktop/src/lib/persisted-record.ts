import { useEffect, useRef } from 'react';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

/**
 * A record of values kept in `localStorage`, one item per key under a prefix. Remembering is a
 * convenience: storage that is unavailable or full leaves the page working from memory only.
 */
export interface PersistedRecordOptions<T> {
  /** An empty value is not worth keeping; its item is removed instead of written. */
  isEmpty: (value: T) => boolean;
  /** Repairs a restored value, such as dropping what no longer holds; defaults to as stored. */
  restore?: (value: T) => T;
}

function parseItem<S extends TSchema>(name: string, schema: S): Static<S> | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(name) ?? 'null');
    return Value.Check(schema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the items stored under `prefix`, keyed by the rest of the name. An item that is not JSON,
 * does not match `schema`, or restores to an empty value is removed: what an older build wrote
 * must never break the page that reads it. Unreadable storage gives an empty record.
 */
export function readPersistedRecord<S extends TSchema>(
  prefix: string,
  schema: S,
  { isEmpty, restore }: PersistedRecordOptions<Static<S>>,
): Record<string, Static<S>> {
  const entries: [string, Static<S>][] = [];
  try {
    // Names first: removing an item while iterating would shift the indexes.
    const names: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (name?.startsWith(prefix)) names.push(name);
    }
    for (const name of names) {
      const value = parseItem(name, schema);
      const restored = value === undefined ? undefined : (restore?.(value) ?? value);
      if (restored === undefined || isEmpty(restored)) localStorage.removeItem(name);
      else entries.push([name.slice(prefix.length), restored]);
    }
  } catch {
    // Storage is unavailable: nothing is remembered.
  }
  return Object.fromEntries(entries);
}

/**
 * Writes `record` back whenever it changes, each changed key alone and a removed or empty key as a
 * removed item. The record passed on the first render is taken as already stored (it is what
 * `readPersistedRecord` returned). `options` must be stable: the write-back effect reads it.
 */
export function usePersistRecord<T>(
  prefix: string,
  record: Record<string, T>,
  options: Pick<PersistedRecordOptions<T>, 'isEmpty'>,
) {
  const written = useRef(record);
  useEffect(() => {
    const previous = written.current;
    if (previous === record) return;
    written.current = record;
    try {
      for (const [key, value] of Object.entries(record)) {
        if (previous[key] === value) continue;
        if (options.isEmpty(value)) localStorage.removeItem(prefix + key);
        else localStorage.setItem(prefix + key, JSON.stringify(value));
      }
      for (const key of Object.keys(previous))
        if (!(key in record)) localStorage.removeItem(prefix + key);
    } catch {
      // Storage is unavailable or full; the state still holds the value for this page.
    }
  }, [record, prefix, options]);
}
