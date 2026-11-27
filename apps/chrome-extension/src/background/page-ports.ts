import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** Where a page's intent came from: a way back to that page, and its tab when it has one. */
export interface PageSender<Out> {
  /** Posts to the page the intent came from; false once it has closed. */
  reply: (message: Out) => boolean;
  /** The page's tab (an options page's); none for the side panel or the toolbar popup. */
  tab: chrome.tabs.Tab | undefined;
}

/** One kind of the extension's own pages, as `PagePorts` serves it. */
export interface PageKind<Schema extends TSchema, Out> {
  /** Names the kind in the warning for a message that failed validation. */
  label: string;
  /** What every message from such a page must be before `handle` sees it. */
  schema: Schema;
  /** The page's current `state` message, posted on connect and whenever it changes. */
  state(): Out;
  handle(message: Static<Schema>, from: PageSender<Out>): void;
  /** Called when a page sends a message that fails schema validation. */
  invalid?(): void;
  /** A page of this kind connected. */
  opened(): void;
}

/**
 * The open pages of one kind among the extension's own pages (panels, options pages): one port
 * each, for as long as the page is open. Only the extension's own pages may connect, because a
 * content script could otherwise pose as one, and every message is validated before it reaches
 * the handler. `push` posts the current state to every page that does not already show it.
 */
export class PagePorts<Schema extends TSchema, Out> {
  /** Each open page, with the serialized state posted to it last. */
  private readonly ports = new Map<chrome.runtime.Port, { sent: string }>();

  constructor(private readonly kind: PageKind<Schema, Out>) {}

  /** A port of this kind from a sender the caller checked is this extension. */
  accept(port: chrome.runtime.Port): void {
    if (!(port.sender?.url ?? '').startsWith(chrome.runtime.getURL(''))) {
      port.disconnect();
      return;
    }
    this.ports.set(port, { sent: '' });
    const from: PageSender<Out> = {
      reply: (message) => this.ports.has(port) && post(port, message),
      tab: port.sender?.tab,
    };
    port.onMessage.addListener((message: unknown) => {
      if (Value.Check(this.kind.schema, message)) this.kind.handle(message, from);
      else {
        console.warn(`[atd] dropped an invalid ${this.kind.label} message`);
        this.kind.invalid?.();
      }
    });
    port.onDisconnect.addListener(() => this.ports.delete(port));
    this.kind.opened();
  }

  /** Posts the current state where it changed; a page whose port has closed is dropped. */
  push(): void {
    if (this.ports.size === 0) return;
    const message = this.kind.state();
    const text = JSON.stringify(message);
    for (const [port, entry] of this.ports) {
      if (entry.sent === text) continue;
      if (post(port, message)) entry.sent = text;
      else this.ports.delete(port);
    }
  }
}

/** Posts on a port that may have closed meanwhile; false when it has. */
export function post(port: chrome.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}
