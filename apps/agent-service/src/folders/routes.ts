import type { FastifyInstance } from 'fastify';
import {
  FolderRegisterRequestSchema,
  Identifier,
  parse,
  type FolderRegisterResponse,
  type TaskFoldersResponse,
} from '@atd/agent-contracts';
import { announceInvalidation } from '../invalidate.js';
import type { Ledger } from '../ledger.js';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import type { FolderStore } from './store.js';

/**
 * Folder routes. Registering takes absolute paths, so only the shell may call it, after the user
 * picked, dropped or sent the folders; the page only ever sees the refs it answers. The page lists
 * and revokes a task's grants; a revoke announces the task, whose session menu lists them.
 */
export function registerFolderRoutes(
  app: FastifyInstance,
  ctx: { ledger: Ledger; folders: FolderStore },
): void {
  app.post('/v1/folders/register', SHELL_ROUTE, async (request) => {
    const { paths } = parse(FolderRegisterRequestSchema, request.body);
    return (await ctx.folders.register(paths)) satisfies FolderRegisterResponse;
  });

  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/folders',
    RENDERER_ROUTE,
    async (request): Promise<TaskFoldersResponse> => {
      const taskId = parse(Identifier, request.params.taskId);
      ctx.ledger.task(taskId);
      return { folders: ctx.folders.list(taskId) };
    },
  );

  app.delete<{ Params: { taskId: string; folderId: string } }>(
    '/v1/tasks/:taskId/folders/:folderId',
    RENDERER_ROUTE,
    async (request): Promise<TaskFoldersResponse> => {
      const taskId = parse(Identifier, request.params.taskId);
      const folderId = parse(Identifier, request.params.folderId);
      ctx.ledger.task(taskId);
      const folders = await ctx.folders.revoke(taskId, folderId);
      announceInvalidation(request, { type: 'invalidate', scope: 'task', taskId });
      return { folders };
    },
  );
}
