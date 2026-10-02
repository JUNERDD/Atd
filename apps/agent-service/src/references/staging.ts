import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MAX_RUN_REFERENCES, runReferenceKey, type RunReference } from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';

/**
 * Next-run reference staging, mirroring mcp/staging.ts. SubmitTaskRequest carries
 * only what acceptance freezes, so the composer's `@` references stage per task and the run freeze
 * consumes them once (run-freeze.ts). Staging is a plain file write: it does
 * not need the MCP authority, and staging never changes an accepted run.
 */
export interface ReferenceStaging {
  references: RunReference[];
  stagedAt: string;
}

interface PendingFile {
  version: 1;
  tasks: Record<string, ReferenceStaging>;
}

function pendingFile(dataDir: string): string {
  return path.join(dataDir, 'references', 'pending.json');
}

async function readPending(dataDir: string): Promise<PendingFile> {
  try {
    return JSON.parse(await readFile(pendingFile(dataDir), 'utf8')) as PendingFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, tasks: {} };
    throw new Error('Reference staging could not be read. The original file is preserved.');
  }
}

/** Replaces the task's staged references for its next run, deduped in order. */
export async function stageTaskReferences(
  dataDir: string,
  taskId: string,
  references: RunReference[],
): Promise<ReferenceStaging> {
  const file = await readPending(dataDir);
  const seen = new Set<string>();
  const deduped = references.slice(0, MAX_RUN_REFERENCES).filter((reference) => {
    const key = runReferenceKey(reference);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const staging: ReferenceStaging = { references: deduped, stagedAt: new Date().toISOString() };
  file.tasks[taskId] = staging;
  await atomicWrite(pendingFile(dataDir), file);
  return staging;
}

/** Takes the staged references once at run freeze; none staged means none. */
export async function takeTaskReferences(dataDir: string, taskId: string): Promise<RunReference[]> {
  const file = await readPending(dataDir);
  const staging = file.tasks[taskId];
  if (!staging) return [];
  delete file.tasks[taskId];
  await atomicWrite(pendingFile(dataDir), file);
  return staging.references;
}
