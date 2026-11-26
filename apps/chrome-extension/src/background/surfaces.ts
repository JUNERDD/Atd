import { Value } from 'typebox/value';
import {
  ContentMessageSchema,
  type BackgroundToContent,
  type ContentMessage,
} from '../messages/content.ts';
import {
  PanelMessageSchema,
  type BackgroundToPanel,
  type PanelMessage,
} from '../messages/panel.ts';
import { CONTENT_PORT, PANEL_PORT } from '../messages/ports.ts';
import type { PanelView, TabView } from '../messages/views.ts';

/** A content message other than the `ready` handshake, which this module answers itself. */
export type ContentIntent = Exclude<ContentMessage, { type: 'ready' }>;

/**
 * Posts to the content script an intent came from, only while it is still the tab's current one
 * (an answer meant for one document never reaches the next); false when it is not.
 */
export type ContentReply = (message: BackgroundToContent) => boolean;

/** Posts to the panel an intent came from; false once it has closed. */
export type PanelReply = (message: BackgroundToPanel) => boolean;

export interface SurfaceViews {
  panel(): PanelView;
  tab(tabId: number, url: string): TabView;
}

export interface SurfaceHandlers {
  content(tabId: number, intent: ContentIntent, reply: ContentReply): void;
  /** The tab's content script went away: its port closed, or a new document's replaced it. */
  contentGone(tabId: number): void;
  /** A content message that failed validation (it may name a request to fail). */
  invalidContent(tabId: number, message: unknown): void;
  panel(intent: PanelMessage, reply: PanelReply): void;
  /** A panel opened: refresh what Chrome sends no event for (the ask shortcut). */
  panelOpened(): void;
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
 * The extension's own surfaces: one content port per tab (top frame only) and one port per open
 * panel (a window's side panel, or the toolbar popup).
 * Every message is validated before it reaches a handler (a compromised renderer can send
 * anything on a content port). Views are pushed on connect and on every change, coalesced into
 * one push per microtask and skipped when a surface already shows the same view.
 */
export class Surfaces {
  private readonly tabs = new Map<number, ContentPort>();
  private readonly panels = new Map<chrome.runtime.Port, { sent: string }>();
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
    else if (port.name === PANEL_PORT) this.acceptPanel(port);
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
    const replaced = this.tabs.has(tabId);
    this.tabs.set(tabId, { port, ready: false, url: tab.url ?? '', sent: '' });
    if (replaced) this.handlers.contentGone(tabId);
    port.onMessage.addListener((message: unknown) => this.contentMessage(tabId, port, message));
    port.onDisconnect.addListener(() => {
      if (this.tabs.get(tabId)?.port !== port) return;
      this.tabs.delete(tabId);
      this.handlers.contentGone(tabId);
    });
  }

  private contentMessage(tabId: number, port: chrome.runtime.Port, message: unknown): void {
    if (!Value.Check(ContentMessageSchema, message)) {
      this.handlers.invalidContent(tabId, message);
      return;
    }
    if (message.type !== 'ready') {
      this.handlers.content(tabId, message, (reply) =>
        this.tabs.get(tabId)?.port === port ? post(port, reply) : false,
      );
      return;
    }
    const entry = this.tabs.get(tabId);
    if (entry?.port !== port) return;
    entry.ready = true;
    entry.sent = '';
    for (const onReady of this.waiters.get(tabId) ?? []) onReady();
    this.schedulePush();
  }

  private acceptPanel(port: chrome.runtime.Port): void {
    // Only the extension's own pages: a content script could otherwise pose as the panel.
    if (!(port.sender?.url ?? '').startsWith(chrome.runtime.getURL(''))) {
      port.disconnect();
      return;
    }
    this.panels.set(port, { sent: '' });
    const reply: PanelReply = (message) => this.panels.has(port) && post(port, message);
    port.onMessage.addListener((message: unknown) => {
      if (Value.Check(PanelMessageSchema, message)) this.handlers.panel(message, reply);
      else console.warn('[atd] dropped an invalid panel message');
    });
    port.onDisconnect.addListener(() => this.panels.delete(port));
    this.handlers.panelOpened();
    this.schedulePush();
  }

  private flush(): void {
    if (this.panels.size > 0) {
      const view = this.views.panel();
      const text = JSON.stringify(view);
      const message: BackgroundToPanel = { type: 'state', view };
      for (const [port, entry] of this.panels) {
        if (entry.sent === text) continue;
        if (post(port, message)) entry.sent = text;
        else this.panels.delete(port);
      }
    }
    for (const [tabId, entry] of this.tabs) {
      if (!entry.ready) continue;
      const view = this.views.tab(tabId, entry.url);
      const text = JSON.stringify(view);
      if (entry.sent === text) continue;
      if (post(entry.port, { type: 'state', view })) {
        entry.sent = text;
      } else {
        // Its `onDisconnect` then finds no entry, so this is where the content script goes.
        this.tabs.delete(tabId);
        this.handlers.contentGone(tabId);
      }
    }
  }
}

/** Posts on a port that may have closed meanwhile; false when it has. */
function post(
  port: chrome.runtime.Port,
  message: BackgroundToContent | BackgroundToPanel,
): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}
