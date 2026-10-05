import { randomUUID } from 'node:crypto';
import { errorMessage } from '@atd/agent-contracts';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { Logger } from '../../logging.js';
import type { LearnerCommit, MemoryRunScope, MemoryRuntimeStore } from '../engine-types.js';
import { parseLearnerReply, replyChannel, type LearnerReply } from './ops.js';
import { LEARNER_SYSTEM_PROMPT, learnerPrompt, localDate } from './prompts.js';
import { currentMemoryView, learningTranscript } from './transcript.js';
import type { LearnerRequest } from './triggers.js';

/** What a review reads from the task's live session, like the auto reviewer (auto-review.ts). */
export interface LearnerSource {
  /** The run's model runtime; a review makes one non-chat completion on it. */
  models: Pick<ModelRuntime, 'completeSimple'>;
  /** The model the session runs now; the review runs on it without thinking. */
  model: Model<Api>;
  branch: () => SessionEntry[];
}

/** What the learner needs from its session's host; index.ts says how the cutover builds it. */
export interface LearnerHost {
  store: MemoryRuntimeStore;
  /** The memory scope of the run the session serves now, not of the run that built it. */
  scope: () => MemoryRunScope;
  /** The session's model and branch; null while none is live, which skips the review. */
  source: () => LearnerSource | null;
  log: Logger;
}

/** Room for a few concise units or one skill proposal; a longer reply is cut and fails to parse. */
const LEARNER_MAX_TOKENS = 4096;
/** One review's model call. Reviews run in the background; a closing session caps them sooner. */
export const REVIEW_TIMEOUT_MS = 90_000;

/** Learner commits per store, applied one at a time across every task's learner. */
const commits = new WeakMap<MemoryRuntimeStore, Promise<unknown>>();

/**
 * One memory review. The policy version is read before anything else, so a write that lands while
 * the review reads or waits for the model (a tool, Settings, another learner) makes its commit
 * stale and the store writes nothing. Failures are logged; a review never fails the task.
 */
export async function runLearnerJob(
  host: LearnerHost,
  request: LearnerRequest,
  signal: AbortSignal,
): Promise<void> {
  const scope = host.scope();
  const fields = { taskId: scope.taskId, runId: scope.runId, trigger: request.trigger };
  try {
    const source = host.store.canLearn(scope) ? host.source() : null;
    if (!source) return;
    const version = host.store.currentPolicyVersion();
    const units = await host.store.enabledUnits();
    const conversation = learningTranscript(source.branch(), units);
    if (!conversation.messages) return;
    const memories = currentMemoryView(units);
    const prompt = learnerPrompt({
      today: localDate(new Date()),
      request,
      memories: memories.text,
      conversation: conversation.text,
    });
    const parsed = parseLearnerReply(await completeLearner(source, prompt, signal));
    if (!parsed) {
      host.log.warn('A memory review answered without operations.', fields);
      return;
    }
    const { ops, dropped } = parsed;
    if (dropped.length)
      host.log.debug('A memory review dropped operations.', { ...fields, reasons: dropped });
    if (!ops.length || signal.aborted) return;
    // The store replaces only the bodies the review saw (learn-commit.ts).
    const commit = await serialized(host.store, () =>
      host.store.commitLearned(ops, scope, version, request.trigger, memories.bodies),
    );
    host.log.info('A memory review committed.', {
      ...fields,
      applied: commit.applied,
      proposed: commit.proposed,
      skipped: commit.skipped.length,
    });
    if (commit.skipped.length)
      host.log.debug('The memory store skipped operations.', {
        ...fields,
        reasons: commit.skipped,
      });
  } catch (error) {
    if (signal.aborted) return;
    host.log.warn('A memory review failed; the task is unaffected.', {
      ...fields,
      error: errorMessage(error),
    });
  }
}

/**
 * The review's one completion on the run's model: its own session id (providers that route by
 * session read it, as for the auto reviewer), a bounded reply and a timeout on top of `signal`.
 * Rejects when the call fails or is aborted.
 */
export async function completeLearner(
  source: LearnerSource,
  prompt: string,
  signal: AbortSignal,
): Promise<LearnerReply> {
  const result = await source.models.completeSimple(
    source.model,
    {
      systemPrompt: LEARNER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
    },
    {
      maxTokens: Math.min(LEARNER_MAX_TOKENS, source.model.maxTokens),
      sessionId: randomUUID(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REVIEW_TIMEOUT_MS)]),
    },
  );
  if (result.stopReason === 'error' || result.stopReason === 'aborted')
    throw new Error(result.errorMessage ?? `The memory review call ended: ${result.stopReason}.`);
  return replyChannel(result.content);
}

function serialized(
  store: MemoryRuntimeStore,
  commit: () => Promise<LearnerCommit>,
): Promise<LearnerCommit> {
  const next = (commits.get(store) ?? Promise.resolve()).then(commit);
  commits.set(
    store,
    next.catch(() => undefined),
  );
  return next;
}
