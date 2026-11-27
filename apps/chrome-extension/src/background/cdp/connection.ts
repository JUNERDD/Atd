// Adapted from Playwright (https://github.com/microsoft/playwright), Copyright (c) Microsoft
// Corporation, Apache License 2.0; see licenses/playwright-core-LICENSE and -NOTICE. Command
// emulation follows `CDPRelayServer._handleCDPCommand` and `ExtensionProtocolV2.handleCDPCommand`
// (packages/playwright-core/src/tools/mcp/cdpRelay.ts and cdpRelayV2.ts, playwright-core 1.65.1),
// restricted to owned tabs and an allowlist (`policy.ts`).

import type { BackgroundDiagReporter } from '../../diagnostics/recorder.ts';
import type { Debuggee, PageTargetInfo } from './debuggee.ts';
import {
  CDP_ERROR,
  cdpAttachDiagnostic,
  CdpError,
  parseCommand,
  refused,
  stringParam,
  type CdpOutbound,
  type CdpParams,
} from './messages.ts';
import { navigationCommand } from './navigation.ts';
import { isForwarded } from './policy.ts';
import { BROWSER_TARGET_ID, SessionTable } from './sessions.ts';

/** What a connection needs from the extension. */
export interface CdpHost {
  debuggee: Debuggee;
  /** Owned tabs of active runs: the only tabs a connection may see (D9). */
  visibleTabs(): readonly number[];
  /** Opens a background tab in the Atd group for the run that took a tab most recently. */
  openTab(url: string): Promise<number>;
  closeTab(tabId: number): Promise<void>;
  /** The browser's version for `Browser.getVersion`. */
  version(): Promise<string>;
  emit(message: CdpOutbound): void;
  /** The tabs this connection uses changed; attachments nobody uses can go. */
  changed(): void;
  onDiagnostic?: BackgroundDiagReporter;
}

/**
 * A worker's targets have a browser context id; a tab session whose info lacks one would be
 * detached by Playwright, so it gets the id of the one context the endpoint exposes.
 */
const DEFAULT_CONTEXT_ID = 'atd-default-context';

/**
 * One worker connection (`cdp.open {conn}`): an emulated browser endpoint that shows the worker
 * only the owned tabs of active runs. The root and browser sessions answer `Browser.getVersion`
 * and the `Target.*` methods Playwright needs themselves; a tab's session and its child sessions
 * forward the allowlisted methods to `chrome.debugger` and every event back.
 */
export class CdpConnection {
  private autoAttach = false;
  private closed = false;
  private readonly sessions = new SessionTable();
  private readonly announcing = new Map<number, Promise<void>>();
  /** Tabs the worker detached from on purpose: not announced to it again. */
  private readonly declined = new Set<number>();

  constructor(private readonly host: CdpHost) {}

  /** Tabs this connection uses, announced or being announced: they keep their attachment. */
  usedTabs(): number[] {
    return [...new Set([...this.sessions.announcedTabs(), ...this.announcing.keys()])];
  }

