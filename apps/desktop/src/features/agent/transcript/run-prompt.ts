import type { RunSnapshot, TaskRun } from '../../../client/agent/task-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';

/** Pending-bubble text before the first user block arrives: instruction first. */
export function pendingMessageText(snapshot: RunSnapshot): string {
  return (
    snapshot.instructions ||
    snapshot.input.text ||
    snapshot.input.files.map((file) => file.name).join(', ') ||
    snapshot.command?.name ||
    ''
  );
}

/**
 * The run whose prompt `block` is. Queued follow-ups have none, and neither has a prompt the task's
 * runs do not list yet: guessing another run would draw that run's input into this bubble.
 */
export function promptRun(runs: TaskRun[], block: BlockOf<'user'>): TaskRun | undefined {
  return block.prompt ? runs.find((run) => run.id === block.runId) : undefined;
}
