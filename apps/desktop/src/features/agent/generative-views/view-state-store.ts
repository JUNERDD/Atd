/**
 * The state views save through `atd.setState`, by view key (`viewKey`), which a view's window
 * starts from when it mounts again: reopened, retried, or reloaded. Only windows save state; a
 * widget's is ignored. The panel and every view window share the `ai-app://renderer` origin, so
 * states live in its `localStorage`, one item per view, which any window reads.
 *
 * Bounds: each state is at most `VIEW_STATE_MAX_BYTES` of JSON (`isSavableState`), and the views
 * kept are capped in number and in total size, since the origin's small storage quota also holds
 * the panel's drafts and other remembered values. A write beyond either cap evicts the views
 * written least recently. Storage that is unreadable or full leaves this window's states in
 * memory, under the same count cap.
 */

/** Prefix of the items holding saved states; the rest of an item's name is the view key. */
const PREFIX = 'view.state.';
/** Most views whose state is kept. */
const MAX_VIEWS = 32;
/** Most UTF-16 code units the saved states' items take together, names included. */
const MAX_UNITS = 1 << 20;

/** The states this window saved, newest last, which outlive storage that refused them. */
const memory = new Map<string, unknown>();

/**
 * In-memory LRU index of `PREFIX` items in `localStorage` (oldest first), lazily hydrated once
 * so `saveViewState` evicts in O(1) instead of scanning all `localStorage` keys on every save.
 */
type StoredEntry = { at: number; units: number };
let storedIndex: Map<string, StoredEntry> | null = null;
let storedUnits = 0;

function ensureStoredIndex(): Map<string, StoredEntry> {
  if (storedIndex !== null) return storedIndex;
  const items: Array<{ name: string; at: number; units: number }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (!name?.startsWith(PREFIX)) continue;
    const value = localStorage.getItem(name) ?? '';
    items.push({ name, at: writtenAt(value), units: name.length + value.length });
  }
  items.sort((a, b) => a.at - b.at);
  storedIndex = new Map();
  storedUnits = 0;
  for (const item of items) {
    storedIndex.set(item.name, { at: item.at, units: item.units });
    storedUnits += item.units;
  }
  return storedIndex;
}

/** An item's value: the time it was written (epoch ms), a colon, then the state's JSON. */
function encode(state: unknown, at: number): string {
  return `${at}:${JSON.stringify(state ?? null)}`;
}

/** When an item was written; 0 (the oldest) for one this format cannot read. */
function writtenAt(value: string): number {
  const colon = value.indexOf(':');
  const at = colon < 1 ? 0 : Number(value.slice(0, colon));
  return Number.isFinite(at) && at > 0 ? at : 0;
}

/** An item's state; undefined for one this format cannot read. */
function decode(value: string): unknown {
  const colon = value.indexOf(':');
  if (colon < 1) return undefined;
  try {
    return JSON.parse(value.slice(colon + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/** Removes the views written least recently until the rest fit both caps. */
function evict(index: Map<string, StoredEntry>) {
  for (const [name, entry] of index) {
    if (index.size <= MAX_VIEWS && storedUnits <= MAX_UNITS) return;
    localStorage.removeItem(name);
    index.delete(name);
    storedUnits -= entry.units;
  }
}

/** The state the view `key` last saved, from this window or storage; null when none. */
export function readViewState(key: string): unknown {
  if (memory.has(key)) return memory.get(key);
  try {
    const storageKey = PREFIX + key;
    const value = localStorage.getItem(storageKey);
    if (value === null) return null;
    const state = decode(value);
    // What this format cannot read must never break the view that reads it.
    if (state === undefined) {
      localStorage.removeItem(storageKey);
      const removed = storedIndex?.get(storageKey);
      if (removed) {
        storedIndex?.delete(storageKey);
        storedUnits -= removed.units;
      }
    }
    return state ?? null;
  } catch {
    return null;
  }
}

/** Saves the view's state, which the caller checked with `isSavableState`. */
export function saveViewState(key: string, state: unknown): void {
  memory.delete(key);
  memory.set(key, state);
  const oldest = memory.size > MAX_VIEWS ? memory.keys().next().value : undefined;
  if (oldest !== undefined) memory.delete(oldest);
  try {
    const storageKey = PREFIX + key;
    const at = Date.now();
    const encoded = encode(state, at);
    localStorage.setItem(storageKey, encoded);
    const index = ensureStoredIndex();
    const previous = index.get(storageKey);
    if (previous) {
      index.delete(storageKey);
      storedUnits -= previous.units;
    }
    const units = storageKey.length + encoded.length;
    index.set(storageKey, { at, units });
    storedUnits += units;
    evict(index);
  } catch {
    // Reset cached index so another window's entries can be discovered on next write, keeping memory fallback.
    storedIndex = null;
    storedUnits = 0;
  }
}