  async handle(text: string): Promise<void> {
    const parsed = parseCommand(text);
    if (!parsed.ok) {
      if (parsed.id !== undefined)
        this.respondError(
          parsed.id,
          parsed.sessionId,
          new CdpError('Invalid command.', CDP_ERROR.invalidRequest),
        );
      return;
    }
    const { id, method, sessionId } = parsed.command;
    try {
      const result = await this.dispatch(method, parsed.command.params ?? {}, sessionId);
      if (!this.closed)
        this.host.emit({ id, ...(sessionId === undefined ? {} : { sessionId }), result });
    } catch (error) {
      this.respondError(
        id,
        sessionId,
        error instanceof CdpError
          ? error
          : new CdpError(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** Announces visible tabs not yet announced and withdraws tabs that are no longer visible. */
  async reconcile(): Promise<void> {
    if (this.closed) return;
    const visible = new Set(this.host.visibleTabs());
    for (const tabId of this.sessions.announcedTabs())
      if (!visible.has(tabId)) this.withdraw(tabId);
    for (const tabId of this.declined) if (!visible.has(tabId)) this.declined.delete(tabId);
    if (!this.autoAttach) return;
    const missing = [...visible].filter(
      (tabId) => this.sessions.tabSession(tabId) === undefined && !this.declined.has(tabId),
    );
    await Promise.all(
      missing.map((tabId) =>
        this.announce(tabId).catch((error: unknown) => {
          console.info(`[atd] could not attach to tab ${tabId}`, error);
        }),
      ),
    );
  }

  /** The tab's attachment ended or it stopped being visible: the worker sees it detach. */
  withdraw(tabId: number): void {
    for (const event of this.sessions.removeTab(tabId)) this.host.emit(event);
  }

  /** An event of a tab's session or child session, delivered when the tab is announced here. */
  event(tabId: number, child: string | undefined, method: string, params: CdpParams): void {
    const sessionId = this.sessions.tabSession(tabId);
    if (sessionId === undefined || this.closed) return;
    this.host.emit({ sessionId: child ?? sessionId, method, params });
  }

  close(): void {
    this.closed = true;
    this.sessions.clear();
  }

  private dispatch(
    method: string,
    params: CdpParams,
    sessionId: string | undefined,
  ): Promise<object> {
    if (sessionId === undefined) return this.browserCommand(method, params, undefined);
    const route = this.sessions.route(sessionId);
    if (route?.kind === 'browser') return this.browserCommand(method, params, sessionId);
    if (route !== undefined) return this.tabCommand(route.tabId, undefined, method, params);
    const tabId = this.host.debuggee.tabOfChild(sessionId);
    if (tabId !== undefined && this.sessions.tabSession(tabId) !== undefined)
      return this.tabCommand(tabId, sessionId, method, params);
    return Promise.reject(
      new CdpError('Session with given id not found.', CDP_ERROR.sessionNotFound),
    );
  }

  /** The root session (`session` undefined) or a browser session created on it. */
  private async browserCommand(
    method: string,
    params: CdpParams,
    session: string | undefined,
  ): Promise<object> {
    switch (method) {
      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: `Chrome/${await this.host.version()}`,
          revision: '',
          userAgent: navigator.userAgent,
          jsVersion: '',
        };
      // Accepted and ignored: downloads stay the person's. A worker with `noDefaults` never sends it.
      case 'Browser.setDownloadBehavior':
        return {};
      case 'Target.setAutoAttach':
        if (session !== undefined) throw refused(method);
        return this.setAutoAttach(params);
      case 'Target.getTargetInfo':
        return this.browserTargetInfo(params);
      case 'Target.attachToBrowserTarget':
        return { sessionId: this.sessions.addBrowser(session) };
      case 'Target.attachToTarget':
        return this.attachToTarget(params, session);
      case 'Target.detachFromTarget':
        return this.detachFromTarget(params);
      case 'Target.createTarget':
        return this.createTarget(params);
      case 'Target.closeTarget':
        return this.closeTarget(params);
      // Never raises a tab or window in the person's browser.
      case 'Target.activateTarget':
        return {};
      case 'Browser.getWindowForTarget':
        throw new CdpError('Atd for Chrome does not expose browser windows.');
      default:
        throw refused(method);
    }
  }

  /** A tab's session (`child` undefined) or one of its child sessions. */
  private async tabCommand(
    tabId: number,
    child: string | undefined,
    method: string,
    params: CdpParams,
  ): Promise<object> {
    const debuggee = this.host.debuggee;
    switch (method) {
      case 'Page.bringToFront':
      case 'Target.activateTarget':
        return {};
      // The session's own target only: a `targetId` naming another target is not passed on.
      case 'Target.getTargetInfo':
        if (child !== undefined) return debuggee.send(tabId, child, method, {});
        return { targetInfo: pageInfo(await debuggee.targetInfo(tabId)) };
      case 'Target.setAutoAttach':
        if (params['flatten'] !== true) throw flatOnly();
        return debuggee.send(tabId, child, method, params);
      case 'Target.detachFromTarget': {
        const target = stringParam(params, 'sessionId');
        if (target === undefined || debuggee.tabOfChild(target) !== tabId)
          throw new CdpError('No session with given id found.', CDP_ERROR.invalidParams);
        return debuggee.send(tabId, child, method, params);
      }
      default: {
        if (!isForwarded(method)) throw refused(method);
        const send = (name: string, args: CdpParams): Promise<object> =>
          debuggee.send(tabId, child, name, args);
        return navigationCommand(method, params, send) ?? send(method, params);
      }
    }
  }

  private async setAutoAttach(params: CdpParams): Promise<object> {
    if (params['flatten'] !== true) throw flatOnly();
    this.autoAttach = params['autoAttach'] === true;
    if (this.autoAttach) await this.reconcile();
    else for (const tabId of this.sessions.announcedTabs()) this.withdraw(tabId);
    this.host.changed();
    return {};
  }

  private async browserTargetInfo(params: CdpParams): Promise<object> {
    const targetId = stringParam(params, 'targetId');
    if (targetId === undefined || targetId === BROWSER_TARGET_ID)
      return {
        targetInfo: {
          targetId: BROWSER_TARGET_ID,
          type: 'browser',
          title: '',
          url: '',
          attached: true,
          canAccessOpener: false,
        },
      };
    const tabId = this.tabOfTarget(targetId);
    return { targetInfo: pageInfo(await this.host.debuggee.targetInfo(tabId)) };
  }

  private attachToTarget(params: CdpParams, parent: string | undefined): object {
    if (params['flatten'] !== true) throw flatOnly();
    const tabId = this.tabOfTarget(stringParam(params, 'targetId'));
    return { sessionId: this.sessions.addAlias(tabId, parent) };
  }

  private detachFromTarget(params: CdpParams): object {
    const sessionId = stringParam(params, 'sessionId');
    const route = sessionId === undefined ? undefined : this.sessions.route(sessionId);
    if (sessionId === undefined || route === undefined)
      throw new CdpError('No session with given id found.', CDP_ERROR.invalidParams);
    if (route.kind === 'tab') {
      this.declined.add(route.tabId);
      this.withdraw(route.tabId);
      this.host.changed();
    } else {
      const event = this.sessions.removeAlias(sessionId);
      if (event !== undefined) this.host.emit(event);
    }
    return {};
  }

  /** Playwright reads the new page as soon as this answers, so the tab is announced first. */
  private async createTarget(params: CdpParams): Promise<object> {
    const url = stringParam(params, 'url') || 'about:blank';
    const tabId = await this.host.openTab(url);
    this.declined.delete(tabId);
    await this.announce(tabId);
    const targetId = this.sessions.targetOf(tabId);
    if (targetId === undefined) throw new CdpError('The new tab could not be attached.');
    return { targetId };
  }

  private async closeTarget(params: CdpParams): Promise<object> {
    await this.host.closeTab(this.tabOfTarget(stringParam(params, 'targetId')));
    return { success: true };
  }

  private announce(tabId: number): Promise<void> {
    if (this.sessions.tabSession(tabId) !== undefined) return Promise.resolve();
    const pending = this.announcing.get(tabId);
    if (pending !== undefined) return pending;
    const task = this.attachAndAnnounce(tabId)
      .catch((error: unknown) => {
        this.host.onDiagnostic?.(cdpAttachDiagnostic(tabId, error));
        throw error;
      })
      .finally(() => this.announcing.delete(tabId));
    this.announcing.set(tabId, task);
    return task;
  }

  /** Attaches the debugger, then tells the worker as Chrome's auto-attach would. */
  private async attachAndAnnounce(tabId: number): Promise<void> {
    if (!this.host.visibleTabs().includes(tabId))
      throw new CdpError('The tab is not handed to a run.');
    await this.host.debuggee.attach(tabId);
    const info = await this.host.debuggee.targetInfo(tabId);
    if (this.closed || !this.host.visibleTabs().includes(tabId)) {
      // The connection closed or the tab's run ended meanwhile: the attachment may be unused.
      this.host.changed();
      return;
    }
    if (this.sessions.tabSession(tabId) !== undefined) return;
    const sessionId = this.sessions.addTab(tabId, info.targetId);
    this.host.emit({
      method: 'Target.attachedToTarget',
      params: { sessionId, targetInfo: pageInfo(info), waitingForDebugger: false },
    });
  }

  private tabOfTarget(targetId: string | undefined): number {
    const tabId = targetId === undefined ? undefined : this.sessions.tabOfTarget(targetId);
    if (tabId === undefined)
      throw new CdpError('No target with given id found.', CDP_ERROR.invalidParams);
    return tabId;
  }

  private respondError(id: number, sessionId: string | undefined, error: CdpError): void {
    if (this.closed) return;
    const message = { code: error.code, message: error.message };
    this.host.emit({ id, ...(sessionId === undefined ? {} : { sessionId }), error: message });
  }
}

function pageInfo(info: PageTargetInfo): object {
  return { ...info, browserContextId: info.browserContextId ?? DEFAULT_CONTEXT_ID, attached: true };
}

function flatOnly(): CdpError {
  return new CdpError('Only flat sessions are supported.', CDP_ERROR.invalidParams);
}
