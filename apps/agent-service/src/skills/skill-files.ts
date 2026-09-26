import { open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Enough for a skill folder; a larger one is cut off and says so. */
const MAX_ENTRIES = 1000;
const MAX_DEPTH = 8;
/** Folders that are tooling, not skill content. */
const SKIPPED_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILE_BYTES = 256 * 1024;
/** A NUL in the first bytes marks a file as binary, as git decides. */
const SNIFF_BYTES = 8000;

/**
 * The skill folder's files as `/`-separated paths relative to it, with a trailing `/` for an empty
 * folder so it still shows. Links are listed but never followed, so a link cannot pull another
 * folder into the listing.
 */
export async function listSkillFiles(
  baseDir: string,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let truncated = false;
  async function walk(dir: string, prefix: string, depth: number): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (!entries.length && prefix) files.push(prefix);
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        if (depth >= MAX_DEPTH) {
          files.push(`${relative}/`);
          truncated = true;
          continue;
        }
        await walk(path.join(dir, entry.name), `${relative}/`, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(relative);
      }
    }
  }
  await walk(baseDir, '', 0);
  return { files, truncated };
}

/**
 * One text file of a skill folder. The path must resolve, links included, inside the folder; a
 * binary or oversized file answers its reason instead of content.
 */
export async function readSkillFile(
  baseDir: string,
  relative: string,
): Promise<{ path: string; content: string | null; reason: 'binary' | 'too_large' | null }> {
  if (path.isAbsolute(relative) || relative.includes('\0'))
    throw new Error(`"${relative}" is not a path inside the skill folder.`);
  const root = await realpath(baseDir);
  const target = await realpath(path.resolve(root, relative));
  if (target !== root && !target.startsWith(`${root}${path.sep}`))
    throw new Error(`"${relative}" is not a path inside the skill folder.`);
  const info = await stat(target);
  if (!info.isFile()) throw new Error(`"${relative}" is not a file.`);
  if (info.size > MAX_FILE_BYTES) return { path: relative, content: null, reason: 'too_large' };
  const handle = await open(target, 'r');
  try {
    const bytes = await handle.readFile();
    if (bytes.subarray(0, SNIFF_BYTES).includes(0))
      return { path: relative, content: null, reason: 'binary' };
    return { path: relative, content: bytes.toString('utf8'), reason: null };
  } finally {
    await handle.close();
  }
}
