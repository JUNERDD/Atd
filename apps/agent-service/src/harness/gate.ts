import type { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  grantKey,
  tierAllows,
  type ConfirmReview,
  type GrantScope,
  type PermissionOutcome,
  type PermissionTier,
} from '@atd/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import { auditUnattended, UNATTENDED_DECLINED } from '../unattended.js';
import { confirmReview, type Reviewer } from './auto-review.js';

/** What the approval gate needs from the task runner; `ServiceToolHost` satisfies it. */
export interface GateHost {
  taskId: string;
  runId: () => string;
  executionId: () => string;
  tier: PermissionTier;
  /** Session grants of the task's runner, keyed by `grantKey(scope)`; shared by every gated tool. */
  grants: Set<string>;
  sessions: SessionManager;
  confirms: ConfirmStore;
  /** The `auto` tier's review (auto-review.ts); consulted only under that tier. */
  review: Reviewer;
  /**
   * Whether the current run is unattended (unattended.ts): nobody answers its confirms, so a call
   * that would wait for one is declined at once instead.
   */
  unattended: () => boolean;
  audit: (entry: Record<string, unknown>) => void;
  setStatus: (status: 'awaiting_input' | 'awaiting_confirmation' | 'running') => void;
}

export interface GateRequest {
  toolCallId: string;
  scope: GrantScope;
  /** English fallback title of the confirm; the renderer labels known scopes itself. */
  title: string;
  /** What the user approves (command, path, arguments); clamped to the confirm bound. */
  detail: string;
  /** The tool call's abort signal, passed through from `execute` (pi may give none). */
  signal?: AbortSignal | undefined;
  /** Bash only: the allowlist entry the confirm offers to add (shell.ts `suggestShellAllowlistEntry`). */
  allowlistEntry?: string;
  /**
   * `false` keeps the scope out of session grants: an existing grant is not consulted and a
   * `session` answer counts as `once` without being cached. Defaults to `true`.
   */
  sessionGrant?: boolean;
  /**
   * `true` asks the user whatever would let the call through otherwise: no session grant, tier or
   * `auto` review applies, and the answer never becomes a grant (as with `sessionGrant: false`).
   * For writes that later runs load as instructions (atd-agents/catalog-writes.ts).
   */
  askAlways?: boolean;
  /** Error thrown (and returned to the model) when the user declines. */
  declinedMessage?: string;
}

/** The longest detail a confirm carries (`PermissionRequest.detail`); a longer one is cut. */
export const CONFIRM_DETAIL_CHARS = 200000;

/** How an allowed call was allowed; a decline throws instead. */
export type GateOutcome = Exclude<PermissionOutcome, 'declined'>;

/** Tier, session-grant, confirm and audit decision for one guarded tool call. */
export type Gate = (request: GateRequest) => Promise<GateOutcome>;

const DECLINED = 'The user declined this action.';

/**
 * The service's approval gate, shared by every guarded tool (file tools, grep/find/ls, bash,
 * command saves, web). Order: session grant, then tier, then under `auto` a review of the call,
 * then one confirm; a flagged or failed review falls through to the confirm, and an `askAlways`
 * request goes straight to it. An unattended run raises no confirm: the call is declined at once
 * and audited as `unattended`. A session answer grants the scope (tool, plus location for file
 * tools) for the rest of the task, including confirms already waiting on it. Every decision is
 * audited; confirm and review outcomes are also appended as `app-permission` session entries so
 * the transcript shows them after reopen.
 */
export function createGate(host: GateHost): Gate {
  function record(toolCallId: string, scope: GrantScope, outcome: PermissionOutcome): void {
    host.sessions.appendCustomEntry('app-permission', {
      toolCallId,
      runId: host.runId(),
      scope,
      outcome,
      at: Date.now(),
    });
  }

  return async (request) => {
    const { toolCallId, scope } = request;
    const key = grantKey(scope);
    const askAlways = request.askAlways ?? false;
    const sessionGrant = !askAlways && (request.sessionGrant ?? true);
    const base = {
      taskId: host.taskId,
      runId: host.runId(),
      executionId: host.executionId(),
      tool: key,
      toolCallId,
      ...(askAlways && { askAlways }),
    };
    if (sessionGrant && host.grants.has(key)) {
      host.audit({ ...base, decision: 'grant' });
      return 'grant';
    }
    if (!askAlways && tierAllows(host.tier, scope)) {
      host.audit({ ...base, decision: 'tier' });
      return 'tier';
    }
    let review: ConfirmReview | undefined;
    const unattended = host.unattended();
    if (!askAlways && host.tier === 'auto') {
      const verdict = await host.review(
        { scope, detail: request.detail, unattended },
        request.signal,
      );
      host.audit({ ...base, decision: `review-${verdict.decision}`, reason: verdict.reason });
      if (verdict.decision === 'allow') {
        record(toolCallId, scope, 'reviewed');
        return 'reviewed';
      }
      review = confirmReview(verdict);
    }
    if (unattended) {
      auditUnattended(host.audit, { ...base, kind: 'confirm', title: request.title });
      record(toolCallId, scope, 'declined');
      throw new Error(UNATTENDED_DECLINED);
    }
    host.setStatus('awaiting_confirmation');
    try {
      const answer = await host.confirms.request(
        {
          taskId: host.taskId,
          runId: host.runId(),
          executionId: host.executionId(),
          toolCallId,
          kind: 'confirmation',
          scope,
          title: request.title,
          detail: request.detail.slice(0, CONFIRM_DETAIL_CHARS),
          ...(request.allowlistEntry ? { allowlistEntry: request.allowlistEntry } : {}),
          ...(review ? { review } : {}),
        },
        request.signal,
        // A request no session grant answers is not settled by another call's grant either.
        { ownAnswerOnly: !sessionGrant },
      );
      if (!('decision' in answer) || answer.decision === 'declined') {
        host.audit({ ...base, decision: 'declined' });
        record(toolCallId, scope, 'declined');
        throw new Error(request.declinedMessage ?? DECLINED);
      }
      const outcome = answer.decision === 'session' && sessionGrant ? 'session' : 'once';
      host.audit({ ...base, decision: outcome });
      record(toolCallId, scope, outcome);
      // Only the answer that creates the grant sweeps: the confirms it settles come back here as
      // `session` too, while the ledger still lists them, and must not settle them again.
      if (outcome === 'session' && !host.grants.has(key)) {
        host.grants.add(key);
        await host.confirms.grantPending(host.taskId, key);
      }
      return outcome;
    } finally {
      host.setStatus('running');
    }
  };
}
