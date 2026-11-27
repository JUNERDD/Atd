import { buildDiagEvent, summarizeError } from '../diagnostics/sanitize.ts';
import type { BackgroundToContent, ContentMessage } from '../messages/content.ts';
import { CONTENT_PORT } from '../messages/ports.ts';
import { signal } from './lifetime.ts';

export interface PortHandlers {
  message(message: BackgroundToContent): void;
  /** The extension was reloaded or removed: this instance is orphaned and must go quietly. */
  invalidated(): void;
}

/** Intents that wait for a reconnect when the port is down. Activity pings are dropped. */
const OUTBOX_LIMIT = 20;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 5000;

/**
 * This tab's port to the service worker. The worker can stop at any time (MV3), which drops the
 * port; so does a page entering the back/forward cache. The port reconnects, sends `ready` and
 * gets the tab's `state` back. When `chrome.runtime.id` is gone the extension context is dead and
 * the instance stops.
 */
export class ContentPort {
  private port: chrome.runtime.Port | null = null;
  private outbox: ContentMessage[] = [];
  private retryMs = RETRY_FIRST_MS;
  private retryTimer = 0;
  private cached = false;
  private dead = false;
  /** At most one explicit port error kept outside `outbox` to report once reconnected. */
  private pendingPortError: { code: string; msg: string } | null = null;

  constructor(private readonly handlers: PortHandlers) {}

  start(): void {
    addEventListener(
      'pagehide',
      (event) => {
        if (!event.persisted) return;
        // A cached page keeps no port; it reconnects when it is shown again.
        this.cached = true;
        this.drop();
      },
      { signal },
    );
    addEventListener(
      'pageshow',
      (event) => {
        if (!event.persisted) return;
        this.cached = false;
        this.connect();
      },
      { signal },
    );
    this.connect();
  }

  /** Sends an intent; while disconnected it waits (bounded) for the next connection. */
  send(message: ContentMessage): void {
    if (this.dead) return;
    if (this.port && this.post(this.port, message)) return;
    if (message.type === 'input' || message.type === 'diag.event') return;
    this.outbox.push(message);
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();
    this.connect();
  }

  private connect(): void {
    if (this.dead || this.cached || this.port) return;
    clearTimeout(this.retryTimer);
    if (!chrome.runtime?.id) return this.invalidate();
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: CONTENT_PORT });
    } catch {
      return this.invalidate();
    }
    this.port = port;
    port.onMessage.addListener((message: BackgroundToContent) => {
      // Any answer proves the worker is up again; the next drop retries quickly.
      this.retryMs = RETRY_FIRST_MS;
      this.handlers.message(message);
    });
    port.onDisconnect.addListener(() => this.disconnected(port));
    if (!this.post(port, { type: 'ready' })) return;
    if (this.pendingPortError !== null) {
      const { code, msg } = this.pendingPortError;
      this.pendingPortError = null;
      this.post(port, buildDiagEvent('warn', 'port', msg, code));
    }
    const pending = this.outbox;
    this.outbox = [];
    for (const message of pending) this.post(port, message);
  }

  private disconnected(port: chrome.runtime.Port): void {
    // Reading lastError marks it handled, so Chrome logs nothing on the page's console.
    const lastError = chrome.runtime.lastError?.message;
    if (this.port !== port) return;
    this.port = null;
    if (!chrome.runtime?.id) return this.invalidate();
    if (this.cached) return;
    if (lastError && this.pendingPortError === null) {
      this.pendingPortError = { code: 'port_disconnected', msg: lastError };
    }
    this.retryTimer = window.setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
  }

  private post(port: chrome.runtime.Port, message: ContentMessage): boolean {
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      if (message.type !== 'diag.event' && chrome.runtime?.id && this.pendingPortError === null) {
        this.pendingPortError = {
          code: 'port_post_failed',
          msg: summarizeError(error, 'Port postMessage failed'),
        };
      }
      // The port closed between its last event and now; treat it as dropped.
      this.disconnected(port);
      return false;
    }
  }

  private drop(): void {
    const port = this.port;
    this.port = null;
    clearTimeout(this.retryTimer);
    try {
      port?.disconnect();
    } catch {
      // Already closed.
    }
  }

  private invalidate(): void {
    if (this.dead) return;
    this.dead = true;
    this.drop();
    this.outbox = [];
    this.handlers.invalidated();
  }
}
