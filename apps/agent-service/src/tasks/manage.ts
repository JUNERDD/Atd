import type { FastifyInstance } from 'fastify';
import {
  CompactTaskRequestSchema,
  ForkTaskRequestSchema,
  Identifier,
  isActiveStatus,
  parse,
  PatchTaskRequestSchema,
  ReplaceQueueRequestSchema,
} from '@ai/agent-contracts';
import { ConflictError } from '../errors.js';
import { announceInvalidation } from '../invalidate.js';
import type { Ledger } from '../ledger.js';
import type { RunnerManager } from '../runner-manager.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import type { ServicePaths } from '../storage.js';
import { forkTask } from './fork.js';

export interface TaskManageContext {
  ledger: Ledger;
  manager: RunnerManager;
  paths: ServicePaths;
}

/**
 * Live task management routes (T6b). PATCH renames and/or retiers (tier
 * changes refuse while a run is live: D8 no-hot-swap; the tier is part of
 * the run binding, so the next run reopens the session with it). DELETE
 * refuses while any run is active and otherwise removes the task, its
 * idempotency entries and its orphaned pending requests; session files,
 * transcripts and audit logs stay on disk for forensics. POST compact starts
 * a manual compaction of an idle task (RunnerManager.compact) and answers once
 * it is accepted; the task's compaction block and context updates follow it.
 * POST fork copies a task up to a turn into a new task (fork.ts) and announces
 * the new task to every client.
 */
export function registerTaskManageRoutes(app: FastifyInstance, ctx: TaskManageContext): void {
  app.patch<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const body = parse(PatchTaskRequestSchema, request.body);
      if (body.title === undefined && body.permissionTier === undefined)
        throw new TypeError('Invalid data: nothing to update.');
      const task = ctx.ledger.task(taskId);
      const title = body.title?.trim();
      if (body.title !== undefined && !title) throw new TypeError('Invalid data: title is empty.');
      const tierChanging =
        body.permissionTier !== undefined && body.permissionTier !== task.permissionTier;
      if (
        tierChanging &&
        task.runs.some((run) => run.status !== 'queued' && isActiveStatus(run.status))
      )
        throw new ConflictError('Finish the active run before changing the permission tier.');
      await ctx.ledger.change((data) => {
        const item = data.tasks.find((entry) => entry.id === taskId);
        if (!item) return;
        if (title !== undefined) item.title = title.slice(0, 120);
        if (body.permissionTier !== undefined) item.permissionTier = body.permissionTier;
        item.updatedAt = new Date().toISOString();
      });
      return { task: ctx.ledger.task(taskId) };
    },
  );

  app.delete<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const task = ctx.ledger.task(taskId);
      if (task.runs.some((run) => isActiveStatus(run.status)))
        throw new ConflictError('Finish the active run before deleting this task.');
      const operationIds = new Set(task.runs.map((run) => run.operationId));
      await ctx.ledger.change((data) => {
        data.tasks = data.tasks.filter((entry) => entry.id !== taskId);
        // A fork's copied runs keep their operation ids, whose entries name the source task.
        for (const operationId of operationIds)
          if (data.operations[operationId]?.taskId === taskId) delete data.operations[operationId];
        data.pendingConfirms = data.pendingConfirms.filter((item) => item.taskId !== taskId);
        data.pendingCapabilities = data.pendingCapabilities.filter(
          (item) => item.taskId !== taskId,
        );
      });
      await ctx.manager.remove(taskId);
      return { deleted: true as const, taskId };
    },
  );

  app.post<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/compact',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const body = parse(CompactTaskRequestSchema, request.body ?? {});
      ctx.ledger.task(taskId);
      await ctx.manager.compact(taskId, body.instructions?.trim() || undefined);
      return { ok: true as const };
    },
  );

  app.post<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/fork',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const body = parse(ForkTaskRequestSchema, request.body);
      const forked = await forkTask(ctx, taskId, body);
      announceInvalidation(request, { type: 'invalidate', scope: 'task', taskId: forked.taskId });
      return forked;
    },
  );

  app.post<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/queue/replace',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const body = parse(ReplaceQueueRequestSchema, request.body);
      const task = ctx.ledger.task(taskId);
      if (!task.runs.some((run) => isActiveStatus(run.status)))
        throw new Error('The task has no active run.');
      const queue = await ctx.manager.runnerFor(taskId).replaceQueue(body.followUp);
      return { queue };
    },
  );
}
