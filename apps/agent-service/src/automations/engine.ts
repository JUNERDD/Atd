import {
  AUTOMATION_FOLDER_FILES_PER_RUN,
  errorMessage,
  type Automation,
  type AutomationRun,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { attendedActiveRuns } from '../unattended.js';
import { Dispatcher, MAX_CHAIN_DEPTH, type FireExtras } from './dispatcher.js';
import { JUMP_MS, needsCursor, rewindCursor, scheduleDue, startCursor, TICK_MS } from './due.js';
import type { EngineDeps } from './engine-deps.js';
import { FOLDER_SCANNER, FolderWatch, registeredFolder } from './folder-watch.js';
import { idleDue } from './idle.js';
import { liveNotices } from './outcome.js';
import { reconcileRuns } from './reconcile.js';
import { stateOf, type FireRequest } from './records.js';

/**
 * The automation engine (decisions D6–D8). One coarse wall-clock tick serves schedules against
 * their persisted next-due occurrences, fires idle triggers once the Mac is idle (idle.ts), and
 * starts a scan of each watched folder, which runs on its own so a slow volume never holds the
 * tick; chained automations fire when the run they follow settles (dispatcher.ts). Nothing waits
 * on a long timer: after sleep or a clock jump the next tick finds what is due, and missed
 * occurrences and idle triggers wait a short wake grace. One automation that cannot be evaluated
 * stops only itself. What the engine keeps in memory is rebuilt from the
 * store at the next start.
 */

/** Missed occurrences wait this long after a wake or a start, so the Mac can reconnect. */
const WAKE_GRACE_MS = 60_000;

export class AutomationEngine {
  readonly folderWatch: FolderWatch;
  private readonly dispatcher: Dispatcher;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private lastTickAt: number | undefined;
  private graceUntil = 0;
  private stopped = false;
  /** The last evaluation error of each automation that fails to evaluate. */
  private readonly failing = new Map<string, string>();
  /** Folder scans in flight by automation; at most one each, and the tick never awaits them. */
  private readonly folderWork = new Map<string, Promise<void>>();

  constructor(private readonly deps: EngineDeps) {
    this.folderWatch = new FolderWatch({
      snapshots: deps.snapshots,
      folders: deps.folders,
      dataDir: deps.paths.root,
      changed: deps.changed,
      scanner: deps.scanner ?? FOLDER_SCANNER,
    });
    this.dispatcher = new Dispatcher(deps, this.folderWatch);
    // Listening from construction catches the runs boot recovery left queued as they start.
    this.dispatcher.supervisor.listen();
  }

  /** Settles what a previous process left running (decision D6); call before runs dispatch. */
  reconcile(): Promise<void> {
    const { supervisor } = this.dispatcher;
    return reconcileRuns({
      store: this.deps.store,
      ledger: this.deps.ledger,
      manager: this.deps.manager,
      log: this.deps.log,
      watch: (run) => supervisor.watch(run),
      watching: (runId) => supervisor.watching(runId),
      settle: (automationId, recordId, result) =>
        this.dispatcher.settle(automationId, recordId, result, MAX_CHAIN_DEPTH, ''),
      // A run adopted after a restart lost its chain depth; it starts no further chain.
      adoptedDepth: MAX_CHAIN_DEPTH,
    });
  }

  /** Starts the tick; a start counts as a wake, so missed occurrences wait for the grace. */
  start(): void {
    if (this.timer || this.stopped) return;
    this.graceUntil = this.deps.now() + WAKE_GRACE_MS;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  /**
   * Stops ticking and dispatching. Runs already started belong to the manager, which stops them
   * as it drains; their records settle from the ledger at the next start. A folder scan still in
   * flight is let go, not awaited: a volume that stopped answering must not hold the shutdown.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dispatcher.stop();
    this.folderWatch.close();
    await this.ticking;
    await this.dispatcher.idle();
    await this.deps.store.idle();
  }

  /** Resolves once no tick, folder scan, dispatch, settlement or store write is in flight. */
  async idle(): Promise<void> {
    await this.ticking;
    await Promise.all(this.folderWork.values());
    await this.dispatcher.idle();
    await this.deps.store.idle();
  }

  /** One tick at `now` (the wall clock unless a test passes one); ticks never overlap. */
  tick(now: number = this.deps.now()): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.ticking ??= this.runTick(now)
      .catch((error: unknown) => {
        this.deps.log.warn('An automation tick failed.', { error: errorMessage(error) });
      })
      .finally(() => {
        this.ticking = null;
      });
    return this.ticking;
  }

  /** Whether the automation has a run that has not ended. */
  running(automationId: string): boolean {
    const runs = this.deps.store.data.state.automations[automationId]?.runs ?? [];
    return runs.some((run) => run.outcome === 'running');
  }

  /** Stops the automation's memory consolidation, if one is going (it is being deleted). */
  stopConsolidation(automationId: string): void {
    this.dispatcher.consolidations.stop(automationId);
  }

  /** Run now: fires at once, whatever the pause and the rate limit; 409 while a run is active. */
  async runNow(automationId: string): Promise<AutomationRun> {
    if (this.deps.store.problem)
      throw new ConflictError('Automations cannot run until their saved data can be read.');
    const automation = this.deps.store.data.definitions.automations.find(
      (item) => item.id === automationId,
    );
    if (!automation) throw new LedgerNotFound('Automation', automationId);
    const extras: FireExtras = { depth: 0 };
    let files: string[] = [];
    const folderId = automation.trigger.kind === 'folder' ? automation.trigger.folderId : null;
    const folder = folderId === null ? undefined : registeredFolder(this.deps.folders, folderId);
    if (folder) {
      // A folder automation run now takes the changes waiting for it, if any.
      extras.folder = folder;
      files = (await this.folderWatch.ready(automationId)).slice(0, batchSize(automation));
    }
    const request: FireRequest = { source: 'manual', ...(files.length ? { files } : {}) };
    const record = await this.dispatcher.fire(automation, request, this.deps.now(), extras);
    if (!record) throw new ConflictError('The automation is already running.');
    return record;
  }

  private async runTick(now: number): Promise<void> {
    if (this.deps.store.problem) {
      this.lastTickAt = now;
      return;
    }
    if (this.noteClock(now)) await this.rewind(now);
    await this.housekeep(now);
    await this.dispatcher.supervisor.enforceDeadlines(now);
    this.dispatcher.consolidations.enforceDeadlines(now);
    const { definitions } = this.deps.store.data;
    for (const automation of definitions.automations) {
      if (!automation.enabled || this.stopped) continue;
      if (automation.trigger.kind === 'folder') {
        if (!definitions.paused) this.startFolder(automation, now);
        continue;
      }
      const serving =
        automation.trigger.kind === 'idle'
          ? this.serveIdle(automation, now, definitions.paused)
          : this.serveSchedule(automation, now, definitions.paused);
      await serving.then(
        () => void this.failing.delete(automation.id),
        (error: unknown) => this.report(automation.id, error),
      );
    }
    this.dispatcher.pump();
  }

  /** Logs an automation that cannot be evaluated, once per new error; the others go on. */
  private report(automationId: string, error: unknown): void {
    const message = errorMessage(error);
    if (this.failing.get(automationId) !== message)
      this.deps.log.warn('An automation could not be evaluated.', { automationId, error: message });
    this.failing.set(automationId, message);
  }

  /** Runs `work` for one automation inside a store change, so its error spares the others. */
  private isolated(automationId: string, work: () => void): void {
    try {
      work();
    } catch (error) {
      this.report(automationId, error);
    }
  }

  /** Scans the automation's folder on its own, unless its previous scan is still going. */
  private startFolder(automation: Automation, now: number): void {
    if (this.folderWork.has(automation.id)) return;
    const work = this.serveFolder(automation, now)
      .then(
        () => void this.failing.delete(automation.id),
        (error: unknown) => this.report(automation.id, error),
      )
      .finally(() => this.folderWork.delete(automation.id));
    this.folderWork.set(automation.id, work);
  }

  /**
   * Notes the tick time; a gap beyond three ticks (sleep, or the clock jumped forward) or a clock
   * that went back starts the wake grace. Answers whether the clock went back.
   */
  private noteClock(now: number): boolean {
    const last = this.lastTickAt;
    this.lastTickAt = now;
    if (last === undefined) return false;
    const gap = now - last;
    if (gap <= JUMP_MS && gap >= -TICK_MS) return false;
    this.graceUntil = now + WAKE_GRACE_MS;
    this.deps.log.info('The Mac woke or the clock jumped; missed automations wait a minute.', {
      gapMs: gap,
    });
    return gap < 0;
  }

  /**
   * After the clock went back: a schedule's next run is the next one from the new time, and
   * interval anchors and the rate limit's fire times that now lie ahead move back to it.
   */
  private async rewind(now: number): Promise<void> {
    const back = new Date(now).toISOString();
    await this.deps.store.change((draft) => {
      for (const automation of draft.definitions.automations) {
        const state = draft.state.automations[automation.id];
        if (!state) continue;
        state.recentFires = state.recentFires.map((at) => (Date.parse(at) > now ? back : at));
        this.isolated(automation.id, () => rewindCursor(automation, state, now));
      }
    });
  }

  /** Drops notices nobody posted within the hour, and restarts cursors a reset state lost. */
  private async housekeep(now: number): Promise<void> {
    const { definitions, state } = this.deps.store.data;
    const stale = liveNotices(state.notices, now).length !== state.notices.length;
    const lost = definitions.automations.filter((item) =>
      needsCursor(item, state.automations[item.id]),
    );
    if (!stale && !lost.length) return;
    await this.deps.store.change((draft) => {
      draft.state.notices = liveNotices(draft.state.notices, now);
      for (const automation of lost)
        this.isolated(automation.id, () =>
          startCursor(automation, stateOf(draft, automation.id), now),
        );
    });
  }

  private async serveSchedule(automation: Automation, now: number, paused: boolean) {
    const state = this.deps.store.data.state.automations[automation.id];
    const due = scheduleDue(automation, state, now, { paused, graceUntil: this.graceUntil });
    if (due.action === 'none' || due.action === 'wait') return;
    const request: FireRequest = { source: 'schedule', scheduledFor: due.occurrence };
    if (due.action === 'skip') await this.dispatcher.skip(automation.id, due.reason, request, now);
    else await this.dispatcher.fire(automation, { ...request, late: due.late }, now, { depth: 0 });
  }

  private async serveIdle(automation: Automation, now: number, paused: boolean): Promise<void> {
    const state = this.deps.store.data.state.automations[automation.id];
    const due = idleDue(automation, state, now, {
      paused,
      graceUntil: this.graceUntil,
      idleSeconds: this.deps.activity.idleSeconds(now),
      attendedRuns: attendedActiveRuns(this.deps.ledger),
    });
    if (due) await this.dispatcher.fire(automation, { source: 'idle' }, now, { depth: 0 });
  }

  private async serveFolder(automation: Automation, now: number): Promise<void> {
    const findings = await this.folderWatch.scan(automation, now);
    if (!findings || this.stopped) return;
    if (findings.missed.length) {
      const files = findings.missed.slice(0, AUTOMATION_FOLDER_FILES_PER_RUN);
      await this.dispatcher.skip(automation.id, 'missed', { source: 'folder', files }, now);
    }
    // Checked before the files are read: a run's own writes are absorbed before it stops
    // running, so files read after this check never include them.
    if (this.running(automation.id)) return;
    const files = (await this.folderWatch.ready(automation.id)).slice(0, batchSize(automation));
    if (!files.length) return;
    await this.dispatcher.fire(automation, { source: 'folder', files }, now, {
      folder: findings.folder,
      depth: 0,
    });
  }
}

/** Files one folder run is given: a command reads them as attachments, of which a run takes 10. */
function batchSize(automation: Automation): number {
  return automation.action.kind === 'command' ? 10 : AUTOMATION_FOLDER_FILES_PER_RUN;
}
