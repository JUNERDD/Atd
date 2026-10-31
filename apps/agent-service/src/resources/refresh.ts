import { stat } from 'node:fs/promises';
import type { FileRef, LedgerData, ResourceRef, TaskInput } from '@atd/agent-contracts';
import type { ResourceStore } from '../resources.js';
import { AttachableRejected, inspectAttachable, readInspected } from './attachable-read.js';
import type { ResourceBatch } from './batch.js';
import { isLive, ResourceGone, sameVersion } from './stored.js';

/**
 * A run's input with its attached files as they are now. A file stored from a path that changed
 * since is read again into a fresh resource, staged in `batch` for the ledger change that records
 * the run, and the input names that resource instead. A source that is missing, unreadable,
 * refused by the attachment rules or now resolves to another file keeps the stored copy. A file
 * whose stored copy is gone, and that cannot be read again from its source, refuses the run
 * (`ResourceGone`), as does a file the ledger no longer holds.
 */
export async function currentInput(
  store: ResourceStore,
  input: TaskInput,
  batch: ResourceBatch,
): Promise<TaskInput> {
  const fresh = new Map<string, ResourceRef>();
  for (const file of input.files) {
    if (fresh.has(file.id)) continue;
    const current = await currentFile(store, file, batch);
    if (current) fresh.set(file.id, current);
  }
  return fresh.size ? renamed(input, fresh) : input;
}

/**
 * Inside the ledger change that records a run: refuses it when one of its files is not, or no
 * longer, readable there (removed by garbage collection while the run was being accepted).
 */
export function assertAttached(draft: LedgerData, files: readonly FileRef[]): void {
  for (const file of files) if (!isLive(draft, file.id)) throw new ResourceGone(file.name);
}

/** A fresh resource for `file`, or null when its stored copy stands. */
async function currentFile(
  store: ResourceStore,
  file: FileRef,
  batch: ResourceBatch,
): Promise<ResourceRef | null> {
  const row = store.stored(file.id);
  if (!row) throw new ResourceGone(file.name);
  const kept = await stat(store.pathOf(row.id)).then(
    (info) => info.isFile() && info.size === row.size,
    () => false,
  );
  const keep = (): null => {
    if (!kept) throw new ResourceGone(file.name);
    return null;
  };
  const { source } = row;
  if (!source || row.taskId !== null) return keep();
  // The same rules as an import; a source swapped for a link to another file is not followed.
  const now = await inspectAttachable(source.path).catch(() => null);
  if (!now?.source || now.realPath !== source.path) return keep();
  if (kept && sameVersion(now.source, source)) return null;
  try {
    return await store.save(
      { name: row.name, mime: row.mime, source: now.source, read: () => readInspected(now) },
      batch,
    );
  } catch (error) {
    if (!(error instanceof AttachableRejected)) throw error;
    return keep();
  }
}

/**
 * `input` naming each file's fresh resource: its file record, its chips, and its text, which
 * names resource ids where a command's `{{files}}` rendered them (commands/templates.ts). Ids are
 * UUIDs, so the text keeps its length and the chip ranges into it stay valid.
 */
function renamed(input: TaskInput, fresh: ReadonlyMap<string, ResourceRef>): TaskInput {
  let { text } = input;
  for (const [id, current] of fresh) text = text.replaceAll(id, current.id);
  const files = input.files.map((file) => {
    const current = fresh.get(file.id);
    return current ? { ...file, id: current.id, size: current.size, type: current.mime } : file;
  });
  const chips = input.chips?.map((range) => {
    const current = range.chip.kind === 'file' ? fresh.get(range.chip.fileId) : undefined;
    return current && range.chip.kind === 'file'
      ? { ...range, chip: { ...range.chip, fileId: current.id } }
      : range;
  });
  return { ...input, text, files, ...(chips ? { chips } : {}) };
}
