import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * The product home that holds the `skills` and `agents` catalogs. `AI_ATD_HOME` overrides it (the
 * desktop sets it for isolated test profiles); otherwise it is `~/.atd` through `os.homedir()`, so a
 * confined service HOME cannot hide or redirect it. Read on every call, never cached.
 */
export function atdHome(): string {
  const override = process.env.AI_ATD_HOME?.trim();
  return override ? path.resolve(override) : path.join(homedir(), '.atd');
}

/** The product-home skill catalog, `<atdHome>/skills`. */
export function atdSkillsDir(): string {
  return path.join(atdHome(), 'skills');
}

/** The product-home markdown specialist catalog, `<atdHome>/agents`. */
export function atdAgentsDir(): string {
  return path.join(atdHome(), 'agents');
}

/**
 * The cross-client user home of skills and agents, `~/.agents`, through `os.homedir()` like
 * `atdHome`. The read tool may read under it; no tool writes there.
 */
export function userAgentsHome(): string {
  return path.join(homedir(), '.agents');
}

/**
 * What the read tools may reach for `~/.agents`: the home itself plus each skill linked into
 * `~/.agents/skills`. Skill managers commonly symlink a skill there from elsewhere; confinement
 * compares real paths, so without the link as a root of its own such a skill would read as
 * outside. Only direct links under `skills` count, so a deeper link cannot widen access. Read on
 * every call, like the skill catalog.
 */
export async function userAgentsReadRoots(): Promise<string[]> {
  const home = userAgentsHome();
  const skills = path.join(home, 'skills');
  try {
    const entries = await readdir(skills, { withFileTypes: true });
    const linked = entries.filter((entry) => entry.isSymbolicLink());
    return [home, ...linked.map((entry) => path.join(skills, entry.name))];
  } catch {
    // No skills directory: the home alone.
    return [home];
  }
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Unicode space variants that pi's file tools read as a plain space. */
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Resolves a file tool's `path` argument as pi does: the path write and edit act on, and the
 * path read opens unless it falls back to a macOS spelling of a missing name. Classify tool
 * calls with it rather than `path.resolve`, which keeps an `@`, `~` or `file://` path inside
 * `cwd` while pi reaches outside it. Mirrors the unexported `resolveToCwd` of
 * `@earendil-works/pi-coding-agent` 1.0.0 (`dist/core/tools/path-utils.js`, which calls
 * `resolvePath` in `dist/utils/paths.js`); re-check it when upgrading pi.
 */
export function resolveToolPath(cwd: string, rawPath: string): string {
  const target = normalizePath(rawPath.replace(UNICODE_SPACES, ' ').replace(/^@/, ''));
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(normalizePath(cwd), target);
}

export interface ConfinedPath {
  real: string;
  location: 'inside' | 'outside';
}

/**
 * Confines a tool path to the service dataDir, reporting whether it lands in
 * the task output dir. Also allows real paths under the product home skill and
 * agent catalogs (`<atdHome>/skills`, `<atdHome>/agents`, see `atdHome`), and
 * under `readRoots`, which only the read tool passes: `~/.agents` and the
 * directories of the skills the current run loaded. Every other path outside the data directory
 * stays blocked. `rawPath` is the path the operation touches, which pi's tools
 * pass already resolved, so it is not re-normalized like a tool argument.
 */
export async function confined(
  cwd: string,
  dataDir: string,
  rawPath: string,
  readRoots: readonly string[] = [],
): Promise<ConfinedPath> {
  // Both sides compare as real paths (a file not written yet through its nearest existing
  // ancestor), so a data dir reached through a link, such as the system temp dir on macOS, still
  // holds its own files.
  const real = await realAncestorPath(path.resolve(cwd, rawPath));
  if (inside(await resolveRoot(cwd), real)) return { real, location: 'inside' };
  if (inside(await resolveRoot(dataDir), real)) return { real, location: 'outside' };
  const roots = [atdSkillsDir(), atdAgentsDir(), ...readRoots];
  if (await underAny(roots, real)) return { real, location: 'outside' };
  throw new Error('File access outside the service data directory is blocked.');
}

/**
 * Directories under the data dir no agent file tool may write, whatever the task's cwd: the
 * service's security state (MCP launch approvals, mcp/launch-store.ts) and the plugin store
 * (`<dataDir>/plugins`, installed plugin code and its state). Only the service's own routes change
 * them.
 */
export function protectedWriteRoots(dataDir: string): string[] {
  return [path.join(dataDir, 'security'), path.join(dataDir, 'plugins')];
}

/**
 * `confined` for a write or edit: additionally refuses a path under `protectedWriteRoots`. Both
 * sides compare through their nearest existing real ancestor, so a symlinked data dir or a file
 * not written yet cannot slip past, and case-insensitively where the file system usually is.
 */
export async function confinedWrite(
  cwd: string,
  dataDir: string,
  rawPath: string,
): Promise<ConfinedPath> {
  const target = await confined(cwd, dataDir, rawPath);
  const real = foldCase(await realAncestorPath(target.real));
  for (const root of protectedWriteRoots(dataDir)) {
    if (inside(foldCase(await realAncestorPath(path.resolve(root))), real))
      throw new Error('Writing the service security state or the plugin store is blocked.');
  }
  return target;
}

/** The real path of the nearest existing ancestor, with the missing rest appended. */
export async function realAncestorPath(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function foldCase(value: string): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? value.toLowerCase()
    : value;
}

/**
 * Whether a file tool's `path` argument, resolved as pi resolves it, lies under
 * one of `roots`. Both sides compare as real paths, so a symlink inside a root
 * that leads elsewhere does not count.
 */
export async function withinRoots(
  roots: readonly string[],
  cwd: string,
  rawPath: string,
): Promise<boolean> {
  return underAny(roots, await realTarget(resolveToolPath(cwd, rawPath)));
}

/**
 * The resource id a file tool's `path` argument names, resolved as pi resolves it: the name of a
 * file directly in `resourcesDir` (a resource's file is `<resourcesDir>/<id>`), compared as real
 * paths so a link elsewhere does not count; null for any other path. Whose resource it is stays
 * the caller's question.
 */
export async function resourceIdAt(
  resourcesDir: string,
  cwd: string,
  rawPath: string,
): Promise<string | null> {
  const real = await realTarget(resolveToolPath(cwd, rawPath));
  return path.dirname(real) === (await resolveRoot(resourcesDir)) ? path.basename(real) : null;
}

async function realTarget(absolute: string): Promise<string> {
  try {
    return await realpath(absolute);
  } catch {
    // A missing path (a file about to be written) keeps its resolved form.
    return absolute;
  }
}

async function underAny(roots: readonly string[], real: string): Promise<boolean> {
  for (const root of roots) if (inside(await resolveRoot(root), real)) return true;
  return false;
}

async function resolveRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    return path.resolve(root);
  }
}

/** pi's `normalizePath` defaults: Windows shell drive paths, a leading `~`, `file://` URLs. */
function normalizePath(value: string): string {
  const windows = process.platform === 'win32';
  const input = windows ? windowsShellPath(value) : value;
  if (input === '~') return homedir();
  if (input.startsWith('~/') || (windows && input.startsWith('~\\')))
    return path.join(homedir(), input.slice(2));
  return input.startsWith('file://') ? fileURLToPath(input) : input;
}

/** pi's `normalizeWindowsShellPath`: Git Bash, MSYS, Cygwin and WSL drive paths. */
function windowsShellPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return value;
  const [, drive, rest] = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(value) ?? [];
  return drive ? `${drive.toUpperCase()}:\\${rest?.replaceAll('/', '\\') ?? ''}` : value;
}
