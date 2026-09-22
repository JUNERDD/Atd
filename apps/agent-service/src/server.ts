import websocketPlugin, { type WebSocket } from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  CapabilityReplyRequestSchema,
  ConfirmReplyRequestSchema,
  errorMessage,
  parse,
  PROTOCOL_VERSION,
  QueueMessageRequestSchema,
  SubmitTaskRequestSchema,
  type ErrorCode,
  type FutureOwner,
} from '@ai/agent-contracts';
import { AuthError, bearerMatches, hostAllowed, originAllowed } from './auth.js';
import { CapabilityGone, DesktopUnavailable } from './capabilities.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { ServiceConfig } from './config.js';
import { ConfirmGone, type ConfirmStore } from './confirms.js';
import type { EventLog } from './event-log.js';
import { Ledger, LedgerNotFound } from './ledger.js';
import type { Logger } from './logging.js';
import { registerManageRoutes } from './manage.js';
import { McpAdapterMissing, McpAuthority, registerMcpRoutes } from './mcp/index.js';
import { registerMigrationRoutes } from './migration/routes.js';
import { ResourceStore } from './resources.js';
import { ConflictError, DrainingError, type RunnerManager } from './runner-manager.js';
import { registerSkillRoutes } from './skills/mount.js';
import { StreamHub } from './stream.js';

export interface ServerDeps {
  config: ServiceConfig;
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  resources: ResourceStore;
  manager: RunnerManager;
  log: Logger;
  startedAt: string;
  onShutdown: () => void;
}

/** Future routes answer 501 with the owning todo; never a fake success. */
const PLACEHOLDERS: { prefix: string; owner: FutureOwner }[] = [
  { prefix: '/v1/subagents', owner: 'T5' },
];

