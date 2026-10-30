import type { FastifyInstance } from 'fastify';
import { withInferencePurpose } from '../providers/chatgpt-usage.js';
import {
  CompactTaskRequestSchema,
  type ContextBreakdownResponse,
  ForkTaskRequestSchema,
  Identifier,
  isActiveStatus,
  parse,
  PatchTaskRequestSchema,
  ReplaceQueueRequestSchema,
  TaskSearchQuerySchema,
  type TaskSearchResponse,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import type { FolderStore } from '../folders/store.js';
import { announceInvalidation } from '../invalidate.js';
import type { Ledger } from '../ledger.js';
import type { RunnerManager } from '../runner-manager.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import { releaseTaskResources } from '../resources/gc.js';
import type { ServicePaths } from '../storage.js';
import { forkTask } from './fork.js';

export interface TaskManageContext {
  ledger: Ledger;
  manager: RunnerManager;
  paths: ServicePaths;
  folders: FolderStore;
}

/**
 * Live task management routes (T6b). PATCH renames, retiers and/or pins (tier
 * changes refuse while a run is live: D8 no-hot-swap; the tier is part of
 * the run binding, so the next run reopens the session with it). DELETE
 * refuses while any run is active and otherwise removes the task, its
 * idempotency entries, its orphaned pending requests and its folder grants, and
 * hands the resources no other conversation sends to the sweep, which removes them
 * after its grace period (resources/gc.ts); session files,
 * transcripts and audit logs stay on disk for forensics. POST compact starts
 * a manual compaction of an idle task (RunnerManager.compact) and answers once
 * it is accepted; the task's compaction block and context updates follow it.
 * GET context splits the task's context usage by category, computed on request
 * from its live or stored session (compaction/context-breakdown.ts). POST fork
 * copies a task up to a turn into a new task (fork.ts) and announces the new
 * task to every client. GET search finds tasks by what was said in them (search.ts); its static
 * path wins over `/v1/tasks/:taskId`, since Fastify matches static segments before parameters.
 */
export function registerTaskManageRoutes(app: FastifyInstance, ctx: TaskManageContext): void {
  app.patch<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId',
    RENDERER_ROUTE,
    async (request) => {
      const taskId = parse(Identifier, request.params.taskId);
      const body = parse(PatchTaskRequestSchema, request.body);
      if (
        body.title === undefined &&
        body.permissionTier === undefined &&
        body.pinned === undefined
      )
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
        if (body.pinned === true) item.pinned = true;
        if (body.pinned === false) delete item.pinned;
        if (title === undefined && body.permissionTier === undefined) return;
        if (title !== undefined) {
          item.title = title.slice(0, 120);
          delete item.titleGeneration;
        }
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
        const removed = data.tasks.find((entry) => entry.id === taskId);
        data.tasks = data.tasks.filter((entry) => entry.id !== taskId);
        // A fork's copied runs keep their operation ids, whose entries name the source task.
        for (const operationId of operationIds)
          if (data.operations[operationId]?.taskId === taskId) delete data.operations[operationId];
        data.pendingConfirms = data.pendingConfirms.filter((item) => item.taskId !== taskId);
        data.pendingCapabilities = data.pendingCapabilities.filter(
          (item) => item.taskId !== taskId,
        );
        // The sweep removes its attachments once no draft can still send them (resources/gc.ts).
        if (removed) releaseTaskResources(data, removed, new Date().toISOString());
      });
      await ctx.manager.remove(taskId);
      await ctx.folders.forget(taskId);
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
      await withInferencePurpose(false, () =>
        ctx.manager.compact(taskId, body.instructions?.trim() || undefined),
      );
      return { ok: true as const };
    },
  );

  app.get('/v1/tasks/search', RENDERER_ROUTE, async (request): Promise<TaskSearchResponse> => {
    return ctx.manager.search(parse(TaskSearchQuerySchema, searchQuery(request.query)));
  });

  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/context',
    RENDERER_ROUTE,
    async (request): Promise<ContextBreakdownResponse> => {
      const taskId = parse(Identifier, request.params.taskId);
      return { breakdown: await ctx.manager.contextBreakdown(taskId) };
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
      const queue = await ctx.manager.runnerFor(taskId).pending.replace(body.followUp);
      return { queue };
    },
  );
}

/**
 * The search query string as TaskSearchQuerySchema reads it: query values arrive as strings, so a
 * plain decimal `limit` becomes a number, and anything else is left for validation to refuse.
 */
function searchQuery(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const query: Record<string, unknown> = { ...raw };
  if (typeof query.limit === 'string' && /^[0-9]{1,3}$/.test(query.limit))
    query.limit = Number(query.limit);
  return query;
}
