import { randomBytes } from 'node:crypto';
import { chmod, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes `content` to the file at the resolved real path `real` so a reader, or a restart in the
 * middle, sees the old file or the whole new one, never a torn one: a hidden sibling is written
 * and synced, takes the existing file's permission bits, and is renamed over the target, so the
 * target stays this real path and a link elsewhere is never written through. A file with other
 * hard links, or anything but a regular file, is written in place as before, so every link keeps
 * seeing the content; a rename would leave the other links on the old one. The temporary file
 * never outlives a failure. Extended attributes and ACLs of a replaced file are not carried over.
 */
export async function replaceFile(real: string, content: string): Promise<void> {
  const existing = await stat(real).catch(() => null);
  if (existing && (!existing.isFile() || existing.nlink > 1)) {
    await writeFile(real, content);
    return;
  }
  // A dot name: folder scans and file lists skip it while it exists (automations/folder-scan.ts).
  const temporary = path.join(path.dirname(real), `.atd-write-${randomBytes(6).toString('hex')}`);
  try {
    const handle = await open(temporary, 'wx');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Created with the default mode under the umask, as an in-place write of a new file would be.
    if (existing) await chmod(temporary, existing.mode & 0o7777);
    await rename(temporary, real);
  } finally {
    await rm(temporary, { force: true });
  }
}
