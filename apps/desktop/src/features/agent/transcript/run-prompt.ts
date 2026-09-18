import type { RunSnapshot, TaskRun } from '../../../../electron/agent/task-schema';

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

export function runById(runs: TaskRun[], runId: string): TaskRun | undefined {
  return runs.find((run) => run.id === runId) ?? runs[0];
}
