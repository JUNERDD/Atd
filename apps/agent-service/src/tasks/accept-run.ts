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
import { ResourceStore } from '../resources.js';
import { ResourceBatch } from '../resources/batch.js';
import { assertAttached, currentInput } from '../resources/refresh.js';
import type { RunnerContext, TaskRunner } from '../task-runner.js';
import { checkChipRanges } from './input-chips.js';
import {
  branchUserEntries,
  checkBranchBefore,
  freezeRunSnapshot,
  loadSubmitCatalog,
} from './run-snapshot.js';
import { checkSideChatOf, newTaskRecord, type InternalSubmitOptions } from './submit-options.js';
import type { TaskTitles } from './titles.js';

export interface RunAcceptanceDeps {
  ctx: RunnerContext;
  /** Folder grants: a submit grants its message's folders, a run reads them at its start. */
  folders: FolderStore;
  /** The shared settings' default tier, frozen onto each task at creation. */
  newTaskTier: () => PermissionTier;
  titles: TaskTitles;
  /** The task's runner, when it has one: its live transcript names the entries a run may replace. */
  runner: (taskId: string) => TaskRunner | undefined;
}

/**
 * Accepts submitted runs into the ledger as `queued`, idempotently: repeats of an operation return
 * the original run, never a new one. Acceptance checks the request, brings its attached files up
 * to date (resources/refresh.ts), freezes its snapshot and grants its folders; starting the run is
 * the runner manager's (runner-manager.ts `dispatch`).
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
    const folderIds = request.input.folders ?? [];
    this.deps.folders.resolve(folderIds);
    const runId = randomUUID();
    this.accepting.add(taskId);
    // Fresh copies of attached files that changed at their source, recorded with the run.
    const batch = new ResourceBatch();
    try {
      // Read before the snapshot freezes, so the run sends its files as they are now.
      const input = await currentInput(new ResourceStore(ledger, ctx.paths), request.input, batch);
      const submitted = { ...request, input };
      const snapshot = freezeRunSnapshot(
        submitted,
        connections,
        catalog,
        previous,
        onBranch,
        internal,
      );
      const now = new Date().toISOString();
      // Granted before the run exists, so no dispatch can start it without its folders.
      await this.deps.folders.grant(taskId, folderIds);
      await ledger.change((data) => {
        batch.apply(data, now);
        assertAttached(data, input.files);
        let task = data.tasks.find((item) => item.id === taskId);
        // Deleted while its files were read: the run must not bring it back.
        if (!task && previous) throw new ConflictError('This conversation was deleted.');
        if (!task) {
          const tier = this.deps.newTaskTier();
          task = newTaskRecord({
            id: taskId,
            now,
            snapshot,
            tier,
            sideChatOf,
            internal,
            summaryTitles: this.deps.titles.enabled(),
          });
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
        // The previous run's suggestions leave with it, in the write that adds this run.
        delete task.nextSteps;
        task.updatedAt = now;
        data.operations[request.operationId] = { taskId, runId };
      });
    } catch (error) {
      await batch.discard();
      throw error;
    } finally {
      this.accepting.delete(taskId);
    }
    ctx.events.publish({
      taskId,
      runId,
      executionId: `root:${runId}`,
      type: 'run.status',
      data: { status: 'queued', error: '' },
    });
    ctx.nextSteps.cancel(taskId);
    if (!previous) this.deps.titles.start(taskId, ledger.run(taskId, runId));
    return { taskId, runId, duplicate: false };
  }
}
