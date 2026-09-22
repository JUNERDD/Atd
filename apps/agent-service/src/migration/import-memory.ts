import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkSqliteSet, checksumDir, listFiles, sha256 } from './checks.js';
import type { SourceLayout } from './sources.js';

/**
 * Memory importer: consistent SQLite+Markdown copy from the desktop Hermes
 * dir into the service agent dir. The source must be paused+flushed first
 * (desktop marker); a WAL without SHM, or files shifting under the copy,
 * refuses the import rather than migrating a torn database. Markdown and
 * SQLite move together so neither side is half-migrated.
 *
 * Source: `<userData>/agent-v1/agent/pi-hermes-memory/`
 * Target: `<dataDir>/agent/pi-hermes-memory/`
 */
export const MEMORY_MARKDOWN = ['MEMORY.md', 'USER.md', 'FAILURE.md'] as const;

export interface MemoryImportResult {
  files: number;
  checksum: string;
  sqlite: { db: boolean; wal: boolean; shm: boolean };
  identical: boolean;
}

export async function importMemory(
  layout: SourceLayout,
  serviceAgentDir: string,
  flushed: boolean,
): Promise<MemoryImportResult> {
  if (!flushed)
    throw new Error('Memory migration requires the desktop paused+flushed marker first.');
  const target = path.join(serviceAgentDir, 'pi-hermes-memory');
  await mkdir(target, { recursive: true });
  const sqlite = await checkSqliteSet(layout.memoryDir);
  if (!sqlite.consistent)
    throw new Error(`Source memory database is not quiesced: ${sqlite.detail}`);
  const names = new Set<string>([...(await listFiles(layout.memoryDir))]);
  // Markdown may legitimately be absent on first run; copy what exists.
  const wanted = [...names].filter(
    (name) =>
      (MEMORY_MARKDOWN as readonly string[]).includes(name) ||
      name === 'sessions.db' ||
      name === 'sessions.db-wal' ||
      name === 'sessions.db-shm' ||
      name.endsWith('.md'),
  );
  let identical = true;
  for (const name of wanted.sort()) {
    const source = path.join(layout.memoryDir, name);
    const dest = path.join(target, name);
    const digest = sha256(await readFile(source));
    try {
      const current = sha256(await readFile(dest));
      if (current !== digest)
        throw new Error(`Memory file ${name} diverged since migration; refusing to overwrite.`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await copyFile(source, dest);
        identical = false;
      } else throw error;
    }
  }
  const checksum = wanted.length ? await checksumDir(target, wanted) : sha256('empty-memory');
  return {
    files: wanted.length,
    checksum,
    sqlite: { db: sqlite.db, wal: sqlite.wal, shm: sqlite.shm },
    identical,
  };
}
