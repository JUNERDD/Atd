import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where file search may offer and attach files from. The native index decides what is searchable
 * (`crates/file-index`: hidden folders, ignore files, formats); the service re-applies none of
 * that and only keeps out what must never be offered, whatever the index holds: anything outside
 * home and iCloud Drive, the OS-owned folder inside home, and the service's own data dir (its
 * token, ledger, resources and the index itself). Attach checks each resolved path again.
 */
export interface SearchScope {
  readonly platform: NodeJS.Platform;
  /** Home with links resolved, so it compares directly against resolved file paths. */
  readonly home: string;
  /** Resolved iCloud Drive folder when it exists (macOS only); searched as its own root. */
  readonly iCloud: string | null;
  /** The service data dir with links resolved. */
  readonly dataDir: string;
}

/** The folders a scope is resolved from. */
export interface ScopeRoots {
  home: string;
  platform: NodeJS.Platform;
  dataDir: string;
}

/** The home-level folder that holds OS and application data rather than the user's files. */
const SYSTEM_FOLDERS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'library',
  win32: 'appdata',
};

/** Shown in place of iCloud Drive's real path, which sits inside the excluded Library folder. */
const ICLOUD_LABEL = 'iCloud Drive';

export async function resolveSearchScope({
  home,
  platform,
  dataDir,
}: ScopeRoots): Promise<SearchScope> {
  // The fs errors would carry absolute paths to the client.
  const resolved = await realpath(home).catch(() => {
    throw new Error('The home folder could not be read.');
  });
  const data = await realpath(dataDir).catch(() => {
    throw new Error('The service data folder could not be read.');
  });
  const iCloud =
    platform === 'darwin'
      ? await realpath(
          path.join(resolved, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
        ).catch(() => null)
      : null;
  return { platform, home: resolved, iCloud, dataDir: data };
}

/**
 * The parent folder as the renderer sees it when `filePath` may be offered, otherwise null. Home
 * files read as the home-relative folder ('' for home itself); iCloud Drive files as
 * `iCloud Drive[/folder]`. This is the only form of a path that leaves the service.
 */
export function offeredLocation(scope: SearchScope, filePath: string): string | null {
  if (segmentsBelow(scope.dataDir, filePath)) return null;
  // iCloud Drive first: its real path is inside home's OS-owned Library folder.
  const inICloud = scope.iCloud === null ? null : segmentsBelow(scope.iCloud, filePath);
  if (inICloud) return [ICLOUD_LABEL, ...inICloud.slice(0, -1)].join(path.sep);
  const inHome = segmentsBelow(scope.home, filePath);
  if (!inHome) return null;
  const folders = inHome.slice(0, -1);
  if (folders[0]?.toLowerCase() === SYSTEM_FOLDERS[scope.platform]) return null;
  return folders.join(path.sep);
}

/** The path's segments below `root`, file name last; null when it is not inside `root`. */
function segmentsBelow(root: string, filePath: string): string[] | null {
  const relative = path.relative(root, filePath);
  if (!relative || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  return segments[0] === '..' ? null : segments;
}
