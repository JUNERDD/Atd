import { listDir, report, reportEscape, statPath, type AdapterContext } from './context.js';
import { expandGlob, globToRegExp, hasGlob, walk } from './glob.js';
import { baseName, dirName, joinPath, normalizeRelative } from './paths.js';

/**
 * pi package resource discovery, mirroring pi-coding-agent's `package-manager.js`
 * (`collectPackageResources`, `collectResourceFiles`, `applyPatterns`) over `ReadonlyFs`.
 */
export type PiResourceType = 'extensions' | 'skills' | 'prompts' | 'themes';

const FILE_PATTERN: Record<Exclude<PiResourceType, 'skills'>, RegExp> = {
  extensions: /\.(ts|js)$/,
  prompts: /\.md$/,
  themes: /\.json$/,
};

/**
 * pi's skill discovery: a directory holding `SKILL.md` is one skill; otherwise `.md` files directly
 * in the scanned root are standalone skills and subdirectories are searched recursively.
 */
async function skillEntries(ctx: AdapterContext, dir: string, root: string): Promise<string[]> {
  const entries = await listDir(ctx, dir);
  if (entries.some((entry) => entry.name === 'SKILL.md' && entry.kind === 'file')) {
    return [joinPath(dir, 'SKILL.md')];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = joinPath(dir, entry.name);
    if (entry.kind === 'file' && entry.name.endsWith('.md') && dir === root) found.push(path);
    else if (entry.kind === 'dir') found.push(...(await skillEntries(ctx, path, root)));
  }
  return found;
}

/** Files of one resource type below a directory. */
export async function collectResourceFiles(
  ctx: AdapterContext,
  dir: string,
  type: PiResourceType,
): Promise<string[]> {
  if (type === 'skills') return skillEntries(ctx, dir, dir);
  const pattern = FILE_PATTERN[type];
  const entries = await walk(ctx, dir);
  return entries
    .filter((entry) => entry.kind === 'file' && pattern.test(baseName(entry.path)))
    .map((entry) => entry.path);
}

function isOverride(entry: string): boolean {
  return entry.startsWith('!') || entry.startsWith('+') || entry.startsWith('-');
}

/** pi also matches a `SKILL.md` through its folder's path or name. */
function candidates(path: string): string[] {
  if (baseName(path) !== 'SKILL.md') return [path, baseName(path)];
  const dir = dirName(path);
  return [path, baseName(path), dir, baseName(dir)];
}

function matchesGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const matcher = globToRegExp(pattern);
    return candidates(path).some((candidate) => matcher.test(candidate));
  });
}

function matchesExact(path: string, patterns: string[]): boolean {
  const targets = baseName(path) === 'SKILL.md' ? [path, dirName(path)] : [path];
  return patterns.some((pattern) => targets.includes(pattern.replace(/^\.\//, '')));
}

/** `!glob` excludes, `+path` re-includes an exact path, `-path` excludes an exact path. */
function applyOverrides(files: string[], overrides: string[]): string[] {
  const pick = (prefix: string) =>
    overrides.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(1));
  const excludes = pick('!');
  const includes = pick('+');
  const removes = pick('-');
  let result = files.filter((path) => excludes.length === 0 || !matchesGlob(path, excludes));
  for (const path of files) {
    if (!result.includes(path) && matchesExact(path, includes)) result.push(path);
  }
  if (removes.length > 0) result = result.filter((path) => !matchesExact(path, removes));
  return result;
}

/**
 * Files selected by a `pi.<type>` manifest array: plain paths (files, or directories scanned by
 * type) and globs, then the manifest's own `!` / `+` / `-` overrides. Missing paths are reported.
 */
export async function manifestResourceFiles(
  ctx: AdapterContext,
  entries: string[],
  type: PiResourceType,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of entries.filter((candidate) => !isOverride(candidate))) {
    const path = normalizeRelative(entry);
    if (path === null) {
      reportEscape(ctx, entry);
      continue;
    }
    const matches = hasGlob(path) ? await expandGlob(ctx, path) : [path];
    for (const match of matches) {
      const kind = await statPath(ctx, match);
      if (kind === 'file') files.push(match);
      else if (kind === 'dir') files.push(...(await collectResourceFiles(ctx, match, type)));
      else if (!hasGlob(path)) {
        report(ctx, 'warning', 'invalid-component', `pi ${type} path "${entry}" does not exist.`, {
          path: 'package.json',
        });
      }
    }
  }
  const unique = [...new Set(files)];
  return applyOverrides(unique, entries.filter(isOverride));
}
