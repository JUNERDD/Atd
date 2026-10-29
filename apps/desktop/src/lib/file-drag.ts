import { useSyncExternalStore } from 'react';

/**
 * The panel's file drop as the macOS shell reports it (`files.drag`): `over` while files are
 * dragged over the panel, `importing` from a drop until its import answered, `none` otherwise.
 * The page gets no DOM drag events for files, which the shell takes before WebKit.
 */
export interface FileDrag {
  phase: 'over' | 'importing' | 'none';
  /** Dragged files and folders; 0 outside `over`. */
  files: number;
  /**
   * What the drop's import takes: its first 10 files, of any format, and its first 10 folders.
   * At least 1 during `over`, since the shell reports only a drag that carries one; 0 otherwise.
   */
  attachable: number;
}

const NO_DRAG: FileDrag = { phase: 'none', files: 0, attachable: 0 };

let current = NO_DRAG;
const listeners = new Set<() => void>();

export function publishFileDrag(next: FileDrag): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current file drop; `none` outside the macOS shell. */
export function useFileDrag(): FileDrag {
  return useSyncExternalStore(subscribe, () => current);
}
