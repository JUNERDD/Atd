import type { FileRef } from '../client/agent/task-schema';

/** Why the service refused a dropped or pasted file (`ResourceImportFailureReason`). */
export type ImportFailureReason = 'unreadable' | 'unsupported' | 'tooLarge';

/** One drop or paste the host imported: the resources created, and each file it refused. */
export interface ImportedFiles {
  files: FileRef[];
  /** `name` is the file's basename; the page never sees paths. */
  failures: { name: string; reason: ImportFailureReason }[];
}

type Listener = (batch: ImportedFiles) => void;

let listener: Listener | null = null;
/** Imports that arrived before the composer mounted, handed over when it subscribes. */
const waiting: ImportedFiles[] = [];

/**
 * Hands files the host imported outside the page's own pickers (the macOS shell's drops and
 * pastes) to the composer, which owns the draft. One composer receives them.
 */
export function publishImportedFiles(batch: ImportedFiles): void {
  if (listener) listener(batch);
  else waiting.push(batch);
}

/** Subscribes the composer; returns the unsubscribe. */
export function onImportedFiles(next: Listener): () => void {
  listener = next;
  for (const batch of waiting.splice(0)) next(batch);
  return () => {
    if (listener === next) listener = null;
  };
}
