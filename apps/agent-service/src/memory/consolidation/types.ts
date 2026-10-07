import type { ModelSelection, ThinkingLevel } from '@atd/agent-contracts';

/**
 * The contract between the automation engine, which decides when memory is consolidated, and the
 * memory engine, which owns how. One call reviews the enabled units of the data dir's memory,
 * applies merges and rewrites with history kept, and turns every removal into a suggestion.
 */

export interface ConsolidationRequest {
  /** The automation's model; absent: the default connection's default model. */
  model?: ModelSelection;
  thinkingLevel?: ThinkingLevel;
  /** Aborted when the person stops the run, the run times out, or the service stops. */
  signal: AbortSignal;
  /** The automation and run record this consolidation serves, for logs and unit history. */
  automationId: string;
  automationRunId: string;
}

/**
 * `delivered`: something was changed or suggested; `summary` is one sentence for the run record
 * and the notification, in the language the memories are mostly written in (runtime text, not
 * translated). `nothingNew`: memory is empty, unchanged since the last consolidation, or the model
 * found nothing to do; no model call is made in the first two cases. `skipped`: memory learning is
 * paused, so nothing may be written. `failed`: no model could run it, or the call or its reply
 * failed (`detail`, runtime text). An abort rejects with the signal's reason instead of resolving.
 */
export type ConsolidationResult =
  | { outcome: 'delivered'; summary: string; applied: number; proposed: number }
  | { outcome: 'nothingNew' }
  | { outcome: 'skipped'; reason: 'memoryPaused' }
  | { outcome: 'failed'; reason: 'modelUnavailable' | 'runFailed'; detail: string };

export type ConsolidateMemory = (request: ConsolidationRequest) => Promise<ConsolidationResult>;
