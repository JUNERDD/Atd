import { errorMessage, type Automation } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import type { ConsolidateMemory, ConsolidationResult } from '../memory/consolidation/index.js';
import { clip } from './prompt.js';
import type { Settlement } from './records.js';

/**
 * Runs of the `consolidateMemory` action. They start no task: the memory engine's job runs in
 * the service, holding one of the dispatcher's slots until it settles, under the same maximum
 * duration a task run gets. Its `AbortSignal` is aborted when the person deletes the automation
 * (`stopped`), when the run outlives its maximum duration (`timedOut`), or when the service stops
 * (`stopped`); the run settles at once then, without waiting for the job to notice the abort, so a
 * job that ignores it can never hold a slot or the shutdown. A record still `running` after a
 * restart has nothing to resume and settles `interrupted` (reconcile.ts). Every result is
 * recorded as read, since there is no task to open; notices still follow `delivery.notify`. The
 * policy's tier, tools, memory switch, folders and `delivery.includePreviousResult` do not apply.
 */

const SUMMARY_CHARS = 500;
const DETAIL_CHARS = 2000;

/** Who stopped a consolidation; its signal's abort reason. */
type StopCause = 'person' | 'timeout' | 'service';

class ConsolidationStopped extends Error {
  constructor(readonly by: StopCause) {
    super(`The memory consolidation was stopped (${by}).`);
    this.name = 'ConsolidationStopped';
  }
}

interface LiveConsolidation {
  automationId: string;
  recordId: string;
  depth: number;
  startedAt: number;
  maxDurationMs: number;
  controller: AbortController;
  /** Stopped, or the job answered: the run is settling. */
  ending: boolean;
  /** The whole run, from the job's start to its settled record. */
  done: Promise<void>;
}

export interface ConsolidationDeps {
  consolidate: ConsolidateMemory;
  log: Logger;
  now: () => number;
  /** Settles the record and fires the automations chained to its result (dispatcher.ts). */
  settle: (
    automationId: string,
    recordId: string,
    result: Settlement,
    depth: number,
    answer: string,
  ) => Promise<void>;
  /** A consolidation settled, so its slot is free. */
  released: () => void;
}

export class ConsolidationRuns {
  /** Consolidations going or settling, by run record id. */
  private readonly live = new Map<string, LiveConsolidation>();

  constructor(private readonly deps: ConsolidationDeps) {}

  /** Slots the consolidations hold. */
  get size(): number {
    return this.live.size;
  }

  /** Starts the consolidation of a fire whose receipt is durable. */
  start(automation: Automation, recordId: string, depth: number): void {
    const run: LiveConsolidation = {
      automationId: automation.id,
      recordId,
      depth,
      startedAt: this.deps.now(),
      maxDurationMs: automation.policy.maxDurationMinutes * 60_000,
      controller: new AbortController(),
      ending: false,
      done: Promise.resolve(),
    };
    this.live.set(recordId, run);
    run.done = this.run(automation, run)
      .catch((error: unknown) => {
        this.deps.log.warn('Settling a memory consolidation failed.', {
          automationId: run.automationId,
          error: errorMessage(error),
        });
      })
      .finally(() => {
        this.live.delete(recordId);
        this.deps.released();
      });
  }

  /** The person deleted the automation: its consolidation stops. */
  stop(automationId: string): void {
    for (const run of this.live.values())
      if (run.automationId === automationId) abort(run, 'person');
  }

  /** Stops consolidations past their maximum duration; each ends timed out. */
  enforceDeadlines(now: number): void {
    for (const run of this.live.values())
      if (now - run.startedAt > run.maxDurationMs) {
        this.deps.log.info('A memory consolidation ran out of time; stopping it.', {
          automationId: run.automationId,
        });
        abort(run, 'timeout');
      }
  }

  /** The service stops: every consolidation stops and settles. */
  close(): void {
    for (const run of this.live.values()) abort(run, 'service');
  }

  /** Whether a consolidation that was stopped or answered is still settling. */
  get settling(): boolean {
    return [...this.live.values()].some((run) => run.ending);
  }

  /** Resolves once every consolidation that was stopped or answered has settled. */
  async idle(): Promise<void> {
    for (;;) {
      const ending = [...this.live.values()].filter((run) => run.ending);
      if (!ending.length) return;
      await Promise.all(ending.map((run) => run.done));
    }
  }

  private async run(automation: Automation, run: LiveConsolidation): Promise<void> {
    const { policy } = automation;
    const { signal } = run.controller;
    let result: Settlement;
    try {
      const done = await Promise.race([
        this.deps.consolidate({
          ...(policy.model ? { model: policy.model } : {}),
          ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
          signal,
          automationId: run.automationId,
          automationRunId: run.recordId,
        }),
        abortion(signal),
      ]);
      result = settlementOf(done);
    } catch (error) {
      result =
        signal.reason instanceof ConsolidationStopped ? stopped(signal.reason.by) : failed(error);
    }
    run.ending = true;
    // Nothing to open: its changes surface as new memory units and suggestions instead.
    const read: Settlement = { ...result, read: true };
    await this.deps.settle(run.automationId, run.recordId, read, run.depth, result.summary ?? '');
  }
}

function abort(run: LiveConsolidation, by: StopCause): void {
  if (run.ending || run.controller.signal.aborted) return;
  // Marked before the abort lands, so a shutdown that stops it waits for its record to settle.
  run.ending = true;
  run.controller.abort(new ConsolidationStopped(by));
}

/** Rejects with the abort reason once `signal` aborts. */
function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/** The record's result for what the memory engine answered. */
export function settlementOf(result: ConsolidationResult): Settlement {
  switch (result.outcome) {
    case 'delivered': {
      const summary = clip(result.summary, SUMMARY_CHARS);
      return { outcome: 'delivered', ...(summary ? { summary } : {}) };
    }
    case 'nothingNew':
      return { outcome: 'nothingNew' };
    case 'skipped':
      return { outcome: 'skipped', reason: 'memoryPaused' };
    case 'failed':
      return {
        outcome: 'failed',
        reason: result.reason,
        detail: clip(result.detail || 'The memory consolidation failed.', DETAIL_CHARS),
      };
  }
}

function stopped(by: StopCause): Settlement {
  if (by === 'timeout') return { outcome: 'timedOut' };
  if (by === 'service') return { outcome: 'stopped', detail: 'Atd quit during the run.' };
  return { outcome: 'stopped' };
}

function failed(error: unknown): Settlement {
  return {
    outcome: 'failed',
    reason: 'runFailed',
    detail: clip(errorMessage(error), DETAIL_CHARS),
  };
}
