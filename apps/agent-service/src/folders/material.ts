import { errorMessage } from '@atd/agent-contracts';
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
  /** The tree overview, on the first run after the folder was granted. */
  overview?: string;
}

/** Reads the granted folders a run starts with (`runFolders`), once, as the run starts. */
export type RunFolders = () => Promise<RunFolder[]>;

/**
 * The task's granted folders as the run starts with them. Captured once here, so a folder revoked
 * while the run works stays readable until the run ends and is gone from the next one. A folder
 * whose overview cannot be built is still granted, only without it.
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
      try {
        return { ...base, overview: await folderOverview(folder.path) };
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
 * The run material's section on readable folders: every granted folder by name and path, and the
 * overview of those the run introduces. Empty when the task has none.
 */
export function formatFolders(folders: readonly RunFolder[]): string {
  if (!folders.length) return '';
  const listed = folders.map((folder) => `- ${folder.name}: ${folder.path}`);
  const overviews = folders.flatMap((folder) =>
    folder.overview === undefined
      ? []
      : [
          [
            `<folder_overview name="${folder.name}" path="${folder.path}">`,
            `Up to ${OVERVIEW_DEPTH} levels; hidden entries, dependency folders, build output and .gitignore matches are not listed.`,
            folder.overview,
            '</folder_overview>',
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
