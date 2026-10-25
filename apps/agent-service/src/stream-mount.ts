import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { registerInvalidation } from './invalidate.js';
import { SHELL_ROUTE } from './relay-routes.js';
import type { ServerDeps } from './server.js';
import { registerStoreInvalidation } from './store-invalidation.js';
import { StreamHub } from './stream.js';
import { TaskActivityProjection } from './task-activity/projection.js';
import { TaskStepBoard } from './task-activity/steps.js';
import { taskStatusCounts } from './task-status.js';

/** The service stream, its live projections and invalidation sources share the server lifetime. */
export function registerStream(app: FastifyInstance, deps: ServerDeps): void {
  const steps = new TaskStepBoard(deps.events);
  const activity = new TaskActivityProjection({
    board: deps.computer.activity,
    steps,
    ledger: deps.ledger,
    coordinator: deps.computer.coordinator,
    serviceId: deps.config.serviceId,
    epoch: deps.config.epoch,
  });
  app.addHook('onClose', async () => {
    activity.dispose();
    steps.dispose();
  });
  const hub = new StreamHub({
    systemProxy: deps.systemProxy,
    events: deps.events,
    capabilities: deps.capabilities,
    computer: deps.computer.coordinator,
    activity,
    snapshot: (taskId) => deps.manager.snapshot(taskId),
    summaries: () => deps.manager.summaries(),
    status: () => taskStatusCounts(deps.ledger.data),
    onStatusInputs: (listener) => deps.ledger.onChanged(listener),
    log: deps.log,
  });
  registerInvalidation(app, (frame) => hub.invalidate(frame));
  registerStoreInvalidation(app, deps.config.paths, (frame) => hub.invalidate(frame));

  // The shell's virtual-socket pipe forwards only allowed renderer frame types. HTTP relay
  // cannot upgrade a WebSocket, so the manifest must not expose this as a renderer route.
  app.get('/v1/stream', { websocket: true, ...SHELL_ROUTE }, (socket: WebSocket) => {
    hub.handle(socket);
  });
}
