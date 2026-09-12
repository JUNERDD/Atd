import { readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileFingerprint } from './resources';
import type { Artifact } from './task-schema';

export async function outputVersions(directory: string): Promise<Map<string, string>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
      for (const [nested, version] of await outputVersions(file)) files.set(nested, version);
    else if (entry.isFile()) files.set(file, await fileFingerprint(file));
  }
  return files;
}

export async function recordOutput(
  file: string,
  taskId: string,
  runId: string,
  partial: boolean,
  save: (artifact: Artifact) => Promise<void>,
) {
  const fingerprint = await fileFingerprint(file);
  if (fingerprint === 'missing') return;
  const info = await stat(file);
  if (!info.isFile()) return;
  await save({
    id: randomUUID(),
    taskId,
    runId,
    name: path.basename(file),
    path: file,
    size: info.size,
    fingerprint,
    relocation: null,
    status: 'available',
    partial,
  });
}
