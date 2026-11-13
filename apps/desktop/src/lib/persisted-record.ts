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

const PERSIST_DEBOUNCE_MS = 350;

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
  );
}

/**
 * Writes `record` back whenever it changes, debounced to avoid blocking typing with synchronous
 * `localStorage` serialization on every keystroke, and flushes pending writes on unmount,
 * `pagehide`, and hiding the page. Each changed key writes alone and a removed or empty key removes
 * its item; a key hitting `QuotaExceededError` stops retrying `setItem` until its payload shrinks.
 */
export function usePersistRecord<T>(
  prefix: string,
  record: Record<string, T>,
  options: Pick<PersistedRecordOptions<T>, 'isEmpty'>,
) {
  const written = useRef(record);
  const latest = useRef(record);
  const optionsRef = useRef(options);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quotaLimit = useRef(new Map<string, number>());
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const flush = () => {
      clearTimer();
      const previous = written.current;
      const next = latest.current;
      if (previous === next) return;
      written.current = next;
      const { isEmpty } = optionsRef.current;
      for (const [key, value] of Object.entries(next)) {
        if (previous[key] === value) continue;
        try {
          if (isEmpty(value)) {
            localStorage.removeItem(prefix + key);
            quotaLimit.current.delete(key);
            continue;
          }
          const serialized = JSON.stringify(value);
          const limit = quotaLimit.current.get(key);
          if (limit !== undefined && serialized.length >= limit) continue;
          try {
            localStorage.setItem(prefix + key, serialized);
            quotaLimit.current.delete(key);
          } catch (error) {
            if (isQuotaError(error)) quotaLimit.current.set(key, serialized.length);
          }
        } catch {
          // Storage is unavailable or serialization failed; memory still holds the value.
        }
      }
      for (const key of Object.keys(previous)) {
        if (key in next) continue;
        try {
          localStorage.removeItem(prefix + key);
          quotaLimit.current.delete(key);
        } catch {
          // Ignore unavailable storage during cleanup.
        }
      }
    };
    flushRef.current = flush;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush();
    };
  }, [prefix]);

  useEffect(() => {
    latest.current = record;
    optionsRef.current = options;
    if (written.current === record) {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, PERSIST_DEBOUNCE_MS);
  }, [record, prefix, options]);
}
