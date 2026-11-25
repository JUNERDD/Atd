import type { BackgroundToContent } from '../messages/content.ts';
import type { AskFailure } from '../messages/views.ts';
import type { Surfaces } from './surfaces.ts';

/** How long an unanswered request is remembered (the shell answers in seconds). */
const MAX_AGE_MS = 10 * 60_000;

export interface PendingRequest {
  tabId: number;
  /** Whether the ask carried the tab's page. */
  withPage: boolean;
  at: number;
}

/**
 * Asks a tab sent through the shell, by request id, so the shell's answers (`ask.accepted` /
 * `ask.failed`, an `error` naming the request) reach the tab that asked.
 */
export class PendingRequests {
  private readonly byId = new Map<string, PendingRequest>();

  constructor(private readonly surfaces: Surfaces) {}

  remember(requestId: string, tabId: number, withPage: boolean): void {
    const now = Date.now();
    for (const [id, entry] of this.byId) if (now - entry.at > MAX_AGE_MS) this.byId.delete(id);
    this.byId.set(requestId, { tabId, withPage, at: now });
  }

  /**
   * Delivers Atd's answer to the asking tab and forgets the request. Returns the request, or
   * undefined when none has this id (the answer is then dropped).
   */
  deliver(requestId: string, message: BackgroundToContent): PendingRequest | undefined {
    const entry = this.byId.get(requestId);
    if (entry === undefined) return undefined;
    this.byId.delete(requestId);
    this.surfaces.postToTab(entry.tabId, message);
    return entry;
  }

  /** Whether an ask with its page from `tabId` still waits for Atd's answer. */
  awaitsAskWithPage(tabId: number): boolean {
    for (const entry of this.byId.values())
      if (entry.withPage && entry.tabId === tabId) return true;
    return false;
  }

  /** Fails the request an `error` frame names; false if none matches. */
  fail(requestId: string, reason: AskFailure): boolean {
    const entry = this.byId.get(requestId);
    if (entry === undefined) return false;
    this.byId.delete(requestId);
    this.surfaces.postToTab(entry.tabId, failure(requestId, reason));
    return true;
  }

  /** The channel closed: no answer will come for any request. */
  failAll(reason: AskFailure): void {
    for (const requestId of this.byId.keys()) this.fail(requestId, reason);
  }
}

/** An ask's failure as its tab shows it: the code, for which the HUD has copy. */
export function failure(requestId: string, reason: AskFailure): BackgroundToContent {
  return { type: 'ask.status', requestId, state: 'failed', reason };
}
