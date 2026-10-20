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
function evict() {
  const items: { name: string; at: number; units: number }[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (!name?.startsWith(PREFIX)) continue;
    const value = localStorage.getItem(name) ?? '';
    items.push({ name, at: writtenAt(value), units: name.length + value.length });
  }
  items.sort((a, b) => a.at - b.at);
  let count = items.length;
  let units = items.reduce((sum, item) => sum + item.units, 0);
  for (const item of items) {
    if (count <= MAX_VIEWS && units <= MAX_UNITS) return;
    localStorage.removeItem(item.name);
    count -= 1;
    units -= item.units;
  }
}

/** The state the view `key` last saved, from this window or storage; null when none. */
export function readViewState(key: string): unknown {
  if (memory.has(key)) return memory.get(key);
  try {
    const value = localStorage.getItem(PREFIX + key);
    if (value === null) return null;
    const state = decode(value);
    // What this format cannot read must never break the view that reads it.
    if (state === undefined) localStorage.removeItem(PREFIX + key);
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
    localStorage.setItem(PREFIX + key, encode(state, Date.now()));
    evict();
  } catch {
    // Storage is unavailable or full: this window keeps the state in memory.
  }
}
