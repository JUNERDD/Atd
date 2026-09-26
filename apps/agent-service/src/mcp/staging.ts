import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../config.js';

/**
 * Next-run MCP staging (T6b), mirroring skills/staging.ts. SubmitTaskRequest
 * carries only what acceptance freezes, so MCP tool selection for the next run
 * stages per task and is consumed once at run freeze. No staging means bind-all (current behavior);
 * staged selection (even empty) binds exactly the frozen set. Staging never
 * mutates an accepted run; unreleased staging applies to the next run.
 */
export interface McpToolSelection {
  connectionId: string;
  tool: string;
}

export interface McpTaskStaging {
  tools: McpToolSelection[];
  stagedAt: string;
}

export interface McpRunSelection {
  runId: string;
  tools: McpToolSelection[];
  frozenAt: string;
}

interface PendingFile {
  version: 1;
  tasks: Record<string, McpTaskStaging>;
}

function pendingFile(dataDir: string): string {
  return path.join(dataDir, 'mcp', 'pending.json');
}

function runFile(dataDir: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw new Error('Invalid run id.');
  return path.join(dataDir, 'mcp', 'runs', `${runId}.json`);
}

async function readPending(dataDir: string): Promise<PendingFile> {
  try {
    return JSON.parse(await readFile(pendingFile(dataDir), 'utf8')) as PendingFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, tasks: {} };
    throw new Error('MCP staging could not be read. The original file is preserved.');
  }
}

/** Stages MCP tool selection for the next run of a task (deduped). */
export async function stageTaskMcp(
  dataDir: string,
  taskId: string,
  tools: McpToolSelection[],
): Promise<McpTaskStaging> {
  const file = await readPending(dataDir);
  const seen = new Set<string>();
  const deduped = tools
    .slice(0, 64)
    .filter((item) => item.connectionId.trim() && item.tool.trim())
    .filter((item) => {
      const key = `${item.connectionId}\0${item.tool}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const staging: McpTaskStaging = { tools: deduped, stagedAt: new Date().toISOString() };
  file.tasks[taskId] = staging;
  await atomicWrite(pendingFile(dataDir), file);
  return staging;
}

/** Reads staged selection without consuming it (for proof and UI preview). */
export async function peekTaskMcpStaging(
  dataDir: string,
  taskId: string,
): Promise<McpTaskStaging | null> {
  return (await readPending(dataDir)).tasks[taskId] ?? null;
}

/** Takes staged selection once at run freeze; absent staging stays absent. */
export async function takeTaskMcpStaging(
  dataDir: string,
  taskId: string,
): Promise<McpTaskStaging | null> {
  const file = await readPending(dataDir);
  const staging = file.tasks[taskId] ?? null;
  if (!staging) return null;
  delete file.tasks[taskId];
  await atomicWrite(pendingFile(dataDir), file);
  return staging;
}

/**
 * Freezes the staged selection for a run (called once at accept). Returns
 * null when nothing was staged (bind-all preserved); otherwise writes the
 * per-run frozen record the binder reads. The live authority revision rides
 * the run audit next to the staged count, not this file.
 */
export async function freezeRunMcp(
  dataDir: string,
  taskId: string,
  runId: string,
): Promise<McpRunSelection | null> {
  const staging = await takeTaskMcpStaging(dataDir, taskId);
  if (!staging) return null;
  const selection: McpRunSelection = {
    runId,
    tools: staging.tools,
    frozenAt: new Date().toISOString(),
  };
  await atomicWrite(runFile(dataDir, runId), selection);
  return selection;
}

/** Reads the frozen run selection for binding; null means bind-all. */
export async function loadRunMcpSelection(
  dataDir: string,
  runId: string,
): Promise<McpRunSelection | null> {
  try {
    const raw = JSON.parse(await readFile(runFile(dataDir, runId), 'utf8')) as McpRunSelection;
    if (!Array.isArray(raw?.tools)) return null;
    return raw;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('MCP run selection could not be read. The original file is preserved.');
  }
}

/** Prunes the frozen run record after the run ends (mirrors skill release). */
export async function releaseRunMcp(dataDir: string, runId: string): Promise<boolean> {
  try {
    await rm(runFile(dataDir, runId), { force: false });
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
