import type { AskFailure, AskStatus } from '../messages/views.ts';

/** How long an unanswered request is remembered (the shell answers in seconds). */
const MAX_AGE_MS = 10 * 60_000;

/** Posts Atd's answer to the surface that asked: the tab's content script, or a panel. */
export type AskAnswer = (status: AskStatus) => void;

export interface PendingRequest {
  /** The tab the ask was made from (the panel's: the tab its window showed). */
  tabId: number;
  /** Whether the ask carried the tab's page. */
  withPage: boolean;
  at: number;
  answer: AskAnswer;
}

/**
 * Asks sent through the shell, by request id, so the shell's answers (`ask.accepted` /
 * `ask.failed`, an `error` naming the request) reach the surface that asked.
 */
export class PendingRequests {
  private readonly byId = new Map<string, PendingRequest>();

  remember(requestId: string, request: Omit<PendingRequest, 'at'>): void {
    const now = Date.now();
    for (const [id, entry] of this.byId) if (now - entry.at > MAX_AGE_MS) this.byId.delete(id);
    this.byId.set(requestId, { ...request, at: now });
  }

  /**
   * Delivers Atd's answer to the surface that asked and forgets the request. Returns the request,
   * or undefined when none has this id (the answer is then dropped).
   */
  deliver(status: AskStatus): PendingRequest | undefined {
    const entry = this.byId.get(status.requestId);
    if (entry === undefined) return undefined;
    this.byId.delete(status.requestId);
    entry.answer(status);
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
    return this.deliver(failure(requestId, reason)) !== undefined;
  }

  /** The channel closed: no answer will come for any request. */
  failAll(reason: AskFailure): void {
    for (const requestId of this.byId.keys()) this.fail(requestId, reason);
  }
}

/** An ask's failure as the surface that asked shows it: the code, for which it has copy. */
export function failure(requestId: string, reason: AskFailure): AskStatus {
  return { type: 'ask.status', requestId, state: 'failed', reason };
}
