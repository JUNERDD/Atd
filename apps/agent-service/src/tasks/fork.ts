import { randomUUID } from 'node:crypto';
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  isActiveStatus,
  type ForkTaskRequest,
  type ForkTaskResponse,
  type TaskRun,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import type { FolderStore } from '../folders/store.js';
import { subagentChildRoot } from '../subagents/child-transcript-read.js';
import type { Ledger } from '../ledger.js';
import type { ServicePaths } from '../storage.js';
import { NOT_ON_BRANCH, pathRunIds, turnEnd } from './turns.js';

export interface ForkContext {
  ledger: Ledger;
  paths: ServicePaths;
  folders: FolderStore;
}

/**
 * Forks a task at a turn into a new task (`POST /v1/tasks/:taskId/fork`). The new session file
 * holds the source branch up to the end of the turn `entryId` starts (tasks/turns.ts `turnEnd`),
 * written by Pi from a manager of its own on the source file: the source's live manager, if any,
 * keeps its leaf and its file. The new task keeps the source's title (unless one is given),
 * permission tier and folder grants (its copied messages may rely on them, and the overviews
 * already sent travel with the branch), starts its output and subagent folders as copies of the
 * source's, and carries copies of the runs its branch's entries belong to, which transcript
 * projection looks up by id (the first run and each invocation marker's run). Those copies are
 * history: they never execute again, and their idempotency entries keep pointing at the source
 * task.
 */
export async function forkTask(
  ctx: ForkContext,
  sourceId: string,
  request: ForkTaskRequest,
): Promise<ForkTaskResponse> {
  const source = ctx.ledger.task(sourceId);
  const title = request.title === undefined ? source.title : request.title.trim().slice(0, 120);
  if (!title) throw new TypeError('Invalid data: title is empty.');
  const [firstRun] = source.runs;
  if (!source.sessionFile || !firstRun) throw new TypeError(NOT_ON_BRANCH);
  const taskId = randomUUID();
  const sessionsDir = path.join(ctx.paths.sessionsDir, taskId);
  const outputDir = path.join(ctx.paths.tasksDir, taskId, 'output');
  try {
    // Opened with the new task's sessions directory, where the branched file is written.
    const reader = SessionManager.open(source.sessionFile, sessionsDir, ctx.paths.agentDir);
    const branch = reader.getBranch();
    const end = turnEnd(branch, request.entryId);
    const forked = branch.slice(0, branch.indexOf(end) + 1);
    const runs = forkedRuns(source.runs, pathRunIds(forked, firstRun.id));
    if (runs.some((run) => isActiveStatus(run.status)))
      throw new ConflictError('Wait for this turn to finish before forking it.');
    // The path always holds the turn's user message, so Pi writes the file at once.
    const sessionFile = reader.createBranchedSession(end.id);
    if (!sessionFile) throw new Error('The forked conversation could not be saved.');
    // Subagent sessions the copied turns ran; child-transcript-read.ts maps their recorded paths.
    await copyFolder(subagentChildRoot(source.sessionFile), subagentChildRoot(sessionFile));
    await copyFolder(path.join(ctx.paths.tasksDir, sourceId, 'output'), outputDir);
    await ctx.folders.copy(sourceId, taskId);
    const now = new Date().toISOString();
    await ctx.ledger.change((data) => {
      data.tasks.unshift({
        id: taskId,
        title,
        createdAt: now,
        updatedAt: now,
        sessionFile,
        runs,
        rootTaskId: null,
        parentExecutionId: null,
        ...(source.permissionTier ? { permissionTier: source.permissionTier } : {}),
      });
    });
    return { taskId };
  } catch (error) {
    // Nothing references a fork that failed before its ledger write; drop what it left on disk.
    await rm(sessionsDir, { recursive: true, force: true });
    await rm(path.dirname(outputDir), { recursive: true, force: true });
    await ctx.folders.forget(taskId);
    throw error;
  }
}

/** Copies of the source runs a forked path refers to, in the source's order. */
function forkedRuns(runs: readonly TaskRun[], referenced: readonly string[]): TaskRun[] {
  const ids = new Set(referenced);
  return runs.filter((run) => ids.has(run.id)).map((run) => structuredClone(run));
}

/** Copies a source folder, when it exists, to a new one. */
async function copyFolder(from: string, to: string): Promise<void> {
  const exists = await stat(from).then(
    (info) => info.isDirectory(),
    () => false,
  );
  if (exists) await cp(from, to, { recursive: true, errorOnExist: true, force: false });
}
