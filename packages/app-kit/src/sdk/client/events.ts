import { fromWire } from '../../../runtime/wire.mjs';

/** Receives what the backend publishes on a channel with `ctx.events.publish(channel, data)`. */
export type EventListener = (data: unknown) => void;

const listeners = new Map<string, Set<EventListener>>();
let source: EventSource | null = null;

/**
 * One `EventSource` on `/api/events` serves every subscription while any is active. Each message
 * is `{"channel": string, "data": <json>}`; the shell forwards the service's event stream for this
 * app, which carries what the backend publishes.
 */
function connect() {
  const next = new EventSource('/api/events');
  next.addEventListener('message', (event) => {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message === null || typeof message !== 'object') return;
    const channel: unknown = Reflect.get(message, 'channel');
    if (typeof channel !== 'string') return;
    const data = fromWire(Reflect.get(message, 'data'));
    for (const listener of listeners.get(channel) ?? []) listener(data);
  });
  return next;
}

/** Subscribes to a backend event channel; the returned function unsubscribes. */
export function subscribe(channel: string, listener: EventListener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener);
  source ??= connect();
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channel);
    if (listeners.size === 0) {
      source?.close();
      source = null;
    }
  };
}
