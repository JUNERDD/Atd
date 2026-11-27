import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type Automation,
  type AutomationRun,
  type AutomationRunReason,
  type FolderRef,
} from '@atd/agent-contracts';
import { chainedTo } from './chain.js';
import { ConsolidationRuns } from './consolidate-run.js';
import {
  CHANGED_SINCE_FIRE,
  decideFire,
  fireFingerprint,
  stillFrozen,
  type FrozenComputer,
} from './computer-fire.js';
import { endedSettlement } from './computer-outcome.js';
import type { EngineDeps } from './engine-deps.js';
import { absoluteFiles, type FolderWatch } from './folder-watch.js';
import { launchRun, launchSettlement, type LaunchDeps } from './launch-run.js';
import type { RunEnd } from './outcome.js';
import { fireFacts, type FireFacts, type Upstream } from './prompt.js';
import {
  previousDelivered,
  recordFire,
  settleRun,
  skipFire,
  type FireRequest,
  type Settlement,
} from './records.js';
import { RunSupervisor, type WatchedRun } from './supervisor.js';

/**
 * Fire-to-settlement dispatcher: durable receipt, FIFO queue (max 2 concurrent runs), launch +
 * supervision (or memory consolidation), and chained fires (up to `MAX_CHAIN_DEPTH`). Computer
 * fires freeze their grant in the receipt and never run content newer than that.
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
  /** What a computer automation's receipt froze. */
  frozen?: FrozenComputer;
}

export class Dispatcher {
  readonly supervisor: RunSupervisor;
  readonly consolidations: ConsolidationRuns;
  private readonly queue: Queued[] = [];
  /** Dispatches and settlements in flight. */
  private readonly work = new Set<Promise<void>>();
  private readonly shutdown = new AbortController();
  private dispatching = 0;

  constructor(
    private readonly deps: EngineDeps,
    private readonly folderWatch: FolderWatch,
  ) {
    this.supervisor = new RunSupervisor({
      events: deps.events,
      ledger: deps.ledger,
      manager: deps.manager,
      auditDir: deps.paths.auditDir,
      facts: (runId) => deps.computer?.readRunFacts(runId) ?? Promise.resolve([]),
      log: deps.log,
      now: deps.now,
      ended: (run, end) => this.ended(run, end),
      released: () => this.pump(),
    });
    this.consolidations = new ConsolidationRuns({
      consolidate: deps.consolidateMemory,
      dataDir: deps.paths.root,
      log: deps.log,
      now: deps.now,
      settle: (automationId, recordId, result, depth, answer) =>
        this.settle(automationId, recordId, result, depth, answer),
      released: () => this.pump(),
    });
  }

  /** Stops dispatching; fires still queued end `interrupted` at the next start (never retried). */
  stop(): void {
    this.shutdown.abort();
    this.queue.length = 0;
    this.supervisor.close();
    this.consolidations.close();
  }

