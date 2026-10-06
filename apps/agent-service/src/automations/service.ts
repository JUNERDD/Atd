import {
  AUTOMATION_RUN_HISTORY,
  errorMessage,
  type Automation,
  type AutomationFolder,
  type AutomationItem,
  type AutomationListResponse,
  type AutomationNotice,
  type AutomationRun,
  type PreviewAutomationTriggerRequest,
  type PreviewAutomationTriggerResponse,
} from '@atd/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { FolderStore } from '../folders/store.js';
import { LedgerNotFound, type Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import type { ServicePaths } from '../storage.js';
import { TrailingFlush } from '../trailing-flush.js';
import { firingProblem, lookups, triggerProblem, type CheckContext } from './checks.js';
import type { EditContext } from './edits.js';
import type { AutomationRuns } from './engine-deps.js';
import { AutomationEngine } from './engine.js';
import { FolderSnapshots } from './folder-snapshots.js';
import type { FolderScanner } from './folder-watch.js';
import type { CommandLauncher } from './launch-run.js';
import { liveNotices } from './outcome.js';
import { upcoming } from './schedule.js';
import { AutomationStore } from './store.js';

/** Coalescing window of the `automations` invalidation: an engine burst sends one frame. */
const ANNOUNCE_MS = 100;

export interface AutomationServiceDeps {
  paths: ServicePaths;
  ledger: Ledger;
  events: EventLog;
  manager: AutomationRuns;
  launchCommand: CommandLauncher;
  folders: Pick<FolderStore, 'resolve'>;
  resources: Pick<ResourceStore, 'save'>;
  log: Logger;
  /** The wall clock; tests drive it. */
  now?: () => number;
  /** How watched folders are read; tests pass a slow one. */
  scanner?: FolderScanner;
}

/**
 * The automations of one service profile: the store, the engine and the read side the routes and
 * the `automation` tool share. The tool finds it by data directory (`AutomationService.for`),
 * since harness extensions are built per session from runner wiring that cannot carry it. One
 * emitter announces every change, whoever made it (a route, the tool, the engine), coalesced.
 */
export class AutomationService {
  private static readonly instances = new Map<string, AutomationService>();

  /** The profile's automations; throws when the service runs without them. */
  static for(dataDir: string): AutomationService {
    const service = AutomationService.instances.get(dataDir);
    if (!service) throw new Error('Automations are not available in this service.');
    return service;
  }

  /**
   * Loads the store and settles what a previous process left running. Call after the service's
   * recovery and before queued runs dispatch, then `start` once the server listens.
   */
  static async create(deps: AutomationServiceDeps): Promise<AutomationService> {
    const store = await AutomationStore.load(deps.paths.root);
    if (store.problem)
      deps.log.warn('Automations could not be read; none fire until the next change.', {
        problem: store.problem,
      });
    const service = new AutomationService(deps, store);
    // Never fatal at boot: records left `running` settle at the next start instead.
    await service.engine.reconcile().catch((error: unknown) => {
      deps.log.warn('Automation runs from before the restart could not be settled.', {
        error: errorMessage(error),
      });
    });
    AutomationService.instances.set(deps.paths.root, service);
    return service;
  }

  readonly engine: AutomationEngine;
  private readonly listeners = new Set<() => void>();
  private readonly announcer: TrailingFlush;
  private readonly now: () => number;

  private constructor(
    private readonly deps: AutomationServiceDeps,
    readonly store: AutomationStore,
  ) {
    this.now = deps.now ?? Date.now;
    this.announcer = new TrailingFlush(() => this.announce(), ANNOUNCE_MS);
    store.onChanged(() => this.announcer.schedule());
    this.engine = new AutomationEngine({
      paths: deps.paths,
      store,
      snapshots: new FolderSnapshots(deps.paths.root),
      ledger: deps.ledger,
      events: deps.events,
      manager: deps.manager,
      launchCommand: deps.launchCommand,
      folders: deps.folders,
      resources: deps.resources,
      log: deps.log,
      now: this.now,
      changed: () => this.announcer.schedule(),
      ...(deps.scanner ? { scanner: deps.scanner } : {}),
    });
  }

  start(): void {
    this.engine.start();
  }

  /** Stops the engine and lets the store settle; runs in flight belong to the manager's drain. */
  async stop(): Promise<void> {
    await this.engine.stop();
    this.announcer.cancel();
    if (AutomationService.instances.get(this.deps.paths.root) === this)
      AutomationService.instances.delete(this.deps.paths.root);
  }

  /** Calls `listener` once per burst of changes (the `automations` invalidation). */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** What the edit functions (edits.ts) work with. */
  edits(): EditContext {
    return {
      store: this.store,
      engine: this.engine,
      check: () => this.checkContext(),
      now: this.now,
    };
  }

  /** Cancels a task run of an automation (used when one is deleted). */
  cancel(taskId: string, runId: string): Promise<unknown> {
    return this.deps.manager.cancel(taskId, runId);
  }

  checkContext(): CheckContext {
    return {
      folders: this.deps.folders,
      automations: this.store.data.definitions.automations,
      lookups: lookups(this.deps.paths.root),
      now: this.now(),
    };
  }

  async list(): Promise<AutomationListResponse> {
    const { definitions } = this.store.data;
    const check = this.checkContext();
    const automations: AutomationItem[] = [];
    for (const automation of definitions.automations)
      automations.push(await this.itemOf(automation, check));
    const problem = this.store.problem;
    return { automations, paused: definitions.paused, ...(problem ? { problem } : {}) };
  }

  async item(id: string): Promise<AutomationItem> {
    return this.itemOf(this.automation(id), this.checkContext());
  }

  automation(id: string): Automation {
    const automation = this.store.data.definitions.automations.find((item) => item.id === id);
    if (!automation) throw new LedgerNotFound('Automation', id);
    return automation;
  }

  /** Run records, newest first. */
  runs(id: string, limit = AUTOMATION_RUN_HISTORY): AutomationRun[] {
    this.automation(id);
    return (this.store.data.state.automations[id]?.runs ?? []).slice(0, limit);
  }

  /** The next run times of a draft trigger, or why it cannot fire. */
  preview(request: PreviewAutomationTriggerRequest): PreviewAutomationTriggerResponse {
    const check = this.checkContext();
    const problem = triggerProblem(request.trigger, check, request.automationId, true);
    if (problem) return { nextRuns: [], problem };
    if (request.trigger.kind !== 'schedule') return { nextRuns: [] };
    return { nextRuns: upcoming(request.trigger, check.now, request.count ?? 3) };
  }

  /** Notices the shell has not posted, oldest first. */
  notices(): AutomationNotice[] {
    return liveNotices(this.store.data.state.notices, this.now());
  }

  private async itemOf(automation: Automation, check: CheckContext): Promise<AutomationItem> {
    const state = this.store.data.state.automations[automation.id];
    const runs = state?.runs ?? [];
    const trouble = this.engine.folderWatch.inTrouble(automation.id);
    const problem = await firingProblem(automation, check, trouble);
    const lastRun = runs[0];
    return {
      automation,
      status: {
        folders: this.namedFolders(automation),
        ...(automation.enabled && state?.nextDueAt ? { nextRunAt: state.nextDueAt } : {}),
        ...(lastRun ? { lastRun } : {}),
        unread: runs.filter((run) => run.outcome !== 'running' && !run.readAt).length,
        running: runs.some((run) => run.outcome === 'running'),
        ...(!automation.enabled && state?.pausedReason ? { pausedReason: state.pausedReason } : {}),
        ...(problem ? { problem } : {}),
      },
    };
  }

  /**
   * Every folder the automation names, its folder trigger's first, by basename (never the path);
   * a folder no longer registered keeps only its id.
   */
  private namedFolders(automation: Automation): AutomationFolder[] {
    const { trigger, policy } = automation;
    const ids = [...(trigger.kind === 'folder' ? [trigger.folderId] : []), ...policy.folderIds];
    return [...new Set(ids)].map((id) => {
      let name: string | undefined;
      try {
        name = this.deps.folders.resolve([id])[0]?.name;
      } catch {
        // Unregistered: the page shows the folder as missing.
      }
      return name ? { id, name } : { id };
    });
  }

  private announce(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // One broken listener must not keep the others from hearing about the change.
      }
    }
  }
}
