import type { FolderRef } from '@atd/agent-contracts';
import type { ImportFailure } from '../client/contract';
import type { FileRef } from '../client/agent/task-schema';

/**
 * One batch the host imported: the resources created, the folders registered, and each path it
 * refused. Drops, pastes, the Finder service and the folder picker all hand over this shape.
 */
export interface ImportedFiles {
  files: FileRef[];
  folders: FolderRef[];
  /** `name` is the item's basename; refused paths never reach the page. */
  failures: ImportFailure[];
}

type Listener = (batch: ImportedFiles) => void;

let listener: Listener | null = null;
/** Imports that arrived before the composer mounted, handed over when it subscribes. */
const waiting: ImportedFiles[] = [];

/**
 * Hands files and folders the host imported outside the page's own pickers (the macOS shell's
 * drops, pastes and Finder service) to the composer, which owns the draft. One composer receives
 * them.
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
