import type { BackgroundToContent } from '../messages/content.ts';
import type { AskFailure } from '../messages/views.ts';
import { t } from './i18n.ts';
import type { Surfaces } from './surfaces.ts';

/** How long an unanswered request is remembered (the shell answers in seconds). */
const MAX_AGE_MS = 10 * 60_000;

type RequestKind = 'ask' | 'command';

export interface PendingRequest {
  tabId: number;
  kind: RequestKind;
  /** Whether the request carried the tab's page (a command always does). */
  withPage: boolean;
  at: number;
}

/**
 * Requests a tab sent through the shell (`ask`, `command.run`), by request id, so the shell's
 * answers (`ask.accepted` / `ask.failed`, `command.result`, an `error` naming the request) reach
 * the tab that asked.
 */
export class PendingRequests {
  private readonly byId = new Map<string, PendingRequest>();

  constructor(private readonly surfaces: Surfaces) {}

  remember(requestId: string, tabId: number, kind: RequestKind, withPage: boolean): void {
    const now = Date.now();
    for (const [id, entry] of this.byId) if (now - entry.at > MAX_AGE_MS) this.byId.delete(id);
    this.byId.set(requestId, { tabId, kind, withPage, at: now });
  }

  /**
   * Delivers the answer to the asking tab; `final` forgets the request. Returns the request, or
   * undefined when no request of that kind has this id (the answer is then dropped).
   */
  deliver(
    requestId: string,
    kind: RequestKind,
    message: BackgroundToContent,
    final: boolean,
  ): PendingRequest | undefined {
    const entry = this.byId.get(requestId);
    if (entry?.kind !== kind) return undefined;
    if (final) this.byId.delete(requestId);
    this.surfaces.postToTab(entry.tabId, message);
    return entry;
  }

  /** Whether an ask with its page from `tabId` still waits for Atd's answer. */
  awaitsAskWithPage(tabId: number): boolean {
    for (const entry of this.byId.values())
      if (entry.kind === 'ask' && entry.withPage && entry.tabId === tabId) return true;
    return false;
  }

  /** Fails the request an `error` frame names, whichever kind it is; false if none matches. */
  fail(requestId: string, reason: AskFailure): boolean {
    const entry = this.byId.get(requestId);
    if (entry === undefined) return false;
    this.byId.delete(requestId);
    this.surfaces.postToTab(entry.tabId, failure(requestId, entry.kind, reason));
    return true;
  }

  /** The channel closed: no answer will come for any request. */
  failAll(reason: AskFailure): void {
    for (const requestId of this.byId.keys()) this.fail(requestId, reason);
  }
}

/**
 * A request's failure as its tab shows it: an ask's code (the HUD has copy for each), or a
 * command's text, localized here; a command without text shows the selection bar's generic copy.
 */
export function failure(
  requestId: string,
  kind: RequestKind,
  reason: AskFailure,
): BackgroundToContent {
  if (kind === 'ask') return { type: 'ask.status', requestId, state: 'failed', reason };
  const text = commandFailureText(reason);
  return {
    type: 'command.status',
    requestId,
    state: 'failed',
    ...(text === undefined ? {} : { text }),
  };
}

function commandFailureText(reason: AskFailure): string | undefined {
  switch (reason) {
    case 'notConnected':
      return t('errors.notConnected');
    case 'notPaired':
      return t('errors.notPaired');
    case 'tooLong':
      return t('errors.selectionTooLong');
    case 'otherHost':
    case 'serviceUnavailable':
    case 'failed':
      return undefined;
  }
}
