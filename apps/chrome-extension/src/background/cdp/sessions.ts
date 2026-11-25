// Adapted from Playwright (https://github.com/microsoft/playwright), Copyright (c) Microsoft
// Corporation, Apache License 2.0; see licenses/playwright-core-LICENSE and -NOTICE. Synthetic
// tab sessions follow `BrowserModel` (packages/playwright-core/src/tools/mcp/browserModel.ts,
// playwright-core 1.65.1); alias sessions are added here for `Target.attachToBrowserTarget` and
// `Target.attachToTarget`, which that relay does not emulate.

import type { CdpOutbound } from './messages.ts';

/**
 * The sessions one worker connection sees. Ids are synthetic and per connection: `atd-tab-N` for
 * the session a tab is announced with, `atd-alias-N` for a further session on an announced tab
 * (`Target.attachToTarget`, which the worker uses to read a page's target info), `atd-browser-N`
 * for a browser session (`Target.attachToBrowserTarget`). Child sessions of a tab (iframes,
 * workers) keep Chrome's own ids, which never take this form.
 */
export type SessionRoute =
  | { kind: 'tab'; tabId: number; targetId: string }
  /** `parent`: the session the alias was created on (undefined: the root). */
  | { kind: 'alias'; tabId: number; parent: string | undefined }
  | { kind: 'browser'; parent: string | undefined };

/** The browser target's id in the emulated endpoint. */
export const BROWSER_TARGET_ID = 'atd-browser';

export class SessionTable {
  private readonly routes = new Map<string, SessionRoute>();
  private readonly tabSessions = new Map<number, string>();
  private next = 1;

  route(sessionId: string): SessionRoute | undefined {
    return this.routes.get(sessionId);
  }

  /** The session a tab was announced with, if it is announced. */
  tabSession(tabId: number): string | undefined {
    return this.tabSessions.get(tabId);
  }

  announcedTabs(): number[] {
    return [...this.tabSessions.keys()];
  }

  targetOf(tabId: number): string | undefined {
    const sessionId = this.tabSessions.get(tabId);
    const route = sessionId === undefined ? undefined : this.routes.get(sessionId);
    return route?.kind === 'tab' ? route.targetId : undefined;
  }

  tabOfTarget(targetId: string): number | undefined {
    for (const route of this.routes.values())
      if (route.kind === 'tab' && route.targetId === targetId) return route.tabId;
    return undefined;
  }

  addTab(tabId: number, targetId: string): string {
    const sessionId = `atd-tab-${this.next++}`;
    this.routes.set(sessionId, { kind: 'tab', tabId, targetId });
    this.tabSessions.set(tabId, sessionId);
    return sessionId;
  }

  addAlias(tabId: number, parent: string | undefined): string {
    const sessionId = `atd-alias-${this.next++}`;
    this.routes.set(sessionId, { kind: 'alias', tabId, parent });
    return sessionId;
  }

  addBrowser(parent: string | undefined): string {
    const sessionId = `atd-browser-${this.next++}`;
    this.routes.set(sessionId, { kind: 'browser', parent });
    return sessionId;
  }

  /**
   * Withdraws a tab: its announced session and its aliases. Returns the `detachedFromTarget`
   * events that tell the worker, each on the session it would arrive on in Chrome.
   */
  removeTab(tabId: number): CdpOutbound[] {
    const sessionId = this.tabSessions.get(tabId);
    if (sessionId === undefined) return [];
    const targetId = this.targetOf(tabId) ?? '';
    const events: CdpOutbound[] = [];
    for (const [aliasId, route] of this.routes) {
      if (route.kind !== 'alias' || route.tabId !== tabId) continue;
      this.routes.delete(aliasId);
      events.push(detached(aliasId, targetId, route.parent));
    }
    this.routes.delete(sessionId);
    this.tabSessions.delete(tabId);
    events.push(detached(sessionId, targetId, undefined));
    return events;
  }

  /** Ends an alias or browser session; returns its `detachedFromTarget` event. */
  removeAlias(sessionId: string): CdpOutbound | undefined {
    const route = this.routes.get(sessionId);
    if (route === undefined || route.kind === 'tab') return undefined;
    this.routes.delete(sessionId);
    const targetId =
      route.kind === 'browser' ? BROWSER_TARGET_ID : (this.targetOf(route.tabId) ?? '');
    return detached(sessionId, targetId, route.parent);
  }

  clear(): void {
    this.routes.clear();
    this.tabSessions.clear();
  }
}

function detached(sessionId: string, targetId: string, parent: string | undefined): CdpOutbound {
  return {
    method: 'Target.detachedFromTarget',
    params: { sessionId, targetId },
    ...(parent === undefined ? {} : { sessionId: parent }),
  };
}