/**
 * Fastify HTTP + WS service. Fastify owns transport; this module owns DTOs,
 * auth, idempotency plumbing, live skills/MCP mounts and placeholders.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false });
  await app.register(websocketPlugin, { options: { maxPayload: 1024 * 1024 } });

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.addHook('onRequest', (request, _reply, done) => {
    if (!hostAllowed(request.headers.host, deps.config.host)) {
      done(new AuthError(403, 'Host not allowed.'));
      return;
    }
    if (!originAllowed(request.headers.origin)) {
      done(new AuthError(403, 'Origin not allowed.'));
      return;
    }
    done();
  });

  app.addHook('preHandler', (request, _reply, done) => {
    if (!bearerMatches(request.headers.authorization, deps.config.token)) {
      done(new AuthError(401, 'Valid bearer authorization is required.'));
      return;
    }
    done();
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('x-service-id', deps.config.serviceId);
    reply.header('x-protocol-version', PROTOCOL_VERSION);
    done(null, payload);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError)
      return fail(
        reply,
        error.status,
        error.status === 401 ? 'unauthorized' : 'forbidden',
        error.message,
      );
    if (error instanceof LedgerNotFound) return fail(reply, 404, 'not_found', error.message);
    if (error instanceof ConfirmGone || error instanceof CapabilityGone)
      return fail(reply, 410, 'gone', error.message);
    if (error instanceof ConflictError) return fail(reply, 409, 'conflict', error.message);
    if (error instanceof DrainingError) return fail(reply, 503, 'draining', error.message);
    if (error instanceof DesktopUnavailable)
      return fail(reply, 503, 'desktop_unavailable', error.message);
    if (error instanceof TypeError) return fail(reply, 400, 'bad_request', error.message);
    const code = (error as { code?: string }).code;
    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE')
      return fail(reply, 413, 'payload_too_large', 'The request body is too large.');
    if (code?.startsWith('FST_ERR_CTP_'))
      return fail(reply, 400, 'bad_request', 'The request body could not be parsed.');
    deps.log.warn('Request failed.', { error: errorMessage(error) });
    return fail(reply, 500, 'internal', 'The request could not be completed.');
  });

  app.setNotFoundHandler((_request, reply) => {
    fail(reply, 404, 'not_found', 'Unknown route.');
  });

  const hub = new StreamHub({
    ledger: deps.ledger,
    events: deps.events,
    capabilities: deps.capabilities,
    snapshot: (taskId) => deps.manager.snapshot(taskId),
    log: deps.log,
  });

  app.get('/v1/status', async () => ({
    service: {
      serviceId: deps.config.serviceId,
      service: 'agent-service',
      protocolVersion: PROTOCOL_VERSION,
      epoch: deps.config.epoch,
      startedAt: deps.startedAt,
      endpoint: {
        host: deps.config.host,
        port: deps.config.port,
        url: `http://${deps.config.host}:${deps.config.port}`,
      },
    },
    draining: deps.manager.isDraining(),
    activeRuns: deps.manager.activeRunCount(),
    pendingConfirms: deps.confirms.pending().length,
    pendingCapabilities: deps.capabilities.pending().length,
  }));

  app.post('/v1/tasks', async (request) =>
    deps.manager.submit(parse(SubmitTaskRequestSchema, request.body)),
  );

  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId', async (request) => ({
    task: deps.ledger.task(request.params.taskId),
  }));

  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId/snapshot', async (request) => ({
    snapshot: await deps.manager.snapshot(request.params.taskId),
  }));

  app.post<{ Params: { taskId: string; runId: string } }>(
    '/v1/tasks/:taskId/runs/:runId/cancel',
    async (request) => ({
      task: await deps.manager.cancel(request.params.taskId, request.params.runId),
    }),
  );

  app.post('/v1/confirms', async (request) => {
    const body = parse(ConfirmReplyRequestSchema, request.body);
    const live = deps.confirms.pending().find((item) => item.id === body.requestId);
    if (!live) throw new ConfirmGone(body.requestId);
    const resolved = await deps.confirms.reply(body.requestId, body.revision, body.answer);
    return { request: live, resolved };
  });

  app.post('/v1/capabilities/result', async (request) => {
    const body = parse(CapabilityReplyRequestSchema, request.body);
    await deps.capabilities.result(body.result);
    return { ok: true };
  });

  app.post<{ Params: { taskId: string } }>('/v1/tasks/:taskId/queue', async (request) => {
    const body = parse(QueueMessageRequestSchema, request.body);
    await deps.manager.queue(request.params.taskId, body.text, body.mode);
    return { ok: true };
  });

  app.post('/v1/resources', async (request) => {
    const query = request.query as { name?: unknown; mime?: unknown };
    const name = typeof query.name === 'string' && query.name ? query.name : 'upload.bin';
    const mime =
      typeof query.mime === 'string' && query.mime ? query.mime : 'application/octet-stream';
    if (!Buffer.isBuffer(request.body)) throw new TypeError('Invalid data: body must be bytes.');
    const resource = await deps.resources.save({ name, mime, bytes: new Uint8Array(request.body) });
    return { resource };
  });

  app.post('/v1/admin/shutdown', async (_request, reply) => {
    void reply.send({ ok: true });
    setImmediate(() => deps.onShutdown());
  });

  // T2 additive: authenticated credential-upload + status channel for migration.
  registerMigrationRoutes(app, deps.config);
  // T6b additive: live management APIs (providers/commands/memory/tasks/resources).
  registerManageRoutes(app, {
    config: deps.config,
    ledger: deps.ledger,
    manager: deps.manager,
    log: deps.log,
  });

  registerSkillRoutes(app, deps.config);

  // Live MCP mounts. McpAdapterMissing degrades explicitly: MCP routes
  // answer 503 (never 501-future nor silent success) and runs continue
  // without MCP tools; skills stay live. No silent degradation anywhere.
  try {
    const mcpAuthority = await McpAuthority.authorityFor({
      serviceId: deps.config.serviceId,
      dataDir: deps.config.paths.root,
      agentDir: deps.config.paths.agentDir,
      sessionsDir: deps.config.paths.sessionsDir,
      cwd: deps.config.paths.root,
      events: deps.events,
      confirms: deps.confirms,
      resources: deps.resources,
      log: deps.log,
    });
    registerMcpRoutes(app, { authority: mcpAuthority });
  } catch (error) {
    if (!(error instanceof McpAdapterMissing)) throw error;
    deps.log.warn('MCP degraded: adapter is unavailable.', {
      error: errorMessage(error),
    });
    const degraded = async (_request: FastifyRequest, reply: FastifyReply) =>
      fail(
        reply,
        503,
        'internal',
        'MCP is unavailable: pi-mcp-adapter 2.34.0 could not be loaded.',
      );
    app.all('/v1/mcp', degraded);
    app.all('/v1/mcp/*', degraded);
  }

  for (const placeholder of PLACEHOLDERS) {
    const handler = async (_request: FastifyRequest, reply: FastifyReply) =>
      fail(
        reply,
        501,
        'not_implemented',
        `${placeholder.prefix} is not implemented yet.`,
        placeholder.owner,
      );
    app.all(placeholder.prefix, handler);
    app.all(`${placeholder.prefix}/*`, handler);
  }

  app.get('/v1/stream', { websocket: true }, (socket: WebSocket) => {
    hub.handle(socket);
  });

  return app;
}

function fail(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  owner?: FutureOwner,
): FastifyReply {
  return reply.status(status).send({ error: { code, message, ...(owner ? { owner } : {}) } });
}
