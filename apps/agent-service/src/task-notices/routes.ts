import type { FastifyInstance } from 'fastify';
import { AckTaskNoticesRequestSchema, parse, type TaskNoticesResponse } from '@atd/agent-contracts';
import { invalidateOffRoute } from '../invalidate.js';
import { SHELL_ROUTE } from '../relay-routes.js';
import { TaskNoticeStore } from './store.js';
import { TaskNoticeWatcher, type TaskNoticeWatcherDeps } from './watcher.js';

/** What the task notices read from the service; `ServerDeps` provides all of it. */
export type TaskNoticeDeps = Pick<
  TaskNoticeWatcherDeps,
  'events' | 'ledger' | 'confirms' | 'manager' | 'log'
>;

/**
 * Starts watching tasks for notices and serves them to the shell, which posts the notifications:
 * like the automation notice routes, both are shell-only, so a page cannot read or acknowledge a
 * notice before the shell has handled it. Every queued notice tells stream clients to pull
 * (`taskNotices`); the watcher stops with the server, dropping its grace timers. Serving a list
 * also tells the store which `needs*` requests the shell may have shown, so the watcher can queue
 * a `resolved` notice when one of them ends elsewhere.
 */
export function registerTaskNotices(app: FastifyInstance, deps: TaskNoticeDeps): void {
  const store = new TaskNoticeStore(Date.now);
  const watcher = new TaskNoticeWatcher({
    ...deps,
    store,
    added: () => invalidateOffRoute(app, { type: 'invalidate', scope: 'taskNotices' }),
    now: Date.now,
  });
  watcher.listen();
  app.addHook('onClose', async () => watcher.close());

  app.get('/v1/task-notices', SHELL_ROUTE, async (): Promise<TaskNoticesResponse> => ({
    notices: store.list(),
  }));

  app.post('/v1/task-notices/ack', SHELL_ROUTE, async (request, reply) => {
    store.ack(parse(AckTaskNoticesRequestSchema, request.body).ids);
    return reply.code(204).send();
  });
}
