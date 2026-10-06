import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AckAutomationNoticesRequestSchema,
  AUTOMATION_RUN_HISTORY,
  AutomationDraftSchema,
  AutomationSettingsSchema,
  Identifier,
  MarkAutomationRunsReadRequestSchema,
  parse,
  PreviewAutomationTriggerRequestSchema,
  SetAutomationEnabledRequestSchema,
  UpdateAutomationRequestSchema,
  type AutomationListResponse,
  type AutomationNoticesResponse,
  type AutomationRunsResponse,
  type AutomationSettings,
  type PreviewAutomationTriggerResponse,
  type RunAutomationResponse,
} from '@atd/agent-contracts';
import { invalidateOffRoute } from '../invalidate.js';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import {
  ackNotices,
  createAutomation,
  deleteAutomation,
  markRunsRead,
  setAutomationEnabled,
  setPaused,
  updateAutomation,
} from './edits.js';
import type { AutomationService } from './service.js';

export type { AutomationService } from './service.js';

type WithId = FastifyRequest<{ Params: { id: string } }>;

function idOf(request: WithId): string {
  return parse(Identifier, request.params.id);
}

/** `?limit=`: a whole number from 1 to the history bound; absent lists every kept run. */
function limitOf(query: unknown): number {
  const raw = (query as { limit?: unknown } | undefined)?.limit;
  if (raw === undefined) return AUTOMATION_RUN_HISTORY;
  const limit = typeof raw === 'string' && /^[0-9]{1,3}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!(limit >= 1 && limit <= AUTOMATION_RUN_HISTORY))
    throw new TypeError(`Invalid data: limit must be 1 to ${AUTOMATION_RUN_HISTORY}.`);
  return limit;
}

/**
 * The automation routes (decision record §3). Every write goes through edits.ts, the same path the
 * `automation` tool takes; the notice routes are the shell's, which posts the notifications. The
 * service announces every change itself (routes, tool and engine alike), so these routes have no
 * prefix in invalidate.ts and the frame is sent once, coalesced.
 */
export function registerAutomationRoutes(app: FastifyInstance, service: AutomationService): void {
  const stop = service.onChanged(() =>
    invalidateOffRoute(app, { type: 'invalidate', scope: 'automations' }),
  );
  app.addHook('onClose', async () => stop());

  app.get('/v1/automations', RENDERER_ROUTE, async (): Promise<AutomationListResponse> =>
    service.list(),
  );

  app.post('/v1/automations', RENDERER_ROUTE, async (request, reply) => {
    const draft = parse(AutomationDraftSchema, request.body);
    const automation = await createAutomation(service.edits(), draft, 'user');
    return reply.code(201).send(await service.item(automation.id));
  });

  app.post(
    '/v1/automations/preview',
    RENDERER_ROUTE,
    async (request): Promise<PreviewAutomationTriggerResponse> =>
      service.preview(parse(PreviewAutomationTriggerRequestSchema, request.body)),
  );

  app.get('/v1/automations/:id', RENDERER_ROUTE, async (request: WithId) =>
    service.item(idOf(request)),
  );

  app.put('/v1/automations/:id', RENDERER_ROUTE, async (request: WithId) => {
    const body = parse(UpdateAutomationRequestSchema, request.body);
    const automation = await updateAutomation(service.edits(), idOf(request), body);
    return service.item(automation.id);
  });

  app.patch('/v1/automations/:id', RENDERER_ROUTE, async (request: WithId) => {
    const body = parse(SetAutomationEnabledRequestSchema, request.body);
    const automation = await setAutomationEnabled(service.edits(), idOf(request), body);
    return service.item(automation.id);
  });

  app.delete('/v1/automations/:id', RENDERER_ROUTE, async (request: WithId, reply) => {
    await deleteAutomation(service.edits(), idOf(request), (taskId, runId) =>
      service.cancel(taskId, runId),
    );
    return reply.code(204).send();
  });

  app.post(
    '/v1/automations/:id/run',
    RENDERER_ROUTE,
    async (request: WithId): Promise<RunAutomationResponse> => ({
      run: await service.engine.runNow(idOf(request)),
    }),
  );

  app.get(
    '/v1/automations/:id/runs',
    RENDERER_ROUTE,
    async (request: WithId): Promise<AutomationRunsResponse> => ({
      runs: service.runs(idOf(request), limitOf(request.query)),
    }),
  );

  app.post('/v1/automation-runs/read', RENDERER_ROUTE, async (request, reply) => {
    await markRunsRead(service.edits(), parse(MarkAutomationRunsReadRequestSchema, request.body));
    return reply.code(204).send();
  });

  app.patch(
    '/v1/automation-settings',
    RENDERER_ROUTE,
    async (request): Promise<AutomationSettings> => {
      const { paused } = parse(AutomationSettingsSchema, request.body);
      await setPaused(service.edits(), paused);
      return { paused };
    },
  );

  app.get('/v1/automation-notices', SHELL_ROUTE, async (): Promise<AutomationNoticesResponse> => ({
    notices: service.notices(),
  }));

  app.post('/v1/automation-notices/ack', SHELL_ROUTE, async (request, reply) => {
    const { ids } = parse(AckAutomationNoticesRequestSchema, request.body);
    await ackNotices(service.edits(), ids);
    return reply.code(204).send();
  });
}
