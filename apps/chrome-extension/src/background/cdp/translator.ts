import type { ConnId } from '../../channel/protocol.ts';
import type { SendFrame } from '../native.ts';
import { CdpConnection } from './connection.ts';
import type { Debuggee } from './debuggee.ts';
import { CDP_ERROR, type CdpOutbound, type CdpParams } from './messages.ts';

/**
 * Chrome caps one message to the native host at 64 MiB of UTF-8 and drops the whole port past it.
 * The `cdp` frame escapes the CDP text's quotes and backslashes, which at most doubles its size,
 * so a message's text is held under 30 MiB of UTF-8.
 */
const MAX_CDP_BYTES = 30 * 1024 * 1024;

export interface TranslatorDeps {
  send: SendFrame;
  debuggee: Debuggee;
  /** Owned tabs of active runs (D9). */
  visibleTabs(): readonly number[];
  openTab(url: string): Promise<number>;
  closeTab(tabId: number): Promise<void>;
  version(): Promise<string>;
}

/**
 * The CDP translator (D8): one emulated browser endpoint per worker connection the shell opens
 * (`cdp.open` / `cdp` / `cdp.close`), all sharing the extension's debugger attachments. The
 * debugger is attached to a tab only while some connection uses it and the tab is owned by an
 * active run; every change of either detaches what nobody uses (`settle`).
 */
export class CdpTranslator {
  private readonly connections = new Map<string, { conn: ConnId; connection: CdpConnection }>();
  private settling: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TranslatorDeps) {}

  open(conn: ConnId): void {
    const key = connKey(conn);
    this.connections.get(key)?.connection.close();
    const connection = new CdpConnection({
      debuggee: this.deps.debuggee,
      visibleTabs: () => this.deps.visibleTabs(),
      openTab: (url) => this.deps.openTab(url),
      closeTab: (tabId) => this.deps.closeTab(tabId),
      version: () => this.deps.version(),
      emit: (message) => {
        const msg = fitted(message);
        if (msg !== undefined) this.deps.send({ t: 'cdp', conn, msg });
      },
      changed: () => this.settle(),
    });
    this.connections.set(key, { conn, connection });
  }

  close(conn: ConnId): void {
    const key = connKey(conn);
    this.connections.get(key)?.connection.close();
    this.connections.delete(key);
    this.settle();
  }

  message(conn: ConnId, text: string): void {
    const entry = this.connections.get(connKey(conn));
    if (entry === undefined) {
      console.info('[atd] dropped a CDP message for a connection that is not open');
      return;
    }
    void entry.connection.handle(text);
  }

  /** The channel closed: the shell's worker sockets went with it. */
  closeAll(): void {
    for (const { connection } of this.connections.values()) connection.close();
    this.connections.clear();
    this.settle();
  }

  /**
   * Which tabs are visible changed (a tab was handed, opened or released, a run ended) or a
   * visible tab lost its attachment: every connection catches up, then unused attachments go.
   */
  visibilityChanged(): void {
    const all = [...this.connections.values()].map(({ connection }) => connection.reconcile());
    void Promise.all(all).then(() => this.settle());
  }

  debuggerEvent(tabId: number, child: string | undefined, method: string, params: CdpParams): void {
    for (const { connection } of this.connections.values())
      connection.event(tabId, child, method, params);
  }

  /** Chrome ended the tab's attachment: every connection sees the target detach. */
  debuggerDetached(tabId: number): void {
    for (const { connection } of this.connections.values()) connection.withdraw(tabId);
  }

  /** Detaches every tab no connection uses (serialized, so attach and detach never interleave). */
  private settle(): void {
    this.settling = this.settling
      .then(async () => {
        const used = new Set(
          [...this.connections.values()].flatMap(({ connection }) => connection.usedTabs()),
        );
        const unused = this.deps.debuggee.attachedTabs().filter((tabId) => !used.has(tabId));
        await Promise.all(unused.map((tabId) => this.deps.debuggee.detach(tabId)));
      })
      .catch((error: unknown) => {
        console.warn('[atd] could not release debugger attachments', error);
      });
  }
}

/**
 * The message as CDP text. A response too large for the channel becomes an error in its place;
 * an event that large (a page logging megabytes) is dropped.
 */
function fitted(message: CdpOutbound): string | undefined {
  const text = JSON.stringify(message);
  if (fitsBytes(text, MAX_CDP_BYTES)) return text;
  if (!('id' in message)) {
    console.info('[atd] dropped a CDP event too large for the channel');
    return undefined;
  }
  const error = {
    code: CDP_ERROR.server,
    message: 'The response is too large for Atd for Chrome.',
  };
  return JSON.stringify({
    id: message.id,
    ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
    error,
  });
}

/**
 * Whether `text` is at most `max` bytes as UTF-8. Each UTF-16 unit takes one to three bytes (a
 * surrogate pair four, two per unit), so most texts are decided by their length alone; the rest
 * are counted, stopping once over. JSON text has no lone surrogates, which this would count as
 * two bytes instead of the three of U+FFFD.
 */
function fitsBytes(text: string, max: number): boolean {
  if (text.length * 3 <= max) return true;
  if (text.length > max) return false;
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes += code < 0x80 ? 1 : code < 0x800 || (code >= 0xd800 && code <= 0xdfff) ? 2 : 3;
    if (bytes > max) return false;
  }
  return true;
}

/** A map key per connection id; a string and a number with the same digits stay distinct. */
function connKey(conn: ConnId): string {
  return `${typeof conn}:${conn}`;
}
