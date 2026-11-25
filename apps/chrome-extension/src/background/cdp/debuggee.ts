// Adapted from Playwright (https://github.com/microsoft/playwright), Copyright (c) Microsoft
// Corporation, Apache License 2.0; see licenses/playwright-core-LICENSE and -NOTICE. The
// per-tab attachment and child-session routing follow `BrowserModel` in
// packages/playwright-core/src/tools/mcp/browserModel.ts (playwright-core 1.65.1).

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { CdpError, debuggerError, type CdpParams } from './messages.ts';

/** The `chrome.debugger` protocol version the worker's Playwright speaks. */
const PROTOCOL_VERSION = '1.3';
/** Tabs attached in this browser session, so a restarted worker can detach what it left behind. */
const SESSION_KEY = 'atd.debuggerTabs';

const TargetInfoResultSchema = Type.Object({
  targetInfo: Type.Object({
    targetId: Type.String({ minLength: 1, maxLength: 128 }),
    type: Type.String(),
    url: Type.String(),
    title: Type.String(),
    browserContextId: Type.Optional(Type.String()),
  }),
});
/** A tab's `Target.getTargetInfo`; the object keeps every field Chrome sent. */
export type PageTargetInfo = Static<typeof TargetInfoResultSchema>['targetInfo'];

export interface DebuggeeEvents {
  /** An event of an attached tab's session (`child` undefined) or of one of its child sessions. */
  event(tabId: number, child: string | undefined, method: string, params: CdpParams): void;
  /**
   * Atd is about to dispatch input into the tab (`Input.*`). The page sees it as trusted input,
   * so the person's activity reports that follow it are Atd's own and must not mark the tab in use.
   */
  input(tabId: number): void;
}

/**
 * The extension's `chrome.debugger` attachments, one per tab and shared by every worker
 * connection, with the flat child sessions (OOPIFs, workers; Chrome 125+) each tab announced.
 * Only `translator.ts` decides which tabs are attached; this module never attaches on its own.
 */
export class Debuggee {
  /** Attached tabs and the child sessions each announced. */
  private readonly attached = new Map<number, Set<string>>();
  private readonly attaching = new Map<number, Promise<void>>();
  /** Detaches in flight: attaching the same tab again waits for them. */
  private readonly detaching = new Map<number, Promise<void>>();

  constructor(private readonly events: DebuggeeEvents) {}

  /**
   * Detaches what a previous worker lifetime left attached: its channel (and every worker
   * connection) died with it, so no tab needs the debugger now.
   */
  async restore(): Promise<void> {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const value: unknown = stored[SESSION_KEY];
    if (Value.Check(Type.Array(Type.Integer({ minimum: 0 })), value))
      await Promise.all(
        value.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => undefined)),
      );
    await chrome.storage.session.remove(SESSION_KEY);
  }

  attachedTabs(): number[] {
    return [...this.attached.keys()];
  }

  /** Attaches to the tab unless it already is; concurrent callers share one attempt. */
  attach(tabId: number): Promise<void> {
    if (this.attached.has(tabId)) return Promise.resolve();
    const pending = this.attaching.get(tabId);
    if (pending !== undefined) return pending;
    const attempt = this.attachNow(tabId).finally(() => this.attaching.delete(tabId));
    this.attaching.set(tabId, attempt);
    return attempt;
  }

  detach(tabId: number): Promise<void> {
    if (!this.attached.delete(tabId)) return this.detaching.get(tabId) ?? Promise.resolve();
    this.persist();
    const detaching = chrome.debugger
      .detach({ tabId })
      .catch(() => undefined)
      .finally(() => this.detaching.delete(tabId));
    this.detaching.set(tabId, detaching);
    return detaching;
  }

  /** Chrome ended the attachment (`onDetach`); true when the tab was attached. */
  forget(tabId: number): boolean {
    const known = this.attached.delete(tabId);
    if (known) this.persist();
    return known;
  }

  /** The attached tab a child session belongs to. */
  tabOfChild(sessionId: string): number | undefined {
    for (const [tabId, children] of this.attached) if (children.has(sessionId)) return tabId;
    return undefined;
  }

  async targetInfo(tabId: number): Promise<PageTargetInfo> {
    const result = await this.send(tabId, undefined, 'Target.getTargetInfo', {});
    if (!Value.Check(TargetInfoResultSchema, result))
      throw new CdpError('Chrome sent no target info for the tab.');
    return result.targetInfo;
  }

  /**
   * Sends one command to the tab's session or a child session. `chrome.debugger.sendCommand` is
   * called before the first `await`, so commands reach Chrome in the order they arrived.
   */
  async send(
    tabId: number,
    child: string | undefined,
    method: string,
    params: CdpParams,
  ): Promise<object> {
    if (!this.attached.has(tabId)) throw new CdpError('Target closed.');
    if (method.startsWith('Input.')) this.events.input(tabId);
    const target: chrome.debugger.DebuggerSession =
      child === undefined ? { tabId } : { tabId, sessionId: child };
    try {
      return (await chrome.debugger.sendCommand(target, method, params)) ?? {};
    } catch (error) {
      throw debuggerError(error);
    }
  }

  /** `chrome.debugger.onEvent`: records child sessions, then hands the event on. */
  handleEvent(
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: CdpParams | undefined,
  ): void {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    const children = this.attached.get(tabId);
    if (children === undefined) return;
    const child = source.sessionId;
    if (child !== undefined && !children.has(child)) return;
    const payload = params ?? {};
    const announced = payload['sessionId'];
    if (method === 'Target.attachedToTarget' && typeof announced === 'string')
      children.add(announced);
    this.events.event(tabId, child, method, payload);
    if (method === 'Target.detachedFromTarget' && typeof announced === 'string')
      children.delete(announced);
  }

  private async attachNow(tabId: number): Promise<void> {
    await this.detaching.get(tabId);
    try {
      await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
    } catch (error) {
      // An attachment this extension still holds from before the worker restarted.
      if (!(error instanceof Error && error.message.includes('already attached'))) throw error;
    }
    this.attached.set(tabId, new Set());
    this.persist();
  }

  private persist(): void {
    chrome.storage.session.set({ [SESSION_KEY]: this.attachedTabs() }).catch(() => undefined);
  }
}
