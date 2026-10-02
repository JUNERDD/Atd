import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** How deep the overview lists: entries at this depth are shown but not expanded. */
export const OVERVIEW_DEPTH = 3;
/** The most entries one overview lists. */
export const OVERVIEW_ENTRIES = 200;

/**
 * Directories the overview never lists: dependency trees and build output, which are large and
 * rarely what the user means. Hidden entries (`.git`, `.next`, `.venv`) are skipped by name.
 */
const SKIPPED = new Set([
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'DerivedData',
  '__pycache__',
]);

interface Entry {
  /** Path segments below the folder. */
  segments: string[];
  directory: boolean;
}

/**
 * A bounded tree overview of a granted folder for a run's material: breadth first, so a large
 * first subdirectory cannot use up the budget before the folder's top level is listed; at most
 * `OVERVIEW_DEPTH` levels and `OVERVIEW_ENTRIES` entries, without hidden entries, `SKIPPED`
 * names, or paths the folder's root `.gitignore` excludes. Links are listed, never followed.
 * Says when it stopped at the entry limit. Unreadable directories are left out.
 */
export async function folderOverview(root: string): Promise<string> {
  const ignored = await rootGitignore(root);
  const entries: Entry[] = [];
  let level: string[][] = [[]];
  let truncated = false;
  for (let depth = 1; depth <= OVERVIEW_DEPTH && level.length && !truncated; depth += 1) {
    const next: string[][] = [];
    for (const parent of level) {
      const children = await readdir(path.join(root, ...parent), { withFileTypes: true }).catch(
        () => [],
      );
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (child.name.startsWith('.') || SKIPPED.has(child.name)) continue;
        const segments = [...parent, child.name];
        const directory = child.isDirectory();
        if (ignored(segments.join('/'), directory)) continue;
        if (entries.length >= OVERVIEW_ENTRIES) {
          truncated = true;
          break;
        }
        entries.push({ segments, directory });
        if (directory) next.push(segments);
      }
      if (truncated) break;
    }
    level = next;
  }
  const lines = entries.sort(treeOrder).map(({ segments, directory }) => {
    const indent = '  '.repeat(segments.length - 1);
    return `${indent}${segments.at(-1)}${directory ? '/' : ''}`;
  });
  if (!lines.length) lines.push('(no listed entries)');
  if (truncated)
    lines.push(`[Truncated after ${OVERVIEW_ENTRIES} entries; use ls or find for the rest.]`);
  return lines.join('\n');
}

/** Depth-first order of breadth-first collected entries, so children follow their directory. */
function treeOrder(a: Entry, b: Entry): number {
  const length = Math.min(a.segments.length, b.segments.length);
  for (let index = 0; index < length; index += 1) {
    const order = (a.segments[index] ?? '').localeCompare(b.segments[index] ?? '');
    if (order) return order;
  }
  return a.segments.length - b.segments.length;
}

interface IgnoreRule {
  glob: string;
  negate: boolean;
  directoryOnly: boolean;
  /** A pattern with a slash before its end matches from the folder root, else any basename. */
  anchored: boolean;
}

/**
 * The folder root's `.gitignore` as a matcher of slash-separated relative paths: comments,
 * negation, directory-only (`dir/`) and anchored patterns, globs through `path.matchesGlob`;
 * the last matching rule wins. Nested `.gitignore` files and git's global excludes are not read.
 */
async function rootGitignore(
  root: string,
): Promise<(relative: string, directory: boolean) => boolean> {
  const text = await readFile(path.join(root, '.gitignore'), 'utf8').catch(() => '');
  const rules = text.split(/\r?\n/).flatMap((line): IgnoreRule[] => {
    let pattern = line.trim();
    if (!pattern || pattern.startsWith('#')) return [];
    const negate = pattern.startsWith('!');
    if (negate) pattern = pattern.slice(1);
    const directoryOnly = pattern.endsWith('/');
    pattern = pattern.replace(/\/+$/, '');
    const anchored = pattern.includes('/');
    pattern = pattern.replace(/^\/+/, '');
    return pattern ? [{ glob: pattern, negate, directoryOnly, anchored }] : [];
  });
  return (relative, directory) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.directoryOnly && !directory) continue;
      const subject = rule.anchored ? relative : path.posix.basename(relative);
      if (globMatches(subject, rule.glob)) ignored = !rule.negate;
    }
    return ignored;
  };
}

function globMatches(subject: string, glob: string): boolean {
  try {
    return path.posix.matchesGlob(subject, glob);
  } catch {
    // A pattern the matcher cannot read excludes nothing.
    return false;
  }
}
