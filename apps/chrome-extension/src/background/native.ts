import {
  CHROME_CHANNEL_PROTOCOL,
  type ExtensionFrame,
  type ExtensionFrameBody,
  type ShellFrame,
} from '../channel/protocol.ts';
import { NATIVE_HOST } from '../flavor.ts';
import { ChunkJoiner, decodeShellMessage } from './frames.ts';

/** Any extension frame without the envelope's `v`, which `send` adds. */
export type OutboundFrame = {
  [T in ExtensionFrame['t']]: ExtensionFrameBody<T>;
}[ExtensionFrame['t']];

/** Sends one frame to the shell; false when the channel is not open (the frame is dropped). */
export type SendFrame = (frame: OutboundFrame) => boolean;

/**
 * Why the port closed: the browser found no usable host for this flavor, the shell rejected the
 * browser's signature or pairing identity, or the host went away.
 */
export type CloseReason = 'hostMissing' | 'disconnected' | 'browserNotVerified' | 'browserMismatch';

/** Rejection reasons that halt automatic reconnects until the person retries or the worker boots. */
export type HaltReason = 'browserNotVerified' | 'browserMismatch' | 'hostMissing';

export interface NativeChannelEvents {
  /** The body of the `hello` frame, which goes out first on every new port. */
  hello(): Promise<ExtensionFrameBody<'hello'>>;
  frame(frame: ShellFrame): void;
  closed(reason: CloseReason): void;
}

/** The protocol's bound on page text such as a URL or a title (`Text` in `protocol.ts`). */
const MAX_TEXT = 100_000;

/** Fits page text (a data URL can be megabytes) into the protocol's bound before sending. */
export function clipText(text: string | undefined): string {
  return (text ?? '').slice(0, MAX_TEXT);
}

/** Seconds between reconnect attempts, then the cap; a `welcome` resets the sequence. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 15] as const;
const BACKOFF_CAP_SECONDS = 30;

/**
 * The one native messaging port to the Atd shell (`chrome.runtime.connectNative`). An open port
 * keeps the MV3 service worker alive; while the channel is down the worker may be stopped between
 * backoff attempts, which is why the entry module connects again at startup. Inbound messages go
 * through `decodeShellMessage`; nothing reaches `events.frame` unvalidated.
 */
export class NativeChannel {
  private port: chrome.runtime.Port | undefined;
  /** Bumped by every attempt, so a slow `hello` of a superseded attempt opens nothing. */
  private attempt = 0;
  private opening = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly chunks = new ChunkJoiner();

  constructor(private readonly events: NativeChannelEvents) {}

  /** Whether a port is open and its `hello` went out. */
  get isOpen(): boolean {
    return this.port !== undefined;
  }

  /** Connects unless a port is open or an attempt is under way. */
  connect(): void {
    if (this.port !== undefined || this.opening) return;
    this.cancelRetry();
    this.opening = true;
    const attempt = ++this.attempt;
    this.events.hello().then(
      (hello) => {
        if (attempt !== this.attempt) return;
        this.opening = false;
        this.open(hello);
      },
      (error: unknown) => {
        if (attempt !== this.attempt) return;
        this.opening = false;
        console.warn('[atd] could not prepare the hello frame', error);
        this.events.closed('disconnected');
        this.scheduleRetry();
      },
    );
  }

  /** Drops the current port (if any) and connects again now, with a fresh backoff. */
  reconnectNow(): void {
    this.cancelRetry();
    this.failures = 0;
    const port = this.port;
    this.port = undefined;
    this.opening = false;
    this.attempt += 1;
    this.chunks.clear();
    // A port closed from this side fires no onDisconnect here, so the close is reported directly.
    if (port !== undefined) {
      port.disconnect();
      this.events.closed('disconnected');
    }
    this.connect();
  }

  /**
   * Stops reconnecting after a permanent shell rejection and closes the port. Clears `this.port`
   * before disconnecting so any late `onDisconnect` is ignored; `reconnectNow()` or a fresh worker
   * `boot()` can still retry cleanly.
   */
  halt(reason: HaltReason): void {
    this.cancelRetry();
    this.failures = 0;
    const port = this.port;
    this.port = undefined;
    this.opening = false;
    this.attempt += 1;
    this.chunks.clear();
    port?.disconnect();
    this.events.closed(reason);
  }

  /** A `welcome` arrived: the next failure starts the backoff from its first step again. */
  resetBackoff(): void {
    this.failures = 0;
  }

  send(frame: OutboundFrame): boolean {
    const port = this.port;
    if (port === undefined) return false;
    try {
      port.postMessage({ v: CHROME_CHANNEL_PROTOCOL, ...frame });
      return true;
    } catch (error) {
      console.warn(`[atd] could not send "${frame.t}"`, error);
      return false;
    }
  }

  private open(hello: ExtensionFrameBody<'hello'>): void {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
      console.warn('[atd] connectNative failed', error);
      this.events.closed('disconnected');
      this.scheduleRetry();
      return;
    }
    this.port = port;
    port.onMessage.addListener((message: unknown) => this.receive(port, message));
    port.onDisconnect.addListener(() => this.disconnected(port));
    this.send(hello);
  }

  private receive(port: chrome.runtime.Port, message: unknown): void {
    if (port !== this.port) return;
    const frame = decodeShellMessage(message, this.chunks);
    if (frame !== undefined) this.events.frame(frame);
  }

  private disconnected(port: chrome.runtime.Port): void {
    // Reading lastError also keeps Chrome from logging it as unchecked.
    const message = chrome.runtime.lastError?.message ?? '';
    if (port !== this.port) return;
    this.port = undefined;
    this.chunks.clear();
    this.events.closed(closeReason(message));
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.cancelRetry();
    const seconds = BACKOFF_SECONDS[this.failures] ?? BACKOFF_CAP_SECONDS;
    this.failures += 1;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, seconds * 1000);
  }

  private cancelRetry(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/**
 * Chrome's disconnect message for a host it cannot use: "Specified native messaging host not
 * found." (Atd not installed, or never opened to install the host manifest) or "Access to the
 * specified native messaging host is forbidden." (a manifest that does not list this extension).
 */
function closeReason(message: string): CloseReason {
  const text = message.toLowerCase();
  const unusable =
    text.includes('native messaging host not found') || text.includes('host is forbidden');
  return unusable ? 'hostMissing' : 'disconnected';
}
