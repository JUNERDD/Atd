import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ResourceRef } from '@ai/agent-contracts';
import { Ledger } from '../ledger.js';
import type { ServicePaths } from '../storage.js';
import { listFiles, sha256 } from './checks.js';
import type { DesktopResources, SourceLayout } from './sources.js';

/**
 * Resources/sessions/outputs importer. Attachment bytes move from the desktop
 * managed store into the service resources dir with their original ids, so
 * migrated run snapshots keep resolving. Pi session JSONL moves per task dir,
 * and task output dirs move verbatim. All copies verify sha256 afterwards.
 */
const MAX_ATTACHMENT_BYTES = 1024 * 1024;

function fingerprint(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copies attachments; returns inserted/identical counts plus a checksum. */
export async function importResources(
  ledger: Ledger,
  paths: ServicePaths,
  index: DesktopResources,
): Promise<{ inserted: number; identical: number; checksum: string }> {
  let inserted = 0;
  let identical = 0;
  const hashes: string[] = [];
  for (const resource of index.resources) {
    const bytes = await readFile(resource.managed).catch(() => {
      throw new Error(`Attachment ${resource.file.name} is missing from the desktop copy.`);
    });
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error(`Attachment ${resource.file.name} exceeds the 1 MB migration limit.`);
    if (fingerprint(bytes) !== resource.fingerprint)
      throw new Error(`Attachment ${resource.file.name} failed its fingerprint check.`);
    const target = path.join(paths.resourcesDir, resource.file.id);
    await mkdir(paths.resourcesDir, { recursive: true });
    const existing = ledger.data.resources.find((item) => item.id === resource.file.id);
    if (!existing) {
      await copyFile(resource.managed, target);
      const entry: ResourceRef = {
        id: resource.file.id,
        name: resource.file.name.slice(0, 255),
        size: bytes.length,
        mime: resource.file.type.slice(0, 100),
        taskId: resource.owners[0] ?? null,
        createdAt: new Date().toISOString(),
      };
      await ledger.change((data) => {
        data.resources.push(entry);
      });
      inserted += 1;
    } else {
      if (existing.size !== bytes.length || existing.name !== resource.file.name.slice(0, 255))
        throw new Error(`Resource ${resource.file.id} diverged since migration.`);
      identical += 1;
    }
    hashes.push(`${resource.file.id}:${sha256(bytes)}`);
  }
  return { inserted, identical, checksum: sha256(hashes.sort().join('\n')) };
}

/** Copies one sessions tree; returns copied file count plus a checksum. */
export async function importSessions(
  layout: SourceLayout,
  paths: ServicePaths,
): Promise<{ files: number; checksum: string; identical: boolean }> {
  const tasks = await listTaskDirs(layout.sessionsDir);
  let files = 0;
  let identical = true;
  const hashes: string[] = [];
  for (const taskId of tasks) {
    const from = path.join(layout.sessionsDir, taskId);
    const to = path.join(paths.sessionsDir, taskId);
    await mkdir(to, { recursive: true });
    for (const name of await listFiles(from)) {
      const source = path.join(from, name);
      const target = path.join(to, name);
      const digest = sha256(await readFile(source));
      hashes.push(`${taskId}/${name}:${digest}`);
      try {
        const current = sha256(await readFile(target));
        if (current !== digest) throw new Error(`Session file ${taskId}/${name} diverged.`);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          await copyFile(source, target);
          identical = false;
        } else throw error;
      }
      files += 1;
    }
  }
  return { files, checksum: sha256(hashes.sort().join('\n')), identical };
}

/** Copies task output dirs verbatim; returns copied file count + checksum. */
export async function importOutputs(
  layout: SourceLayout,
  paths: ServicePaths,
): Promise<{ files: number; checksum: string }> {
  const tasks = await listTaskDirs(layout.tasksDir);
  let files = 0;
  const hashes: string[] = [];
  for (const taskId of tasks) {
    const from = path.join(layout.tasksDir, taskId);
    const to = path.join(paths.tasksDir, taskId);
    const copied = await copyTreeVerified(from, to, `output/${taskId}`);
    files += copied.files;
    hashes.push(...copied.hashes);
  }
  return { files, checksum: sha256(hashes.sort().join('\n')) };
}

async function listTaskDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function copyTreeVerified(
  from: string,
  to: string,
  label: string,
): Promise<{ files: number; hashes: string[] }> {
  let files = 0;
  const hashes: string[] = [];
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { files: 0, hashes: [] };
    throw error;
  }
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const nested = await copyTreeVerified(source, target, `${label}/${entry.name}`);
      files += nested.files;
      hashes.push(...nested.hashes.map((hash) => `${entry.name}/${hash}`));
    } else if (entry.isFile()) {
      const info = await stat(source);
      if (info.size > 64 * 1024 * 1024)
        throw new Error(`Output file ${label}/${entry.name} exceeds the 64 MB limit.`);
      const digest = sha256(await readFile(source));
      try {
        const current = sha256(await readFile(target));
        if (current !== digest) throw new Error(`Output file ${label}/${entry.name} diverged.`);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          await copyFile(source, target);
        } else throw error;
      }
      hashes.push(`${entry.name}:${digest}`);
      files += 1;
    }
  }
  return { files, hashes };
}
