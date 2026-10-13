import { randomUUID } from 'node:crypto';
import {
  isActiveStatus,
  type PermissionTier,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
} from '@atd/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { ConflictError } from '../errors.js';
import type { FolderStore } from '../folders/store.js';
import type { RunnerContext, TaskRunner } from '../task-runner.js';
import { checkChipRanges } from './input-chips.js';
import {
  branchUserEntries,
  checkBranchBefore,
  freezeRunSnapshot,
  loadSubmitCatalog,
} from './run-snapshot.js';
import { checkSideChatOf, newTaskRecord, type InternalSubmitOptions } from './submit-options.js';

export interface RunAcceptanceDeps {
  ctx: RunnerContext;
  /** Folder grants: a submit grants its message's folders, a run reads them at its start. */
  folders: FolderStore;
  /** The shared settings' default tier, frozen onto each task at creation. */
  newTaskTier: () => PermissionTier;
  /** The task's runner, when it has one: its live transcript names the entries a run may replace. */
  runner: (taskId: string) => TaskRunner | undefined;
}

/**
 * Accepts submitted runs into the ledger as `queued`, idempotently: repeats of an operation return
 * the original run, never a new one. Acceptance checks the request, freezes its snapshot and
 * grants its folders; starting the run is the runner manager's (runner-manager.ts `dispatch`).
 */
export class RunAcceptance {
  /**
   * Tasks whose accepted run is still being written. The ledger publishes a change only after its
   * write lands, so without this two submits to one task could both pass the active-run check,
   * and a replacing run (`branchBefore`) could then cut the other off the branch.
   */
  private readonly accepting = new Set<string>();

  constructor(private readonly deps: RunAcceptanceDeps) {}

  /**
   * `internal` carries what only service code may set (an automation's origin, tier, title and
   * trigger). `behind` names a run of the task that is about to complete and may still be active:
   * the run is accepted behind it, queued, and starts once it ends (runner-manager.ts `startHeld`).
   */
  async accept(
    request: SubmitTaskRequest,
    internal: InternalSubmitOptions,
    behind?: string,
  ): Promise<SubmitTaskResponse> {
    const { ctx } = this.deps;
    checkChipRanges(request.input);
    // Read before the checks below so acceptance stays free of awaits until the ledger write.
    const connections = await ConnectionStore.load(ctx.paths.root);
    const ledger = ctx.ledger;
    const last = ledger.data.tasks.find((item) => item.id === request.taskId)?.runs.at(-1);
    const catalog = await loadSubmitCatalog(connections, request, last);
    const onBranch = await branchUserEntries(ctx, this.deps.runner(request.taskId ?? ''), request);
    const duplicate = ledger.operation(request.operationId);
    if (duplicate) return { taskId: duplicate.taskId, runId: duplicate.runId, duplicate: true };
    const taskId = request.taskId ?? randomUUID();
    const previous = ledger.data.tasks.find((item) => item.id === taskId) ?? null;
    if (previous && request.taskId === undefined) {
      // A fresh uuid collided; retry once rather than merging into a stranger.
      return this.accept({ ...request, taskId: randomUUID() }, internal, behind);
    }
    const active = previous?.runs.some((run) => run.id !== behind && isActiveStatus(run.status));
    if (active || this.accepting.has(taskId))
      throw new ConflictError('Finish the active run before starting a new one.');
    checkBranchBefore(request.branchBefore, onBranch);
    const { sideChatOf } = request;
    checkSideChatOf(sideChatOf, previous, ledger.data.tasks);
    for (const file of request.input.files) {
      if (!ledger.data.resources.some((resource) => resource.id === file.id))
        throw new Error(`Attachment ${file.id} was not uploaded.`);
    }
    const folderIds = request.input.folders ?? [];
    this.deps.folders.resolve(folderIds);
    const snapshot = freezeRunSnapshot(request, connections, catalog, previous, onBranch, internal);
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.accepting.add(taskId);
    // Granted before the run exists, so no dispatch can start it without its folders.
    await this.deps.folders.grant(taskId, folderIds).catch((error: unknown) => {
      this.accepting.delete(taskId);
      throw error;
    });
    await ledger
      .change((data) => {
        let task = data.tasks.find((item) => item.id === taskId);
        if (!task) {
          const tier = this.deps.newTaskTier();
          task = newTaskRecord({ id: taskId, now, snapshot, tier, sideChatOf, internal });
          data.tasks.unshift(task);
        }
        task.runs.push({
          id: runId,
          operationId: request.operationId,
          createdAt: now,
          status: 'queued',
          error: '',
          snapshot,
        });
        task.updatedAt = now;
        data.operations[request.operationId] = { taskId, runId };
      })
      .finally(() => this.accepting.delete(taskId));
    ctx.events.publish({
      taskId,
      runId,
      executionId: `root:${runId}`,
      type: 'run.status',
      data: { status: 'queued', error: '' },
    });
    return { taskId, runId, duplicate: false };
  }
}
