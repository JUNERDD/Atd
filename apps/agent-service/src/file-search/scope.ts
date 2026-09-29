import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Where file search looks: the home directory, plus iCloud Drive on macOS, minus hidden entries,
 * dependency trees, build and cache output, app bundles and the OS-owned home folder. Backends
 * prune with these rules, and attach re-checks each resolved path against them before reading.
 */
export interface SearchScope {
  readonly platform: NodeJS.Platform;
  /** Home with links resolved, so it compares directly against resolved file paths. */
  readonly home: string;
  /** Resolved iCloud Drive folder when it exists (macOS only); searched as its own root. */
  readonly iCloud: string | null;
}

/** Directory names skipped at any depth (compared in lower case). */
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'bower_components',
  '__pycache__',
  'site-packages',
  'deriveddata',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
]);

/** The home-level folder that holds OS and application data rather than the user's files. */
const SYSTEM_FOLDERS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'library',
  win32: 'appdata',
};

/** Shown in place of iCloud Drive's real path, which sits inside the excluded Library folder. */
const ICLOUD_LABEL = 'iCloud Drive';

export async function resolveSearchScope(
  home: string,
  platform: NodeJS.Platform,
): Promise<SearchScope> {
  // The fs error would carry the absolute home path to the client.
  const resolved = await realpath(home).catch(() => {
    throw new Error('The home folder could not be read.');
  });
  const iCloud =
    platform === 'darwin'
      ? await realpath(
          path.join(resolved, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
        ).catch(() => null)
      : null;
  return { platform, home: resolved, iCloud };
}

/**
 * Whether a directory is left out. `homeLevel` marks a folder directly inside home, where the
 * OS-owned folder (Library, AppData) is skipped; the same name deeper down stays searchable.
 */
export function isExcludedDirectory(scope: SearchScope, name: string, homeLevel: boolean): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('.') ||
    lower.endsWith('.app') ||
    EXCLUDED_DIRECTORIES.has(lower) ||
    (homeLevel && lower === SYSTEM_FOLDERS[scope.platform])
  );
}

/**
 * The parent folder as the renderer sees it when `filePath` is searchable, otherwise null:
 * outside every root, inside an excluded directory, or a hidden file. Home files read as the
 * home-relative folder ('' for home itself); iCloud Drive files as `iCloud Drive[/folder]`. This is
 * the only form of a path that leaves the service.
 */
export function searchableLocation(scope: SearchScope, filePath: string): string | null {
  // iCloud Drive first: its real path is inside home's excluded Library folder.
  const inICloud = scope.iCloud === null ? null : segmentsBelow(scope.iCloud, filePath);
  if (inICloud) return locate(scope, inICloud, ICLOUD_LABEL, false);
  const inHome = segmentsBelow(scope.home, filePath);
  return inHome ? locate(scope, inHome, '', true) : null;
}

function segmentsBelow(root: string, filePath: string): string[] | null {
  const relative = path.relative(root, filePath);
  if (!relative || path.isAbsolute(relative)) return null;
  const segments = relative.split(path.sep);
  return segments[0] === '..' ? null : segments;
}

function locate(
  scope: SearchScope,
  segments: string[],
  label: string,
  underHome: boolean,
): string | null {
  const folders = segments.slice(0, -1);
  const fileName = segments.at(-1);
  if (!fileName || fileName.startsWith('.')) return null;
  const excluded = folders.some((name, depth) =>
    isExcludedDirectory(scope, name, underHome && depth === 0),
  );
  if (excluded) return null;
  return (label ? [label, ...folders] : folders).join(path.sep);
}
