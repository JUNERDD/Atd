import type {
  AutomationDraft,
  AutomationItem,
  AutomationListResponse,
  AutomationRun,
  AutomationStatus,
  FolderRef,
  MarkAutomationRunsReadRequest,
  PreviewAutomationTriggerRequest,
  PreviewAutomationTriggerResponse,
} from '@atd/agent-contracts';
import type { ImportFailure } from './contract';

/**
 * The service refused a write because the automation moved on (HTTP 409): it changed since the
 * page read it, or a run of it is already in progress. `message` is the service's English text.
 */
export class AutomationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationConflictError';
  }
}

/** Why the service cannot save or turn on an automation as it stands. */
export type AutomationProblem = NonNullable<AutomationStatus['problem']>;

/**
 * The service refused a draft or a switch for a reason it names by code (HTTP 400, "Invalid
 * automation (<code>): …"), so the page words it in its own language. Other 400s stay errors with
 * the service's English text.
 */
export class AutomationProblemError extends Error {
  constructor(
    readonly problem: AutomationProblem,
    message: string,
  ) {
    super(message);
    this.name = 'AutomationProblemError';
  }
}

/**
 * Automations (`/v1/automations` through the relay): saved prompts and commands that start their
 * own tasks. Every write answers once the service did; `onChange` then reports the `automations`
 * invalidation every window receives, so lists and run histories reload from there. Next run
 * times come only from `preview`: the service owns the one schedule implementation.
 */
export interface AutomationsBridge {
  /** Every automation with its live status, the global pause, and a store problem if any. */
  list(): Promise<AutomationListResponse>;
  /** One automation as it is stored now, as an editor reloads it after a conflict. */
  get(id: string): Promise<AutomationItem>;
  /** Saves a new automation; a draft the service refuses by code rejects `AutomationProblemError`. */
  create(draft: AutomationDraft): Promise<AutomationItem>;
  /**
   * Replaces the automation; rejects with `AutomationConflictError` when `expectedRevision` is no
   * longer current, and with `AutomationProblemError` for a draft the service refuses by code.
   */
  update(id: string, expectedRevision: number, draft: AutomationDraft): Promise<AutomationItem>;
  /**
   * The row switch; turning an automation on clears the pause the service set. Rejects with
   * `AutomationConflictError` when `expectedRevision` is given and no longer current, and with
   * `AutomationProblemError` when the automation cannot run as saved (a one-time time now past).
   */
  setEnabled(id: string, enabled: boolean, expectedRevision?: number): Promise<AutomationItem>;
  /** Deletes the automation and its run history; the tasks it started stay. */
  remove(id: string): Promise<void>;
  /** Run now; rejects with `AutomationConflictError` while a run of it is in progress. */
  run(id: string): Promise<AutomationRun>;
  /** The automation's runs, newest first. */
  runs(id: string): Promise<AutomationRun[]>;
  /** The next run times of a trigger being edited, or why it cannot run. */
  preview(request: PreviewAutomationTriggerRequest): Promise<PreviewAutomationTriggerResponse>;
  /** Marks run results opened, by run (the run history) or by task (the panel opened it). */
  markRead(request: MarkAutomationRunsReadRequest): Promise<void>;
  /** The global pause: nothing fires on its own while it is on. */
  setPaused(paused: boolean): Promise<void>;
  /**
   * The shell's folder picker, which registers what the person picks, for a folder trigger or a
   * folder runs may read. Every pick lands in `folders` or `failures`; both are empty on cancel.
   */
  pickFolder(): Promise<{ folders: FolderRef[]; failures: ImportFailure[] }>;
  /**
   * Shows a task in the panel and reveals it: the `openTask` message the panel already follows
   * (`AppsBridge.onShowTask`), as Continue editing an app sends it.
   */
  showTask(taskId: string): Promise<void>;
  /**
   * Whether the service still has the task, asked before the panel shows a task a run started
   * (it may have been deleted since the run or its notification). Rejects when the service
   * cannot say.
   */
  taskExists(taskId: string): Promise<boolean>;
  /** Any automation, run, notice or the global pause changed, or the service reconnected. */
  onChange(listener: () => void): () => void;
}
