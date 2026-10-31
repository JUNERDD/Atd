import type { LoadedFile } from './loader.js';

/**
 * The store's state in this process. Subagent children load their own copy of the file loader's
 * modules (pi loads the child bridge without a module cache), so it lives on `globalThis` under a
 * versioned symbol, which every copy shares.
 */
interface StoreState {
  /** Loads under way that may produce an entry, by the conversion they share (`loadIntoStore`). */
  loading: Map<string, Promise<LoadedFile>>;
  /** Producers and cached validations retaining each entry: the sweep leaves those alone. */
  producing: Map<string, number>;
  /** Removals already under way; a load waits until its entry's removal ends. */
  removing: Map<string, Promise<void>>;
  /** When each source record last noted a use, by its path, least recent first. */
  touched: Map<string, number>;
}

const STATE_KEY = Symbol.for('ai.agent-service.extraction-store.v2');

export function extractionState(): StoreState {
  const global = globalThis as Record<symbol, StoreState | undefined>;
  const existing = global[STATE_KEY];
  if (existing) return existing;
  const created: StoreState = {
    loading: new Map(),
    producing: new Map(),
    removing: new Map(),
    touched: new Map(),
  };
  global[STATE_KEY] = created;
  return created;
}

/** Retains an entry for production or cached validation, after any prior removal finishes. */
export async function retainEntry(key: string): Promise<() => void> {
  const { producing, removing } = extractionState();
  while (removing.has(key)) await removing.get(key);
  producing.set(key, (producing.get(key) ?? 0) + 1);
  return () => {
    const count = (producing.get(key) ?? 1) - 1;
    if (count > 0) producing.set(key, count);
    else producing.delete(key);
  };
}
