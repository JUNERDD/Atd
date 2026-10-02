import { isActive, type RunSnapshot, type TaskRun } from '../../../client/agent/task-schema';
import type { Block, BlockOf } from '../../../client/agent/transcript-schema';

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

/**
 * The latest run while its prompt has no user block yet, so the transcript draws it from the run
 * (`PendingTurn`). A task's first run stays pending until any user block arrives, failed or not,
 * so what was sent never disappears; a later run only while it is active, matched by its own
 * flagged prompt, since an earlier turn's message must not stand in for it.
 */
export function pendingPromptRun(runs: TaskRun[], blocks: Block[]): TaskRun | undefined {
  const run = runs.at(-1);
  if (!run) return undefined;
  if (!blocks.some((block) => block.kind === 'user')) return run;
  if (!isActive(run.status)) return undefined;
  const prompted = blocks.some(
    (block) => block.kind === 'user' && block.prompt && block.runId === run.id,
  );
  return prompted ? undefined : run;
}
