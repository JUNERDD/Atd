import type { FileRef, RunSnapshot, TaskRun } from '../../../electron/agent/task-schema';
import { fileSize } from '../../lib/task-store';

/** Pending-bubble text before the first transcript arrives: instruction first. */
export function pendingMessageText(snapshot: RunSnapshot): string {
  return (
    snapshot.instructions ||
    snapshot.input.text ||
    snapshot.input.files.map((file) => file.name).join(', ') ||
    snapshot.command?.name ||
    ''
  );
}

/** Owning snapshot for a transcript message: latest run created at or before it. */
export function snapshotForMessage(runs: TaskRun[], timestamp: number): RunSnapshot | undefined {
  let owning: TaskRun | undefined;
  for (const run of runs) {
    if (Date.parse(run.createdAt) <= timestamp) owning = run;
  }
  return (owning ?? runs[0])?.snapshot;
}

/** File-row detail in design format: uppercase extension plus formatted size. */
export function fileDetail(file: FileRef): string {
  const size = fileSize(file.size);
  const dot = file.name.lastIndexOf('.');
  if (dot <= 0 || dot === file.name.length - 1) return size;
  return `${file.name.slice(dot + 1).toUpperCase()} · ${size}`;
}
