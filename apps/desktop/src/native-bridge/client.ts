import { parse } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { NativeCalls, type ShortcutResultSchema } from './calls';
import { MESSAGE_HANDLER, NativeEvents, type NativePosts } from './contract';

export type NativeCallName = keyof typeof NativeCalls;
export type NativePostName = keyof typeof NativePosts;
export type NativeEventName = keyof typeof NativeEvents;
export type CallParams<M extends NativeCallName> = Static<(typeof NativeCalls)[M]['params']>;
export type CallResult<M extends NativeCallName> = Static<(typeof NativeCalls)[M]['result']>;
export type PostParams<P extends NativePostName> = Static<(typeof NativePosts)[P]>;
export type EventPayload<E extends NativeEventName> = Static<(typeof NativeEvents)[E]>;
export type ShortcutResult = Static<typeof ShortcutResultSchema>;

interface ScriptMessageHandler {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    /** WebKit's script message handlers; only the macOS shell registers `aiNative`. */
    webkit?: { messageHandlers?: Record<string, ScriptMessageHandler | undefined> };
    /** The delivery function Swift calls (`DELIVER_SCRIPT`). */
    aiNative?: { deliver: (message: unknown) => void };
  }
}

/**
 * The outer shape of a Swift message. Each part is then checked against its own schema from the
 * contract (a result against its call, an event payload against its event), so every message is
 * fully validated once.
 */
const EnvelopeSchema = Type.Union([
  Type.Object(
    { type: Type.Literal('result'), id: Type.Integer({ minimum: 1 }), value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('error'),
      id: Type.Integer({ minimum: 1 }),
      message: Type.String({ maxLength: 2000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('event'), event: Type.String(), payload: Type.Unknown() },
    { additionalProperties: false },
  ),
]);

type Listeners = { [E in NativeEventName]: Set<(payload: EventPayload<E>) => void> };

interface Pending {
  settle: (value: unknown) => void;
  reject: (error: Error) => void;
}

function isEventName(name: string): name is NativeEventName {
  return Object.hasOwn(NativeEvents, name);
}

/**
 * The page's end of the bridge to the macOS shell. Calls resolve with their validated result;
 * events reach the listeners registered with `on`. A message that fails validation is dropped and
 * reported, and a failed result rejects its call.
 */
export class NativeBridge {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners: Listeners = {
    'window.active': new Set(),
    'window.visibility': new Set(),
    'accessibility.reduceTransparency': new Set(),
    'shortcut.command': new Set(),
    'resources.imported': new Set(),
    'files.drag': new Set(),
    'edit.command': new Set(),
    'speech.state': new Set(),
    'socket.frames': new Set(),
  };

  private constructor(private readonly handler: ScriptMessageHandler) {}

  /**
   * The bridge when the macOS shell hosts this page, with its delivery function installed and
   * Swift told the page is ready; null in tests and in a plain browser.
   */
  static connect(): NativeBridge | null {
    const handler = window.webkit?.messageHandlers?.[MESSAGE_HANDLER];
    if (!handler) return null;
    const bridge = new NativeBridge(handler);
    window.aiNative = { deliver: (message) => bridge.deliver(message) };
    bridge.post('bridge.ready', {});
    return bridge;
  }

  call<M extends NativeCallName>(method: M, params: CallParams<M>): Promise<CallResult<M>> {
    const id = this.nextId++;
    const result: (typeof NativeCalls)[M]['result'] = NativeCalls[method].result;
    return new Promise<CallResult<M>>((resolve, reject) => {
      this.pending.set(id, {
        settle: (value) => resolve(parse(result, value)),
        reject,
      });
      this.handler.postMessage({ type: 'call', id, method, params });
    });
  }

  post<P extends NativePostName>(method: P, params: PostParams<P>): void {
    this.handler.postMessage({ type: 'post', method, params });
  }

  on<E extends NativeEventName>(
    event: E,
    listener: (payload: EventPayload<E>) => void,
  ): () => void {
    const listeners: Set<(payload: EventPayload<E>) => void> = this.listeners[event];
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** Swift's entry point. Synchronous: Swift keeps at most one delivery in flight. */
  private deliver(raw: unknown): void {
    try {
      const message = parse(EnvelopeSchema, raw);
      if (message.type === 'event') {
        if (!isEventName(message.event)) throw new TypeError(`Unknown event ${message.event}.`);
        this.emit(message.event, message.payload);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) throw new TypeError(`No call is waiting for id ${message.id}.`);
      this.pending.delete(message.id);
      if (message.type === 'error') pending.reject(new Error(message.message));
      else {
        try {
          pending.settle(message.value);
        } catch (error) {
          pending.reject(error instanceof Error ? error : new TypeError('Invalid result.'));
        }
      }
    } catch (error) {
      console.error('Dropped a message from the native shell:', error);
    }
  }

  private emit<E extends NativeEventName>(event: E, payload: unknown): void {
    const schema: (typeof NativeEvents)[E] = NativeEvents[event];
    const value = parse(schema, payload);
    const listeners: Set<(payload: EventPayload<E>) => void> = this.listeners[event];
    for (const listener of listeners) {
      // One failing listener must not keep the event from the others.
      try {
        listener(value);
      } catch (error) {
        console.error(`A ${event} listener failed:`, error);
      }
    }
  }
}