  /** Writes the fire's receipt and queues it; returns null while folder files wait on a run. */
  async fire(
    automation: Automation,
    request: FireRequest,
    now: number,
    extras: FireExtras,
  ): Promise<AutomationRun | null> {
    const recordId = randomUUID();
    const fingerprint = await fireFingerprint(automation, this.deps.paths.root);
    const unresolved = extras.upstream?.unresolved ?? false;
    const receipt = await this.deps.store.change((draft) => {
      const live = draft.definitions.automations.find((item) => item.id === automation.id);
      if (!live) return null;
      const state = draft.state.automations[live.id];
      const decision = decideFire(live, state, this.deps.computer, fingerprint, unresolved);
      const blocked = 'blocked' in decision ? decision.blocked : undefined;
      const fired = recordFire(draft, live, request, now, recordId, blocked);
      return fired && { ...fired, frozen: 'frozen' in decision ? decision.frozen : undefined };
    });
    if (!receipt?.fired) return receipt?.record ?? null;
    // Only once the receipt is durable do the files count as handled (decision D8). A snapshot
    // that cannot be written may fire the files again later; the run itself still starts.
    if (request.files?.length)
      await this.folderWatch
        .consume(automation.id, request.files)
        .catch(
          this.onWarn(automation.id, 'Fired files could not be marked in the folder snapshot.'),
        );
    this.queue.push({
      automationId: automation.id,
      record: receipt.record,
      taskId: randomUUID(),
      facts: fireFacts(request, now, extras.folder?.name, extras.upstream),
      filePaths: extras.folder ? absoluteFiles(extras.folder, request.files ?? []) : [],
      depth: extras.depth,
      ...(receipt.frozen ? { frozen: receipt.frozen } : {}),
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
    while (this.work.size || this.supervisor.settling || this.consolidations.settling) {
      await Promise.all(this.work);
      await this.supervisor.idle();
      await this.consolidations.idle();
    }
  }

  private track(work: Promise<void>): void {
    this.work.add(work);
    void work.catch(() => undefined).finally(() => this.work.delete(work));
  }

  pump(): void {
    while (
      !this.shutdown.signal.aborted &&
      this.queue.length &&
      this.supervisor.size + this.consolidations.size + this.dispatching < MAX_RUNS_AT_ONCE
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
      if (!automation || this.shutdown.signal.aborted) return;
      // Only non-manual fires skip while paused; Run now still starts.
      const paused = !automation.enabled || this.deps.store.data.definitions.paused;
      const settleEntry = (s: Settlement) =>
        this.settle(entry.automationId, entry.record.id, s, entry.depth, '');
      if (paused && entry.record.source !== 'manual') {
        await settleEntry({ outcome: 'skipped', reason: 'paused' });
        return;
      }
      if (automation.action.kind === 'consolidateMemory') {
        this.consolidations.start(automation, entry.record.id, entry.depth);
        return;
      }
      if (!stillFrozen(automation, entry.frozen)) {
        await settleEntry(CHANGED_SINCE_FIRE);
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
          previous: previousDelivered(this.deps.store.data.state.automations[entry.automationId]),
          ...(entry.frozen ? { frozen: entry.frozen } : {}),
        });
      } catch (error) {
        if (this.shutdown.signal.aborted) return;
        await settleEntry(launchSettlement(error));
        return;
      }
      if (!this.definition(entry.automationId)) {
        await this.deps.manager.cancel(accepted.taskId, accepted.runId).catch(() => undefined);
        return;
      }
      await this.attach(entry, accepted);
      if (this.shutdown.signal.aborted) return;
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
      this.onWarn(entry.automationId, 'An automation run could not be dispatched.')(error);
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
      .catch(this.onWarn(entry.automationId, 'An automation run record could not name its task.'));
  }

  private launchDeps(): LaunchDeps {
    const { paths, manager, launchCommand, folders, resources, computer, store } = this.deps;
    return {
      dataDir: paths.root,
      manager,
      launchCommand,
      folders,
      resources,
      held: (id) => store.data.state.automations[id]?.computerHold !== undefined,
      liveAutomation: (id) => this.definition(id),
      paused: () => store.data.definitions.paused,
      signal: this.shutdown.signal,
      ...(computer ? { computer } : {}),
    };
  }

  private async ended(run: WatchedRun, end: RunEnd): Promise<void> {
    const automation = this.definition(run.automationId);
    // Before the record settles: the automation counts as running until then (folder-watch.ts).
    if (automation && end.wrote.length)
      await this.folderWatch
        .absorbWrites(automation, end.wrote)
        .catch(
          this.onWarn(
            run.automationId,
            "A run's own writes could not be kept from firing its automation.",
          ),
        );
    const result = endedSettlement(end, automation, this.deps.computer);
    await this.settle(run.automationId, run.recordId, result, run.depth, end.answer);
  }

  private async chain(
    upstreamId: string,
    record: AutomationRun,
    depth: number,
    answer: string,
    now: number,
  ): Promise<void> {
    const upstream = this.definition(upstreamId);
    const { definitions } = this.deps.store.data;
    if (!upstream || this.shutdown.signal.aborted) return;
    const chained = chainedTo(definitions.automations, upstream, record, answer);
    if (!chained) return;
    for (const automation of chained.followers) {
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
            upstream: chained.upstream,
            depth: depth + 1,
          });
      } catch (error) {
        this.onWarn(automation.id, 'A chained automation could not fire.')(error);
      }
    }
  }

  private onWarn(automationId: string, message: string): (error: unknown) => void {
    return (error) => this.deps.log.warn(message, { automationId, error: errorMessage(error) });
  }

  private definition(automationId: string): Automation | undefined {
    return this.deps.store.data.definitions.automations.find((item) => item.id === automationId);
  }
}
