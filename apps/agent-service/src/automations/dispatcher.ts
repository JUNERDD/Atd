import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type Automation,
  type AutomationRun,
  type AutomationRunReason,
  type FolderRef,
} from '@atd/agent-contracts';
import { DrainingError } from '../errors.js';
import type { EngineDeps } from './engine-deps.js';
import { absoluteFiles, type FolderWatch } from './folder-watch.js';
import { launchRun, LaunchFailure, type LaunchDeps } from './launch-run.js';
import { classify, type RunEnd } from './outcome.js';
import { clip, type FireFacts, type Upstream } from './prompt.js';
import { recordFire, settleRun, skipFire, type FireRequest, type Settlement } from './records.js';
import { RunSupervisor, type WatchedRun } from './supervisor.js';

/**
 * From a fire to a settled record: the durable receipt, a FIFO queue in front of two slots shared
 * by every automation (decision D6), the launch through the run pipeline, supervision, the result,
 * and the automations chained to that result (at most `MAX_CHAIN_DEPTH` hops from the first run).
 */

/** Automation runs at once, across all automations. */
const MAX_RUNS_AT_ONCE = 2;
/** Chained fires allowed after the run that started a chain. */
export const MAX_CHAIN_DEPTH = 3;

/** What a fire carries besides its request. */
export interface FireExtras {
  folder?: FolderRef;
  upstream?: Upstream;
  /** Chained fires before this one (0: no other automation fired it). */
  depth: number;
}

interface Queued {
  automationId: string;
  record: AutomationRun;
  taskId: string;
  facts: FireFacts;
  filePaths: string[];
  depth: number;
}

export class Dispatcher {
  readonly supervisor: RunSupervisor;
  private readonly queue: Queued[] = [];
  /** Dispatches and settlements in flight. */
  private readonly work = new Set<Promise<void>>();
  private dispatching = 0;
  private stopped = false;

  constructor(
    private readonly deps: EngineDeps,
    private readonly folderWatch: FolderWatch,
  ) {
    this.supervisor = new RunSupervisor({
      events: deps.events,
      ledger: deps.ledger,
      manager: deps.manager,
      auditDir: deps.paths.auditDir,
      log: deps.log,
      now: deps.now,
      ended: (run, end) => this.ended(run, end),
      released: () => this.pump(),
    });
  }

