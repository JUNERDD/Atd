import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../../logging.js';
import type { MemoryAuthority } from '../engine.js';
import type { ConsolidationCommit } from '../engine-types.js';
import { localDate } from '../learner/prompts.js';
import { completeConsolidation, type OpenModel } from './model.js';
import { consolidationPrompt } from './prompts.js';
import { parseConsolidationReply } from './reply.js';
import { lastFingerprint, memoryFingerprint, storeFingerprint } from './state.js';
import type { ConsolidationRequest, ConsolidationResult } from './types.js';
import { consolidationView } from './view.js';

/** What one consolidation runs against; index.ts wires the service's, tests their fakes. */
export interface ConsolidationDeps {
  agentDir: string;
  authority: () => Promise<MemoryAuthority>;
  openModel: OpenModel;
  log: Logger;
}

const CHANGED =
  'Memory changed while it was being consolidated, so nothing was written. The next run tries again.';

/**
 * One memory consolidation (types.ts has the outcomes). The cheap gates come first and make no
 * model call: paused learning, fewer than two memories it could change, and memory unchanged
 * since the last consolidation (state.ts). The policy version is read with the memories, so a
 * write that lands while the model works (Settings, a tool, a learner) makes the commit refuse
 * and nothing is written. After a commit, or a reply with nothing to do, the fingerprint of the
 * memory as it now stands is stored. An abort rejects with the signal's reason; any other failure
 * resolves `failed`.
 */
export async function consolidate(
  deps: ConsolidationDeps,
  request: ConsolidationRequest,
): Promise<ConsolidationResult> {
  const { signal } = request;
  const fields = { automationId: request.automationId, automationRunId: request.automationRunId };
  signal.throwIfAborted();
  try {
    const authority = await deps.authority();
    const state = await authority.state();
    if (state.paused) return { outcome: 'skipped', reason: 'memoryPaused' };
    const units = state.units.filter((unit) => unit.enabled);
    if (units.filter((unit) => unit.activation !== 'core').length < 2)
      return { outcome: 'nothingNew' };
    const fingerprint = memoryFingerprint(units);
    if (fingerprint === (await lastFingerprint(deps.agentDir))) return { outcome: 'nothingNew' };

    const view = consolidationView(units);
    const opened = await deps.openModel(request.model);
    if ('unavailable' in opened)
      return { outcome: 'failed', reason: 'modelUnavailable', detail: opened.unavailable };
    signal.throwIfAborted();
    const prompt = consolidationPrompt(localDate(new Date()), view.text);
    const reply = await completeConsolidation(opened, prompt, request.thinkingLevel, signal);
    signal.throwIfAborted();
    const parsed = parseConsolidationReply(reply, view.targets);
    if (!parsed) {
      deps.log.warn('A memory consolidation answered without operations.', fields);
      return failed('The model did not answer with consolidation operations.');
    }
    if (parsed.dropped.length)
      deps.log.debug('A memory consolidation dropped operations.', {
        ...fields,
        reasons: parsed.dropped,
      });
    if (!parsed.ops.length) {
      if (parsed.dropped.length)
        return failed('The model asked only for changes that cannot apply.');
      await remember(deps, fingerprint, fields);
      return { outcome: 'nothingNew' };
    }

    const commit = await authority.commitConsolidation(parsed.ops, state.version, view.shown);
    return await finish(deps, commit, parsed.summary, fields);
  } catch (error) {
    signal.throwIfAborted();
    deps.log.warn('A memory consolidation failed.', { ...fields, error: errorMessage(error) });
    return failed(errorMessage(error));
  }
}

async function finish(
  deps: ConsolidationDeps,
  commit: ConsolidationCommit,
  summary: string,
  fields: Record<string, string>,
): Promise<ConsolidationResult> {
  if (commit.refused !== null)
    return commit.refused === 'paused'
      ? { outcome: 'skipped', reason: 'memoryPaused' }
      : failed(CHANGED);
  const { applied, proposed, skipped } = commit;
  deps.log.info('A memory consolidation committed.', {
    ...fields,
    applied,
    proposed,
    skipped: skipped.length,
  });
  if (skipped.length)
    deps.log.debug('The memory store skipped consolidation operations.', {
      ...fields,
      reasons: skipped,
    });
  await remember(deps, memoryFingerprint(commit.units), fields);
  if (!applied && !proposed) return { outcome: 'nothingNew' };
  return {
    outcome: 'delivered',
    summary:
      summary || `Memory consolidated: ${applied} updated, ${proposed} suggested for review.`,
    applied,
    proposed,
  };
}

/** Stores the fingerprint; a failed write only costs the next consolidation a model call. */
async function remember(
  deps: ConsolidationDeps,
  fingerprint: string,
  fields: Record<string, string>,
): Promise<void> {
  try {
    await storeFingerprint(deps.agentDir, fingerprint, new Date());
  } catch (error) {
    deps.log.warn('The memory consolidation state could not be saved.', {
      ...fields,
      error: errorMessage(error),
    });
  }
}

function failed(detail: string): ConsolidationResult {
  return { outcome: 'failed', reason: 'runFailed', detail: detail.slice(0, 500) };
}
