import { Value } from 'typebox/value';
import {
  ContentMessageSchema,
  type BackgroundToContent,
  type ContentMessage,
} from '../messages/content.ts';
import {
  PopupMessageSchema,
  type BackgroundToPopup,
  type PopupMessage,
} from '../messages/popup.ts';
import { CONTENT_PORT, POPUP_PORT } from '../messages/ports.ts';
import type { PopupView, TabView } from '../messages/views.ts';

/** A content message other than the `ready` handshake, which this module answers itself. */
export type ContentIntent = Exclude<ContentMessage, { type: 'ready' }>;

export interface SurfaceViews {
  popup(): PopupView;
  tab(tabId: number, url: string): TabView;
}

export interface SurfaceHandlers {
  content(tabId: number, intent: ContentIntent): void;
  /** A content message that failed validation (it may name a request to fail). */
  invalidContent(tabId: number, message: unknown): void;
  popup(intent: PopupMessage): void;
  /** A popup opened: refresh what Chrome sends no event for (the ask shortcut). */
  popupOpened(): void;
}

interface ContentPort {
  port: chrome.runtime.Port;
  /** Set by the content script's `ready`; nothing is posted to it before. */
  ready: boolean;
  /** The tab's URL, which decides its `site`. */
  url: string;
  /** The serialized view posted last, so an unchanged view is not posted again. */
  sent: string;
}

/**
 * The extension's own surfaces: one content port per tab (top frame only) and the popup's ports.
 * Every message is validated before it reaches a handler (a compromised renderer can send
 * anything on a content port). Views are pushed on connect and on every change, coalesced into
 * one push per microtask and skipped when a surface already shows the same view.
 */
export class Surfaces {
  private readonly tabs = new Map<number, ContentPort>();
  private readonly popups = new Map<chrome.runtime.Port, { sent: string }>();
  private readonly waiters = new Map<number, Set<() => void>>();
  private scheduled = false;

  constructor(
    private readonly views: SurfaceViews,
    private readonly handlers: SurfaceHandlers,
  ) {}

  /** `chrome.runtime.onConnect`: takes the extension's own ports and closes anything else. */
  accept(port: chrome.runtime.Port): void {
    if (port.sender?.id !== chrome.runtime.id) port.disconnect();
    else if (port.name === CONTENT_PORT) this.acceptContent(port);
    else if (port.name === POPUP_PORT) this.acceptPopup(port);
    else port.disconnect();
  }

  /** Pushes current views to every surface, once per microtask however often it is called. */
  schedulePush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /** Posts to the tab's content script; false when it has none that said `ready`. */
  postToTab(tabId: number, message: BackgroundToContent): boolean {
    const entry = this.tabs.get(tabId);
    if (entry?.ready !== true) return false;
    return post(entry.port, message);
  }

  hasContent(tabId: number): boolean {
    return this.tabs.get(tabId)?.ready === true;
  }

  /** Tabs whose content script said `ready`. */
  contentTabs(): number[] {
    return [...this.tabs].filter(([, entry]) => entry.ready).map(([tabId]) => tabId);
  }

  /** Resolves true once the tab's content script says `ready`, false after `timeoutMs`. */
  waitForContent(tabId: number, timeoutMs: number): Promise<boolean> {
    if (this.hasContent(tabId)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiting = this.waiters.get(tabId) ?? new Set<() => void>();
      this.waiters.set(tabId, waiting);
      const finish = (ready: boolean): void => {
        clearTimeout(timer);
        waiting.delete(onReady);
        if (waiting.size === 0) this.waiters.delete(tabId);
        resolve(ready);
      };
      const onReady = (): void => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      waiting.add(onReady);
    });
  }

  /** A tab navigated: its site (and so its view) may have changed. */
  noteUrl(tabId: number, url: string): void {
    const entry = this.tabs.get(tabId);
    if (entry === undefined || entry.url === url) return;
    entry.url = url;
    this.schedulePush();
  }

  private acceptContent(port: chrome.runtime.Port): void {
    const tab = port.sender?.tab;
    if (tab?.id === undefined || port.sender?.frameId !== 0) {
      port.disconnect();
      return;
    }
    const tabId = tab.id;
    // A new document in the tab replaces the old entry; an older port is not closed, because its
    // content script would only reconnect.
    this.tabs.set(tabId, { port, ready: false, url: tab.url ?? '', sent: '' });
    port.onMessage.addListener((message: unknown) => this.contentMessage(tabId, port, message));
    port.onDisconnect.addListener(() => {
      if (this.tabs.get(tabId)?.port === port) this.tabs.delete(tabId);
    });
  }

  private contentMessage(tabId: number, port: chrome.runtime.Port, message: unknown): void {
    if (!Value.Check(ContentMessageSchema, message)) {
      this.handlers.invalidContent(tabId, message);
      return;
    }
    if (message.type !== 'ready') {
      this.handlers.content(tabId, message);
      return;
    }
    const entry = this.tabs.get(tabId);
    if (entry?.port !== port) return;
    entry.ready = true;
    entry.sent = '';
    for (const onReady of this.waiters.get(tabId) ?? []) onReady();
    this.schedulePush();
  }

  private acceptPopup(port: chrome.runtime.Port): void {
    // Only the extension's own pages: a content script could otherwise pose as the popup.
    if (!(port.sender?.url ?? '').startsWith(chrome.runtime.getURL(''))) {
      port.disconnect();
      return;
    }
    this.popups.set(port, { sent: '' });
    port.onMessage.addListener((message: unknown) => {
      if (Value.Check(PopupMessageSchema, message)) this.handlers.popup(message);
      else console.warn('[atd] dropped an invalid popup message');
    });
    port.onDisconnect.addListener(() => this.popups.delete(port));
    this.handlers.popupOpened();
    this.schedulePush();
  }

  private flush(): void {
    if (this.popups.size > 0) {
      const view = this.views.popup();
      const text = JSON.stringify(view);
      const message: BackgroundToPopup = { type: 'state', view };
      for (const [port, entry] of this.popups) {
        if (entry.sent === text) continue;
        if (post(port, message)) entry.sent = text;
        else this.popups.delete(port);
      }
    }
    for (const [tabId, entry] of this.tabs) {
      if (!entry.ready) continue;
      const view = this.views.tab(tabId, entry.url);
      const text = JSON.stringify(view);
      if (entry.sent === text) continue;
      if (post(entry.port, { type: 'state', view })) entry.sent = text;
      else this.tabs.delete(tabId);
    }
  }
}

/** Posts on a port that may have closed meanwhile; false when it has. */
function post(
  port: chrome.runtime.Port,
  message: BackgroundToContent | BackgroundToPopup,
): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}
