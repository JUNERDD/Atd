import { getCurrentSystemMessage } from '@earendil-works/pi-ai';
import {
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
  type AgentSession,
  type SessionEntry,
  type SessionManager,
  type SessionProjection,
} from '@earendil-works/pi-coding-agent';
import type { TaskContextState } from '@ai/agent-contracts';
import type { CompactionObserver } from './observer.js';

/** Compactions Pi completed on the branch. */
function countCompactions(branch: readonly SessionEntry[]): number {
  return branch.filter((entry) => entry.type === 'compaction').length;
}

function state(
  contextWindow: number | null,
  tokens: number | null,
  compactions: number,
  compacting: boolean,
): TaskContextState {
  const window = contextWindow && contextWindow > 0 ? Math.round(contextWindow) : null;
  const known =
    tokens === null || !Number.isFinite(tokens) ? null : Math.max(0, Math.round(tokens));
  return {
    contextWindow: window,
    tokens: known,
    percent: window && known !== null ? (known / window) * 100 : null,
    compactions,
    compacting,
  };
}

/**
 * The context state of a live session, published as `context.update` whenever it changes: after
 * each turn, when a compaction starts or ends, and when the session's model changes (the caller
 * calls `update`). Usage is Pi's own `getContextUsage()`, which is unknown right after a
 * compaction until the next response; the window is the model's, which carries the run's
 * frozen window (run-model.ts).
 */
export class ContextTracker {
  private published = '';

  constructor(
    private readonly session: AgentSession,
    private readonly compaction: CompactionObserver,
    private readonly publish: (state: TaskContextState) => void,
  ) {}

  attach(): void {
    this.session.subscribe((event) => {
      if (event.type === 'turn_end') this.update();
    });
    this.compaction.onChange(() => this.update());
  }

  current(): TaskContextState {
    const usage = this.session.getContextUsage();
    return state(
      usage?.contextWindow ?? this.session.model?.contextWindow ?? null,
      usage?.tokens ?? null,
      countCompactions(this.session.sessionManager.getBranch()),
      this.compaction.running() !== null,
    );
  }

  update(): void {
    const next = this.current();
    const key = JSON.stringify(next);
    if (key === this.published) return;
    this.published = key;
    this.publish(next);
  }
}

/**
 * The context state of a task without a live session, read from its session file the way Pi's
 * `AgentSession.getContextUsage()` reads a live one (0.99.1, with `estimateProjectedContextTokens`):
 * unknown after a compaction until a response reports usage again; else the last reported usage
 * plus an estimate of what followed it, unless a later context edit or compaction invalidated
 * that usage, in which case the whole projected context is estimated.
 */
export function coldContextState(
  manager: SessionManager,
  contextWindow: number | null,
): TaskContextState {
  const branch = manager.getBranch();
  return state(
    contextWindow,
    coldTokens(branch, manager.buildSessionProjection()),
    countCompactions(branch),
    false,
  );
}

function coldTokens(branch: readonly SessionEntry[], projection: SessionProjection): number | null {
  const position = new Map(branch.map((entry, index) => [entry.id, index]));
  const messages = projection.entries.flatMap((entry) =>
    entry.messages.map((message) => ({ message, at: position.get(entry.sourceEntry.id) ?? -1 })),
  );
  const latest = getLatestCompactionEntry([...branch]);
  const floor = latest ? (position.get(latest.id) ?? -1) : -1;
  if (latest && !messages.some((item) => item.at > floor && reportedUsage(item.message) > 0))
    return null;
  let invalidated = -1;
  branch.forEach((entry, index) => {
    if (entry.type === 'context_edit' || entry.type === 'compaction') invalidated = index;
  });
  let last = messages.length - 1;
  while (last >= 0 && !(reportedUsage(messages[last]?.message) > 0)) last -= 1;
  const reported = messages[last];
  if (reported && reported.at > invalidated)
    return reportedUsage(reported.message) + estimated(messages.slice(last + 1));
  const system = getCurrentSystemMessage(projection.messages);
  return (
    (system ? estimateTokens(system) : 0) +
    estimated(messages.filter((item) => item.message.role !== 'system'))
  );
}

type AgentMessage = SessionProjection['messages'][number];

/** Context tokens a settled response reported; 0 for other messages. */
function reportedUsage(message: AgentMessage | undefined): number {
  if (message?.role !== 'assistant') return 0;
  if (message.stopReason === 'aborted' || message.stopReason === 'error') return 0;
  return calculateContextTokens(message.usage);
}

function estimated(items: ReadonlyArray<{ message: AgentMessage }>): number {
  return items.reduce((sum, item) => sum + estimateTokens(item.message), 0);
}