  /** Stops dispatching; fires still queued end `interrupted` at the next start (never retried). */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.supervisor.close();
  }

  /**
   * Writes the fire's receipt, then queues it; a fire the automation cannot take is recorded as
   * skipped instead. Answers the record (the skip's for a skipped fire); null when a folder's
   * files keep waiting for the automation's run to end.
   */
  async fire(
    automation: Automation,
    request: FireRequest,
    now: number,
    extras: FireExtras,
  ): Promise<AutomationRun | null> {
    const recordId = randomUUID();
    const receipt = await this.deps.store.change((draft) => {
      const live = draft.definitions.automations.find((item) => item.id === automation.id);
      return live ? recordFire(draft, live, request, now, recordId) : null;
    });
    if (!receipt?.fired) return receipt?.record ?? null;
    // Only once the receipt is durable do the files count as handled (decision D8). A snapshot
    // that cannot be written may fire the files again later; the run itself still starts.
    if (request.files?.length)
      await this.folderWatch.consume(automation.id, request.files).catch((error: unknown) => {
        this.deps.log.warn('Fired files could not be marked in the folder snapshot.', {
          automationId: automation.id,
          error: errorMessage(error),
        });
      });
    this.queue.push({
      automationId: automation.id,
      record: receipt.record,
      taskId: randomUUID(),
      facts: {
        source: request.source,
        firedAt: now,
        ...(request.scheduledFor !== undefined ? { scheduledFor: request.scheduledFor } : {}),
        late: request.late ?? false,
        ...(extras.folder ? { folderName: extras.folder.name } : {}),
        ...(request.files?.length ? { files: request.files } : {}),
        ...(extras.upstream ? { upstream: extras.upstream } : {}),
      },
      filePaths: extras.folder ? absoluteFiles(extras.folder, request.files ?? []) : [],
      depth: extras.depth,
    });
    this.pump();
    return receipt.record;
  }

  /** Records a skipped fire (and moves a schedule past its occurrence). */
  async skip(
    automationId: string,
    reason: AutomationRunReason,
    request: FireRequest,
    now: number,
  ): Promise<void> {
    await this.deps.store.change((draft) => {
      const live = draft.definitions.automations.find((item) => item.id === automationId);
      if (live) skipFire(draft, live, reason, request, now, randomUUID());
    });
  }

  /** Settles a record with its result, then fires the automations chained to that result. */
  async settle(
    automationId: string,
    recordId: string,
    result: Settlement,
    depth: number,
    answer: string,
  ): Promise<void> {
    const now = this.deps.now();
    const settled = await this.deps.store.change((draft) =>
      settleRun(draft, automationId, recordId, result, now),
    );
    if (settled) await this.chain(automationId, settled, depth, answer, now);
  }

  /** Resolves once no dispatch, settlement or run end is in flight. */
  async idle(): Promise<void> {
    while (this.work.size || this.supervisor.settling) {
      await Promise.all(this.work);
      await this.supervisor.idle();
    }
  }

  private track(work: Promise<void>): void {
    this.work.add(work);
    void work.catch(() => undefined).finally(() => this.work.delete(work));
  }

  pump(): void {
    while (
      !this.stopped &&
      this.queue.length &&
      this.supervisor.size + this.dispatching < MAX_RUNS_AT_ONCE
    ) {
      const next = this.queue.shift();
      if (next) this.track(this.dispatch(next));
    }
  }

  private async dispatch(entry: Queued): Promise<void> {
    this.dispatching += 1;
    try {
      const automation = this.definition(entry.automationId);
      // Deleted while it waited, its records went with it; once stopped, nothing more starts.
      if (!automation || this.stopped) return;
      // A fire that waited for a slot starts only while its automation is on and nothing is
      // paused; Run now still starts whatever the pause, as it does when it is pressed.
      const paused = !automation.enabled || this.deps.store.data.definitions.paused;
      if (paused && entry.record.source !== 'manual') {
        const skipped: Settlement = { outcome: 'skipped', reason: 'paused' };
        await this.settle(entry.automationId, entry.record.id, skipped, entry.depth, '');
        return;
      }
      let accepted: { taskId: string; runId: string };
      try {
        accepted = await launchRun(this.launchDeps(), {
          automation,
          record: entry.record,
          taskId: entry.taskId,
          facts: entry.facts,
          filePaths: entry.filePaths,
          previous: this.previousDelivered(entry.automationId),
        });
      } catch (error) {
        await this.settle(entry.automationId, entry.record.id, failure(error), entry.depth, '');
        return;
      }
      await this.attach(entry, accepted);
      this.supervisor.watch({
        automationId: entry.automationId,
        recordId: entry.record.id,
        taskId: accepted.taskId,
        runId: accepted.runId,
        startedAt: null,
        maxDurationMs: automation.policy.maxDurationMinutes * 60_000,
        depth: entry.depth,
        timedOut: false,
      });
    } catch (error) {
      this.deps.log.warn('An automation run could not be dispatched.', {
        automationId: entry.automationId,
        error: errorMessage(error),
      });
    } finally {
      this.dispatching -= 1;
      this.pump();
    }
  }

  /** Links the record to its task run, so the list opens it and a restart finds it. */
  private async attach(entry: Queued, accepted: { taskId: string; runId: string }) {
    await this.deps.store
      .change((draft) => {
        const record = draft.state.automations[entry.automationId]?.runs.find(
          (run) => run.id === entry.record.id,
        );
        if (record) Object.assign(record, { taskId: accepted.taskId, runId: accepted.runId });
      })
      .catch((error: unknown) => {
        this.deps.log.warn('An automation run record could not name its task.', {
          automationId: entry.automationId,
          error: errorMessage(error),
        });
      });
  }

  private launchDeps(): LaunchDeps {
    const { paths, manager, launchCommand, folders, resources } = this.deps;
    return { dataDir: paths.root, manager, launchCommand, folders, resources };
  }

  private async ended(run: WatchedRun, end: RunEnd): Promise<void> {
    const automation = this.definition(run.automationId);
    // Before the record settles: the automation counts as running until then (folder-watch.ts).
    if (automation && end.wrote.length)
      await this.folderWatch.absorbWrites(automation, end.wrote).catch((error: unknown) => {
        this.deps.log.warn("A run's own writes could not be kept from firing its automation.", {
          automationId: run.automationId,
          error: errorMessage(error),
        });
      });
    const notify = automation?.delivery.notify ?? 'always';
    const result: Settlement = { ...classify(end, notify), declined: end.declined };
    await this.settle(run.automationId, run.recordId, result, run.depth, end.answer);
  }

  private async chain(
    upstreamId: string,
    record: AutomationRun,
    depth: number,
    answer: string,
    now: number,
  ): Promise<void> {
    const outcome = record.outcome === 'timedOut' ? 'failed' : record.outcome;
    if (
      outcome !== 'delivered' &&
      outcome !== 'nothingNew' &&
      outcome !== 'needsAttention' &&
      outcome !== 'failed'
    )
      return;
    const upstream = this.definition(upstreamId);
    const { definitions } = this.deps.store.data;
    if (!upstream || this.stopped) return;
    for (const automation of definitions.automations) {
      const { trigger } = automation;
      if (!automation.enabled || trigger.kind !== 'automation') continue;
      if (trigger.automationId !== upstreamId || !trigger.outcomes.includes(outcome)) continue;
      if (depth + 1 > MAX_CHAIN_DEPTH) {
        this.deps.log.info('A chain of automations reached its depth limit.', {
          automationId: automation.id,
        });
        continue;
      }
      const request: FireRequest = { source: 'automation' };
      // One downstream automation that cannot fire never keeps the others from firing.
      try {
        if (definitions.paused) await this.skip(automation.id, 'paused', request, now);
        else
          await this.fire(automation, request, now, {
            upstream: { name: upstream.name, result: outcome, answer },
            depth: depth + 1,
          });
      } catch (error) {
        this.deps.log.warn('A chained automation could not fire.', {
          automationId: automation.id,
          error: errorMessage(error),
        });
      }
    }
  }

  private definition(automationId: string): Automation | undefined {
    return this.deps.store.data.definitions.automations.find((item) => item.id === automationId);
  }

  /** The newest delivered run with a task, whose answer a run may compare with. */
  private previousDelivered(automationId: string): { taskId: string; runId: string } | null {
    const runs = this.deps.store.data.state.automations[automationId]?.runs ?? [];
    const run = runs.find((item) => item.outcome === 'delivered' && item.taskId && item.runId);
    return run?.taskId && run.runId ? { taskId: run.taskId, runId: run.runId } : null;
  }
}

/** How a fire whose run could not start settles; a drain is no failure of the automation. */
function failure(error: unknown): Settlement {
  if (error instanceof DrainingError)
    return { outcome: 'interrupted', detail: 'Atd quit before the run started.' };
  const reason = error instanceof LaunchFailure ? error.reason : 'submitFailed';
  const detail = clip(errorMessage(error), 2000);
  // Files a command cannot take are no failure of the automation; they are not tried again.
  if (reason === 'unsupportedFiles') return { outcome: 'skipped', reason, detail };
  return { outcome: 'failed', reason, detail };
}
