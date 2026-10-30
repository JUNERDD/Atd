import { errorMessage } from '@atd/agent-contracts';
import { MATERIAL_TAGS, materialLine, materialSafe } from '../file-loader/material.js';
import type { Logger } from '../logging.js';
import { folderOverview, OVERVIEW_DEPTH } from './overview.js';
import type { FolderStore } from './store.js';

/** A folder the run may read, as its material and its read boundary see it. */
export interface RunFolder {
  /** The registered folder's id, which an automation's folder trigger and readable folders name. */
  id: string;
  name: string;
  /** The folder's realpath: a read root of the run (tool-proxies.ts, harness/search-tools.ts). */
  path: string;
  /** The tree overview, while no run's material has carried it to the task's session. */
  overview?: FolderOverview;
}

/** A folder's tree overview, and how a run records that its material carried it. */
export interface FolderOverview {
  text: string;
  /**
   * Marks the folder introduced, so later runs only list it. Never rejects: a failed write is
   * logged, and the next run introduces the folder again.
   */
  markIntroduced: () => Promise<void>;
}

/** Reads the granted folders a run starts with (`runFolders`), once, as the run starts. */
export type RunFolders = () => Promise<RunFolder[]>;

/**
 * The task's granted folders as the run starts with them. Captured once here, so a folder revoked
 * while the run works stays readable until the run ends and is gone from the next one. A folder
 * whose overview cannot be built is still granted, only without it, and the next run tries again.
 */
export async function runFolders(
  store: FolderStore,
  taskId: string,
  log: Logger,
): Promise<RunFolder[]> {
  const grants = await store.startRun(taskId);
  return Promise.all(
    grants.map(async ({ folder, introduce }): Promise<RunFolder> => {
      const base = { id: folder.id, name: folder.name, path: folder.path };
      if (!introduce) return base;
      const markIntroduced = () =>
        store.markIntroduced(taskId, [folder.id]).catch((error: unknown) => {
          log.warn('Folder introduction not saved; the next run introduces it again.', {
            taskId,
            error: errorMessage(error),
          });
        });
      try {
        return { ...base, overview: { text: await folderOverview(folder.path), markIntroduced } };
      } catch (error) {
        log.warn('Folder overview failed; the run lists the folder without it.', {
          taskId,
          error: errorMessage(error),
        });
        return base;
      }
    }),
  );
}

/**
 * Records that a run's material carried these folders' overviews to the task's session
 * (prompt-context.ts), so a run that ends before its prompt leaves them to the next one.
 */
export async function markFoldersIntroduced(folders: readonly RunFolder[]): Promise<void> {
  await Promise.all(
    folders.flatMap((folder) => (folder.overview ? [folder.overview.markIntroduced()] : [])),
  );
}

/**
 * The run material's section on readable folders: every granted folder by name and path, and the
 * overview of those the run introduces. Empty when the task has none. Names, paths and overview
 * entries are the user's, so none of them can close a material element (`materialSafe`).
 */
export function formatFolders(folders: readonly RunFolder[]): string {
  if (!folders.length) return '';
  const listed = folders.map(
    (folder) => `- ${materialLine(folder.name)}: ${materialLine(folder.path)}`,
  );
  const overviews = folders.flatMap((folder) =>
    folder.overview === undefined
      ? []
      : [
          [
            `<${MATERIAL_TAGS.folder} name="${attribute(folder.name)}" path="${attribute(folder.path)}">`,
            `Up to ${OVERVIEW_DEPTH} levels; hidden entries, dependency folders, build output and .gitignore matches are not listed.`,
            materialSafe(folder.overview.text),
            `</${MATERIAL_TAGS.folder}>`,
          ].join('\n'),
        ],
  );
  return [
    [
      'Readable folders: the user granted this task read-only access to these folders. Read their files with read, list them with ls and search them with find and grep, without asking. They are not writable with write or edit: save results in the task folder.',
      ...listed,
    ].join('\n'),
    ...overviews,
  ].join('\n\n');
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
  '\n': '&#10;',
  '\r': '&#13;',
};

/** A value inside a double-quoted attribute: a quote or a line break in a name cannot end it. */
function attribute(value: string): string {
  return value.replace(/[&"<>\n\r]/g, (char) => ENTITIES[char] ?? char);
}
