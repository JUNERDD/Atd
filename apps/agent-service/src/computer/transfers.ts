import { lstat, readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  COMPUTER_MAX_EVIDENCE,
  type ActionResult,
  type ComputerAction,
  type ComputerEvidence,
} from '@atd/agent-contracts';
import { refuse, type CallContext } from './call-context.js';
import { readDownloadMarks, writeDownloadMarks } from './download-marks.js';

/**
 * Files crossing between the task's resources and a browser target (contract spec v1.3 B2–B4).
 * An `upload` names task resources; the service alone turns them into the absolute files of its
 * resource store (`<dataDir>/resources/<resourceId>`), which the host and its worker check again.
 * A download the host's worker saved under `<dataDir>/computer/downloads/<runId>/` becomes a task
 * resource, and its staged file is deleted; its path is never recorded or shown to the model.
 */

/** The largest file a host sets on a file input (the host and the worker enforce it too). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SUMMARY_CHARS = 500;
const FALLBACK_MIME = 'application/octet-stream';

/** A download imported as a task resource, as the model reads it. */
export interface ImportedDownload {
  resourceId: string;
  name: string;
  bytes: number;
}

/** The directory the host's worker saves this run's downloads into. */
export function runDownloadDir(dataDir: string, runId: string): string {
  return path.join(dataDir, 'computer', 'downloads', runId);
}

/** A result as the service keeps it: never with the host's download paths. */
export function withoutDownloads(result: ActionResult): ActionResult {
  const { downloads: _downloads, ...rest } = result;
  void _downloads;
  return rest;
}

/**
 * The action with every `upload` step's `paths` filled in from its `resourceIds`, in order. Each
 * must be a resource of the run's task whose file is a regular file of at most 50 MB; anything
 * else refuses the call before it is approved or sent.
 */
export async function withUploadPaths(
  ctx: CallContext,
  action: ComputerAction,
  bindingId: string,
): Promise<ComputerAction> {
  if (!action.steps.some((step) => step.kind === 'upload')) return action;
  const owned = ctx.resources.forTask(ctx.taskId);
  const steps: ComputerAction['steps'] = [];
  for (const step of action.steps) {
    if (step.kind !== 'upload') {
      steps.push(step);
      continue;
    }
    const paths: string[] = [];
    for (const resourceId of step.resourceIds) {
      if (!owned.owns(resourceId))
        refuse(ctx, `${resourceId} is not a file of this task.`, { bindingId });
      const file = ctx.resources.pathOf(resourceId);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) refuse(ctx, `The file of ${resourceId} is missing.`, { bindingId });
      if (info.size > MAX_UPLOAD_BYTES)
        refuse(ctx, `${resourceId} is larger than 50 MB and cannot be uploaded.`, { bindingId });
      paths.push(file);
    }
    steps.push({ ...step, paths });
  }
  return { ...action, steps };
}

/** Whether `file` lies inside `dir` (both real paths). */
function inside(file: string, dir: string): boolean {
  return file.startsWith(`${dir}${path.sep}`);
}

/**
 * Imports the downloads a host result reports as resources of the task and returns the result
 * without them, with one `file` evidence per imported download instead. Only a file whose real
 * path lies inside this run's download directory is accepted; it is deleted once read, imported
 * or not (`notImported` names those over the resource store's limit or unreadable). A path
 * elsewhere is never read or touched.
 */
export async function importDownloads(
  ctx: CallContext,
  result: ActionResult,
): Promise<{ result: ActionResult; downloads: ImportedDownload[]; notImported: string[] }> {
  const reported = result.downloads ?? [];
  const kept = withoutDownloads(result);
  const notImported: string[] = [];
  if (reported.length === 0) return { result: kept, downloads: [], notImported };
  const dir = await realpath(runDownloadDir(ctx.runtime.dataDir, ctx.runId)).catch(() => null);
  const downloads: ImportedDownload[] = [];
  const evidence: ComputerEvidence[] = [];
  for (const download of reported) {
    const file = dir === null ? null : await realpath(download.path).catch(() => null);
    if (dir === null || file === null || !inside(file, dir) || !(await lstat(file)).isFile()) {
      ctx.log.warn('A computer download outside the run directory was ignored.', {
        runId: ctx.runId,
      });
      continue;
    }
    try {
      const marks = await readDownloadMarks(file);
      if (marks === null) throw new Error('The download carries no quarantine.');
      const bytes = new Uint8Array(await readFile(file));
      const resource = await ctx.resources.save({
        name: download.name,
        mime: download.mime ?? FALLBACK_MIME,
        bytes,
        taskId: ctx.taskId,
      });
      const saved = ctx.resources.pathOf(resource.id);
      // The task file keeps the download's quarantine, or is removed rather than left unchecked.
      await writeDownloadMarks(saved, marks).catch(async (error: unknown) => {
        await rm(saved, { force: true });
        throw error;
      });
      downloads.push({ resourceId: resource.id, name: resource.name, bytes: resource.size });
      const summary = `Downloaded ${resource.name} (${String(resource.size)} bytes)`;
      evidence.push({
        kind: 'file',
        summary: summary.slice(0, SUMMARY_CHARS),
        resourceId: resource.id,
      });
    } catch (error) {
      notImported.push(download.name);
      ctx.log.warn('A computer download was not imported.', {
        runId: ctx.runId,
        error: String(error),
      });
    } finally {
      await rm(file, { force: true });
    }
  }
  const all = [...kept.evidence.slice(0, COMPUTER_MAX_EVIDENCE - evidence.length), ...evidence];
  return { result: { ...kept, evidence: all }, downloads, notImported };
}
