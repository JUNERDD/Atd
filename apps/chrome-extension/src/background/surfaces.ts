import { Value } from 'typebox/value';
import {
  ContentMessageSchema,
  type BackgroundToContent,
  type ContentMessage,
} from '../messages/content.ts';
import {
  OptionsMessageSchema,
  type BackgroundToOptions,
  type OptionsMessage,
} from '../messages/options.ts';
import {
  PanelMessageSchema,
  type BackgroundToPanel,
  type PanelMessage,
} from '../messages/panel.ts';
import { CONTENT_PORT, OPTIONS_PORT, PANEL_PORT } from '../messages/ports.ts';
import type { OptionsView, PanelView, TabView } from '../messages/views.ts';
import { PagePorts, post } from './page-ports.ts';

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
  options(): OptionsView;
  tab(tabId: number, url: string): TabView;
}

export interface SurfaceHandlers {
  content(tabId: number, intent: ContentIntent, reply: ContentReply): void;
  /** A content message that failed validation (it may name a request to fail). */
  invalidContent(tabId: number, message: unknown): void;
  panel(intent: PanelMessage, reply: PanelReply): void;
  /** An options page's intent; `tab` is the page's own tab. */
  options(intent: OptionsMessage, tab: chrome.tabs.Tab | undefined): void;
  /** A panel or options page opened: refresh what Chrome sends no event for (the shortcuts). */
  pageOpened(): void;
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
 * The extension's own surfaces: one content port per tab (top frame only), and one port per open
 * panel (a window's side panel, or the toolbar popup) and per open options page (`PagePorts`).
 * Every message is validated before it reaches a handler (a compromised renderer can send
 * anything on a content port). Views are pushed on connect and on every change, coalesced into
 * one push per microtask and skipped when a surface already shows the same view.
 */
export class Surfaces {
  private readonly tabs = new Map<number, ContentPort>();
  private readonly panels: PagePorts<typeof PanelMessageSchema, BackgroundToPanel>;
  private readonly options: PagePorts<typeof OptionsMessageSchema, BackgroundToOptions>;
  private readonly waiters = new Map<number, Set<() => void>>();
  private scheduled = false;

  constructor(
    private readonly views: SurfaceViews,
    private readonly handlers: SurfaceHandlers,
  ) {
    const opened = (): void => {
      handlers.pageOpened();
      this.schedulePush();
    };
    this.panels = new PagePorts<typeof PanelMessageSchema, BackgroundToPanel>({
      label: 'panel',
      schema: PanelMessageSchema,
      state: () => ({ type: 'state', view: views.panel() }),
      handle: (intent, from) => handlers.panel(intent, from.reply),
      opened,
    });
    this.options = new PagePorts<typeof OptionsMessageSchema, BackgroundToOptions>({
      label: 'options',
      schema: OptionsMessageSchema,
      state: () => ({ type: 'state', view: views.options() }),
      handle: (intent, from) => handlers.options(intent, from.tab),
      opened,
    });
  }

  /** `chrome.runtime.onConnect`: takes the extension's own ports and closes anything else. */
  accept(port: chrome.runtime.Port): void {
    if (port.sender?.id !== chrome.runtime.id) port.disconnect();
    else if (port.name === CONTENT_PORT) this.acceptContent(port);
    else if (port.name === PANEL_PORT) this.panels.accept(port);
    else if (port.name === OPTIONS_PORT) this.options.accept(port);
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

  private flush(): void {
    this.panels.push();
    this.options.push();
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
