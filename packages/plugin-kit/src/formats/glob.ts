import { listDir, statPath, type AdapterContext } from './context.js';
import { joinPath } from './paths.js';

/**
 * Compiles a minimatch-style pattern over root-relative POSIX paths: `*` and `?` stay within one
 * segment, `**` spans segments, and wildcards do not match a leading `.` (minimatch's default
 * `dot: false`). Braces and character classes are not supported and match literally.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  const segments = pattern.replace(/^\.\//, '').split('/');
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/.][^/]*/)*';
      return;
    }
    let part = /^[*?]/.test(segment) ? '(?!\\.)' : '';
    for (const char of segment) {
      if (char === '*') part += '[^/]*';
      else if (char === '?') part += '[^/]';
      else part += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    source += part + (last ? '' : '/');
  });
  return new RegExp(`^${source}$`);
}

export function hasGlob(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?');
}

/**
 * Every visible file and directory below `dir` (dot entries and node_modules are skipped); empty
 * when `dir` is not a directory.
 */
export async function walk(
  ctx: AdapterContext,
  dir: string,
): Promise<{ path: string; kind: 'file' | 'dir' }[]> {
  const found: { path: string; kind: 'file' | 'dir' }[] = [];
  if ((await statPath(ctx, dir)) !== 'dir') return found;
  for (const entry of await listDir(ctx, dir)) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = joinPath(dir, entry.name);
    found.push({ path, kind: entry.kind });
    if (entry.kind === 'dir') found.push(...(await walk(ctx, path)));
  }
  return found;
}

/** Markdown files below `dir`, recursively, as paths relative to the plugin root. */
export async function markdownFiles(ctx: AdapterContext, dir: string): Promise<string[]> {
  const entries = await walk(ctx, dir);
  return entries
    .filter((entry) => entry.kind === 'file' && entry.path.toLowerCase().endsWith('.md'))
    .map((entry) => entry.path);
}

/**
 * Expands a glob against the tree, starting the walk at the pattern's literal directory prefix.
 * Matches are files or directories, sorted, as pi's `globSync` expansion returns them.
 */
export async function expandGlob(ctx: AdapterContext, pattern: string): Promise<string[]> {
  const normalized = pattern.replace(/^\.\//, '');
  const segments = normalized.split('/');
  const literal: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    if (hasGlob(segment)) break;
    literal.push(segment);
  }
  const matcher = globToRegExp(normalized);
  const entries = await walk(ctx, literal.join('/'));
  return entries
    .map((entry) => entry.path)
    .filter((path) => matcher.test(path))
    .sort();
}
