import type { FolderRef, MAX_FOLDERS } from '@atd/agent-contracts';
import type { Screenshot } from '../../client/agent/screenshot-input';
import type { FileRef } from '../../client/agent/task-schema';
import type { ComposerDraft } from './draft';

/**
 * The chips that carry something the message sends beside its text: files (resources the run
 * reads) and folders (read grants for the task). Every attach path inserts them; submit derives
 * `input.files` and `input.folders` from them.
 */

/** The contract's cap, type-checked against it without importing the contracts at runtime. */
const MAX_FOLDER_IDS: typeof MAX_FOLDERS = 10;

/**
 * A file the draft sends. A screenshot is one chip for its image and `context`, the screen context
 * the shell imported beside the capture: both are sent, while only the image is shown.
 */
export interface FileChip {
  kind: 'file';
  file: FileRef;
  context?: FileRef;
}

/**
 * A folder the shell registered, which the message grants its task to read. `path` (the realpath)
 * is known while drafting and shows in the tooltip; a chip restored from a sent message has none.
 */
export interface FolderChip {
  kind: 'folder';
  folderId: string;
  name: string;
  path?: string;
}

/** What the attach paths (picker, capture, drop, paste, Finder) insert. */
export type AttachedChip = FileChip | FolderChip;

/** A registered folder's chip. */
export function folderChip({ id, name, path }: FolderRef): FolderChip {
  return { kind: 'folder', folderId: id, name, path };
}

/** A capture's chip: the image, with its screen context while `room` leaves space for it. */
export function screenshotChip(shot: Screenshot, room: number): FileChip {
  return shot.context && room > 1
    ? { kind: 'file', file: shot.file, context: shot.context }
    : { kind: 'file', file: shot.file };
}

/** A file chip's files: the file, then a screenshot's context. */
export function chipFiles(chip: FileChip): FileRef[] {
  return chip.context ? [chip.file, chip.context] : [chip.file];
}

/** Files sent with the draft: each file chip's files in draft order, each file once. */
export function draftFiles(draft: ComposerDraft): FileRef[] {
  const files: FileRef[] = [];
  for (const { chip } of draft.chips)
    if (chip.kind === 'file')
      for (const file of chipFiles(chip))
        if (!files.some((item) => item.id === file.id)) files.push(file);
  return files;
}

/** Ids of the draft's folder chips, each once, in draft order (uncapped, for the limit check). */
export function folderIds(draft: ComposerDraft): string[] {
  const ids = new Set<string>();
  for (const { chip } of draft.chips) if (chip.kind === 'folder') ids.add(chip.folderId);
  return [...ids];
}

/**
 * `input.folders`: the folder ids the draft grants its task, up to the contract's cap. The composer
 * refuses a folder past the cap before it becomes a chip, so the cut only guards the wire.
 */
export function draftFolders(draft: ComposerDraft): string[] {
  return folderIds(draft).slice(0, MAX_FOLDER_IDS);
}
