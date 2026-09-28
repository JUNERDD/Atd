import { app } from 'electron';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { parse } from '../agent/validation';

/**
 * Which service code the launcher executes, and whether a service that is already running still
 * runs that code: mtimes for unpackaged sources and builds, the bundled build id when packaged.
 */

export interface ServiceCommand {
  /** Loader flags that precede the script. Empty when the script is compiled. */
  nodeArgs: string[];
  /** CLI path. Engines are read from the package.json beside this file. */
  script: string;
}

/**
 * Unpackaged launches prefer the built `dist/cli.js` when it is newer than
 * every service source file (about 2.6s vs 5.4s cold start); a stale dist
 * falls back to `src/cli.ts` through jiti, so a restart always executes the
 * current service source. Packaged launches keep the bundled dist.
 */
export async function resolveServiceCommand(): Promise<ServiceCommand> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (!app.isPackaged) {
    const source = await firstReadable(sourceCliCandidates(here));
    const dist = await firstReadable(distCliCandidates(here));
    if (dist && source && (await isDistFresh(dist, path.dirname(source)))) {
      return { nodeArgs: [], script: dist };
    }
    if (source) {
      const register = path.resolve(
        path.dirname(source),
        '../node_modules/jiti/lib/jiti-register.mjs',
      );
      if (!(await isReadable(register))) {
        if (dist) return { nodeArgs: [], script: dist };
        throw new Error(
          'The agent service source is present, but its TypeScript loader (jiti) is not installed. Run pnpm install, then start again.',
        );
      }
      return { nodeArgs: ['--import', pathToFileURL(register).href], script: source };
    }
  }
  const dist = await firstReadable(distCliCandidates(here));
  if (dist) return { nodeArgs: [], script: dist };
  throw new Error(
    'The agent service is not built. Run `pnpm --filter @ai/agent-service build`, then try again.',
  );
}

/** `build-info.json` at the packaged service package root; written by the service build. */
const BuildInfoSchema = Type.Object({
  version: Type.Literal(1),
  buildId: Type.String({ minLength: 1, maxLength: 128 }),
});

/**
 * Build id of the service bundled with this packaged app, which a running service copies into
 * its endpoint file. Null when the file is missing or invalid: the caller cannot prove a running
 * service matches, so it replaces it.
 */
export async function readBundledBuildId(): Promise<string | null> {
  try {
    const file = path.join(process.resourcesPath, 'agent-service', 'build-info.json');
    return parse(BuildInfoSchema, JSON.parse(await readFile(file, 'utf8'))).buildId;
  } catch {
    return null;
  }
}

/**
 * True when the build is newer than every `.ts` source file. The comparison
 * takes the newest file anywhere in `dist`, not the CLI alone: the dev watcher
 * compiles incrementally, so editing one module rewrites only that module's
 * output and leaves `cli.js` at the time of the last full build. tsc writes
 * its build-info file after the emit, so a dist that is newer than every
 * source also means the compile finished. A read failure returns false (run
 * current source); workspace dependencies still require `pnpm build`, as in
 * both launch paths.
 */
async function isDistFresh(distFile: string, srcDir: string): Promise<boolean> {
  const newestSrc = await newestMtimeMs(srcDir, '.ts');
  if (newestSrc === null) return false;
  const newestDist = await newestMtimeMs(path.dirname(distFile));
  return newestDist !== null && newestSrc <= newestDist;
}

/**
 * True when a service that started at `startedAt` (ISO, from its endpoint
 * file) still runs the current code: its own sources, the build the launcher
 * would execute, and the sources of the workspace packages it is compiled
 * against must all predate the process. Unpackaged callers only. Every
 * unknown answer — absent input, unreadable entry, unparseable timestamp —
 * is false, so a caller respawns instead of reusing possibly stale code.
 */
export async function isRunningServiceCurrent(startedAt: string): Promise<boolean> {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await firstReadable(sourceCliCandidates(here));
  const dist = await firstReadable(distCliCandidates(here));
  if (!source || !dist) return false;
  const workspaceDirs = await workspaceSourceDirs(path.resolve(path.dirname(source), '..'));
  if (!workspaceDirs) return false;
  // dist counts too: a rebuild after the process started means the live
  // process is running the previous build.
  for (const dir of [path.dirname(source), path.dirname(dist), ...workspaceDirs]) {
    const newest = await newestMtimeMs(dir);
    if (newest === null || newest > started) return false;
  }
  return true;
}

/**
 * `src` directories of the workspace packages the service imports at runtime,
 * read from its own manifest so a new workspace dependency is covered without
 * editing this file, and resolved through the links pnpm writes into the
 * service's node_modules. devDependencies stay out: they are build config,
 * not code the service loads. Null when the manifest cannot be read.
 */
async function workspaceSourceDirs(serviceRoot: string): Promise<string[] | null> {
  let manifest: { dependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(await readFile(path.join(serviceRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };
  } catch {
    return null;
  }
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, range]) => typeof range === 'string' && range.startsWith('workspace:'))
    .map(([name]) => path.join(serviceRoot, 'node_modules', name, 'src'));
}

/**
 * Newest file mtime under `dir` in ms, walking subdirectories but never
 * node_modules; `ext` limits which files count. Returns null when any entry
 * cannot be read, so callers can tell "nothing changed" apart from "cannot
 * tell" instead of reading an unreadable tree as unchanged.
 */
async function newestMtimeMs(dir: string, ext?: string): Promise<number | null> {
  let newest = 0;
  const pending: string[] = [dir];
  while (pending.length) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') pending.push(full);
        continue;
      }
      if (ext !== undefined && !entry.name.endsWith(ext)) continue;
      try {
        const mtime = (await stat(full)).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        return null;
      }
    }
  }
  return newest;
}

function sourceCliCandidates(here: string): string[] {
  return [
    path.resolve(here, '../../agent-service/src/cli.ts'),
    path.resolve(here, '../../../agent-service/src/cli.ts'),
  ];
}

function distCliCandidates(here: string): string[] {
  return [
    path.join(process.resourcesPath, 'agent-service/dist/cli.js'),
    path.resolve(app.getAppPath(), '../agent-service/dist/cli.js'),
    path.resolve(here, '../../agent-service/dist/cli.js'),
    path.resolve(here, '../../../agent-service/dist/cli.js'),
  ];
}

async function firstReadable(candidates: string[]): Promise<string | null> {
  for (const file of candidates) {
    if (await isReadable(file)) return file;
  }
  return null;
}

async function isReadable(file: string): Promise<boolean> {
  try {
    await readFile(file, 'utf8');
    return true;
  } catch {
    return false;
  }
}
