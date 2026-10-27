import type {
  AgentTask,
  PermissionTier,
  RunComputer,
  RunSnapshot,
  RunTrigger,
  TaskOrigin,
} from '@atd/agent-contracts';
import { taskTitle } from './input-chips.js';
import { needsSummaryTitle } from './title-policy.js';

/**
 * What service code may set on an accepted run besides the HTTP request. The renderer-facing
 * `SubmitTaskRequestSchema` cannot carry these, so no client can forge an origin, a tier or a
 * trigger. `origin`, `permissionTier` and `title` apply only when the run creates its task.
 */
export interface InternalSubmitOptions {
  origin?: TaskOrigin;
  permissionTier?: PermissionTier;
  title?: string;
  /** Frozen as `RunSnapshot.trigger`, which makes the run unattended. */
  trigger?: RunTrigger;
  /**
   * Frozen as `RunSnapshot.instructions`, which reaches the model as hidden run material: what
   * only this run needs to be told (a command's output directive). A follow-up does not carry it.
   */
  instructions?: string;
  /**
   * Frozen as `RunSnapshot.lite`: the run takes the lightweight session (lite-session.ts). Only
   * `launchCommand` sets it, for a run it found eligible (commands/lite.ts); a follow-up does not
   * carry it.
   */
  lite?: true;
  /**
   * Frozen as `RunSnapshot.computer` with the automation grant or trial a request body cannot
   * carry. Only automation launches set it; a follow-up keeps the binding ids and drops the rest.
   */
  computer?: RunComputer;
}

/**
 * A side-chat link is set when its task is created and never changes. A new task is not in the
 * ledger yet, so naming an existing task also rules out the new task itself.
 */
export function checkSideChatOf(
  sideChatOf: string | undefined,
  previous: AgentTask | null,
  tasks: readonly AgentTask[],
): void {
  if (sideChatOf === undefined) return;
  if (previous) throw new TypeError('Invalid data: sideChatOf only applies to a new task.');
  if (!tasks.some((item) => item.id === sideChatOf))
    throw new TypeError('Invalid data: sideChatOf needs an existing task.');
}

/**
 * The ledger record of a task a run creates. Everything that labels the task is part of the
 * creating write, including whether its initial input needs a background summary. Short plain
 * requests retain their direct title without entering a loading state.
 */
export function newTaskRecord(fields: {
  id: string;
  now: string;
  snapshot: RunSnapshot;
  /** The shared settings' default tier, used when the options name none. */
  tier: PermissionTier;
  summaryTitles: boolean;
  sideChatOf: string | undefined;
  internal: InternalSubmitOptions;
}): AgentTask {
  const { id, now, snapshot, tier, summaryTitles, sideChatOf, internal } = fields;
  return {
    id,
    title: internal.title ?? taskTitle(snapshot),
    ...(summaryTitles &&
    internal.title === undefined &&
    internal.origin === undefined &&
    sideChatOf === undefined &&
    needsSummaryTitle(snapshot.input)
      ? { titleGeneration: 'pending' as const }
      : {}),
    createdAt: now,
    updatedAt: now,
    sessionFile: null,
    runs: [],
    rootTaskId: null,
    parentExecutionId: null,
    // A task keeps the tier it was created with; later default changes leave it alone.
    permissionTier: internal.permissionTier ?? tier,
    ...(internal.origin ? { origin: internal.origin } : {}),
    ...(sideChatOf ? { sideChatOf } : {}),
  };
}
