import type { ServiceBlock } from '@atd/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { FolderStore } from '../folders/store.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { ConsolidateMemory } from '../memory/consolidation/index.js';
import type { ResourceStore } from '../resources.js';
import type { RunnerManager } from '../runner-manager.js';
import type { ServicePaths } from '../storage.js';
import type { SystemActivity } from '../system-activity.js';
import type { FolderSnapshots } from './folder-snapshots.js';
import type { FolderScanner } from './folder-watch.js';
import type { CommandLauncher } from './launch-run.js';
import type { AutomationStore } from './store.js';

/** The part of the `RunnerManager` automations use; the service passes the manager itself. */
export interface AutomationRuns {
  submit: RunnerManager['submit'];
  cancel(taskId: string, runId: string): Promise<unknown>;
  /** The task's transcript, live or read from its session. */
  snapshot(taskId: string): Promise<{ blocks: readonly ServiceBlock[] }>;
}

/** What the automation engine works with; tests pass fakes for the runs and the clock. */
export interface EngineDeps {
  paths: ServicePaths;
  store: AutomationStore;
  snapshots: FolderSnapshots;
  ledger: Ledger;
  events: EventLog;
  manager: AutomationRuns;
  /** The service-side command launch (commands/launch.ts) bound to the service. */
  launchCommand: CommandLauncher;
  folders: Pick<FolderStore, 'resolve'>;
  resources: Pick<ResourceStore, 'save'>;
  /** The memory engine's job that `consolidateMemory` runs carry out. */
  consolidateMemory: ConsolidateMemory;
  /** How long the Mac has had no input, as the shell last reported it (idle triggers). */
  activity: Pick<SystemActivity, 'idleSeconds'>;
  log: Logger;
  /** The wall clock (epoch ms); injectable so tests drive the tick. */
  now: () => number;
  /** How watched folders are read; absent reads them from disk (folder-watch.ts). */
  scanner?: FolderScanner;
  /** Something the status shows changed without a store write. */
  changed: () => void;
}
