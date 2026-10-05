import websocketPlugin, { type WebSocket } from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  CapabilityReplyRequestSchema,
  ConfirmReplyRequestSchema,
  errorMessage,
  parse,
  PROTOCOL_VERSION,
  QueueMessageRequestSchema,
  STREAM_PROTOCOL,
  SubmitTaskRequestSchema,
  type ErrorCode,
} from '@atd/agent-contracts';
import { AuthError, authorize, hostAllowed, originAllowed } from './auth.js';
import { CapabilityGone, DesktopUnavailable } from './capabilities.js';
import type { CapabilityRegistry } from './capabilities.js';
import { CommandStore } from './commands/store.js';
import type { ServiceConfig } from './config.js';
import { ConfirmGone, type ConfirmStore } from './confirms.js';
import type { EventLog } from './event-log.js';
import { registerFileRoutes } from './file-routes.js';
import { registerFolderRoutes } from './folders/routes.js';
import type { FolderStore } from './folders/store.js';
import { announceInvalidation, registerInvalidation } from './invalidate.js';
import { Ledger, LedgerNotFound } from './ledger.js';
import type { Logger } from './logging.js';
import { registerManageRoutes } from './manage.js';
import { onMcpChanged } from './mcp/changes.js';
import { McpAuthority, registerMcpRoutes, type McpAuthorityDeps } from './mcp/index.js';
import { MemoryAuthority } from './memory/index.js';
import { ResourceStore } from './resources.js';
import { UpstreamError } from './errors.js';
import { ConflictError, DrainingError, type RunnerManager } from './runner-manager.js';
import { registerAtdAgentRoutes } from './atd-agents/mount.js';
import { registerBuiltinRoutes } from './builtins/mount.js';
import { registerPluginRoutes } from './plugins/routes.js';
import { registerRelayRoutes, RENDERER_ROUTE, SHELL_ROUTE } from './relay-routes.js';
import { registerSkillRoutes } from './skills/mount.js';
import type { SettingsStore } from './settings/store.js';
import { StreamHub } from './stream.js';
import { taskStatusCounts } from './task-status.js';

export interface ServerDeps {
  config: ServiceConfig;
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  resources: ResourceStore;
  manager: RunnerManager;
  settings: SettingsStore;
  folders: FolderStore;
  log: Logger;
  startedAt: string;
  onShutdown: () => void;
}

/**
 * Fastify HTTP + WS service. Fastify owns transport; this module owns DTOs,
 * auth, idempotency plumbing, live skills/MCP mounts and the relay route manifest.
 */
export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  // No automatic HEAD routes: the route manifest lists exactly the routes declared here.
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false, exposeHeadRoutes: false });
  await app.register(websocketPlugin, {
    options: {
      maxPayload: 1024 * 1024,
      // Clients offer `ai.v1` plus their credential; only `ai.v1` is ever selected and echoed.
      handleProtocols: (protocols) => (protocols.has(STREAM_PROTOCOL) ? STREAM_PROTOCOL : false),
    },
  });

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
  // Before any route: it classifies every route declared from here on.
  registerRelayRoutes(app, deps.config);

  app.addHook('preHandler', (request, _reply, done) => {
    try {
      authorize(request, deps.config.token);
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  // `close()` ends only the keep-alive connections idle at that moment. A request still in
  // flight would leave its connection open for the 72 s keep-alive timeout and hold the
  // shutdown, so every response sent once closing began ends its connection.
  let closing = false;
  app.addHook('preClose', async () => {
    closing = true;
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('x-service-id', deps.config.serviceId);
    reply.header('x-protocol-version', PROTOCOL_VERSION);
    if (closing) reply.header('connection', 'close');
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
    if (error instanceof ConflictError) return fail(reply, 409, error.code, error.message);
    if (error instanceof DrainingError) return fail(reply, 503, 'draining', error.message);
    if (error instanceof UpstreamError) return fail(reply, 502, 'upstream_failed', error.message);
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
    events: deps.events,
    capabilities: deps.capabilities,
    snapshot: (taskId) => deps.manager.snapshot(taskId),
    summaries: () => deps.manager.summaries(),
    status: () => taskStatusCounts(deps.ledger.data),
    onStatusInputs: (listener) => deps.ledger.onChanged(listener),
    log: deps.log,
  });
  registerInvalidation(app, (frame) => hub.invalidate(frame));
  // Runs change memory without a route write (tool calls, learners); announce those too.
  const stopMemoryWatch = MemoryAuthority.onChanged(deps.config.paths.agentDir, () =>
    hub.invalidate({ type: 'invalidate', scope: 'memory' }),
  );
  // The Agent's `command` tool writes the store without a route; the store announces every write.
  const stopCommandWatch = CommandStore.onChanged(deps.config.paths.root, () =>
    hub.invalidate({ type: 'invalidate', scope: 'commands' }),
  );
  // Likewise `configure_mcp` saves an MCP server, and a run connects one, without a route.
  const stopMcpWatch = onMcpChanged(deps.config.paths.root, () =>
    hub.invalidate({ type: 'invalidate', scope: 'extensions' }),
  );
  app.addHook('onClose', async () => {
    stopMemoryWatch();
    stopCommandWatch();
    stopMcpWatch();
  });

  app.get('/v1/status', RENDERER_ROUTE, async () => ({
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

  app.post('/v1/tasks', RENDERER_ROUTE, async (request) => {
    const body = parse(SubmitTaskRequestSchema, request.body);
    const accepted = await deps.manager.submit(body);
    // The message granted folders: the task's readable folders changed with it.
    if (body.input.folders?.length)
      announceInvalidation(request, { type: 'invalidate', scope: 'task', taskId: accepted.taskId });
    return accepted;
  });

  app.get<{ Params: { taskId: string } }>('/v1/tasks/:taskId', RENDERER_ROUTE, async (request) => ({
    task: deps.ledger.task(request.params.taskId),
  }));

  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/summary',
    RENDERER_ROUTE,
    async (request) => ({
      summary: deps.manager.summary(request.params.taskId),
      epoch: deps.events.epoch,
      seq: deps.events.currentSeq,
    }),
  );

  app.get<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/snapshot',
    RENDERER_ROUTE,
    async (request) => ({
      snapshot: await deps.manager.snapshot(request.params.taskId),
    }),
  );

  // childKey arrives URL-encoded and Fastify decodes it; only the task's `app-child` entries resolve it.
  app.get<{ Params: { taskId: string; childKey: string } }>(
    '/v1/tasks/:taskId/children/:childKey/transcript',
    RENDERER_ROUTE,
    async (request) => {
      const { taskId, childKey } = request.params;
      deps.ledger.task(taskId);
      if (!childKey || childKey.length > 512) throw new TypeError('Invalid child key.');
      const transcript = await deps.manager.runnerFor(taskId).childTranscript(childKey);
      if (!transcript) throw new LedgerNotFound('Child', childKey);
      return transcript;
    },
  );

  app.post<{ Params: { taskId: string; runId: string } }>(
    '/v1/tasks/:taskId/runs/:runId/cancel',
    RENDERER_ROUTE,
    async (request) => deps.manager.cancel(request.params.taskId, request.params.runId),
  );

  app.post('/v1/confirms', RENDERER_ROUTE, async (request) => {
    const body = parse(ConfirmReplyRequestSchema, request.body);
    const live = deps.confirms.pending().find((item) => item.id === body.requestId);
    if (!live) throw new ConfirmGone(body.requestId);
    const resolved = await deps.confirms.reply(body.requestId, body.revision, body.answer);
    return { request: live, resolved };
  });

  app.post('/v1/capabilities/result', SHELL_ROUTE, async (request) => {
    const body = parse(CapabilityReplyRequestSchema, request.body);
    await deps.capabilities.result(body.result);
    return { ok: true };
  });

  app.post<{ Params: { taskId: string } }>(
    '/v1/tasks/:taskId/queue',
    RENDERER_ROUTE,
    async (request) => {
      const body = parse(QueueMessageRequestSchema, request.body);
      await deps.manager.queue(request.params.taskId, body.text, body.mode);
      return { ok: true };
    },
  );

  app.post('/v1/resources', RENDERER_ROUTE, async (request) => {
    const query = request.query as { name?: unknown; mime?: unknown };
    const name = typeof query.name === 'string' && query.name ? query.name : 'upload.bin';
    const mime =
      typeof query.mime === 'string' && query.mime ? query.mime : 'application/octet-stream';
    if (!Buffer.isBuffer(request.body)) throw new TypeError('Invalid data: body must be bytes.');
    const resource = await deps.resources.save({ name, mime, bytes: new Uint8Array(request.body) });
    return { resource };
  });

  app.post('/v1/admin/shutdown', SHELL_ROUTE, async (_request, reply) => {
    void reply.send({ ok: true });
    setImmediate(() => deps.onShutdown());
  });

  // T6b additive: live management APIs (providers/commands/memory/tasks/resources).
  registerManageRoutes(app, {
    config: deps.config,
    ledger: deps.ledger,
    manager: deps.manager,
    settings: deps.settings,
    folders: deps.folders,
    log: deps.log,
    events: deps.events,
    mcp: () => McpAuthority.authorityFor(mcpAuthorityDeps(deps)),
  });

  registerSkillRoutes(app, deps.config);
  registerBuiltinRoutes(app, deps.config);
  registerAtdAgentRoutes(app, deps.config);
  registerFileRoutes(app, { resources: deps.resources, dataDir: deps.config.paths.root });
  registerFolderRoutes(app, { ledger: deps.ledger, folders: deps.folders });
  registerPluginRoutes(app, {
    dataDir: deps.config.paths.root,
    agentDir: deps.config.paths.agentDir,
    log: deps.log,
    mcp: () => McpAuthority.authorityFor(mcpAuthorityDeps(deps)),
  });

  // Live MCP mounts. Nothing at boot needs the authority (it reads the server records, launch
  // approvals and saved sign-ins), so the routes take a lazy resolver and it loads on first MCP
  // use (a route, a plugin toggle, or a run). `authorityFor` caches per dataDir, so all of those
  // share one load.
  registerMcpRoutes(app, () => McpAuthority.authorityFor(mcpAuthorityDeps(deps)));

  // Shell, never renderer: the relay's scheme handler cannot upgrade a WebSocket, so the WebView
  // reaches the stream only through the native virtual-socket pipe, and that pipe's upstream
  // frame-type whitelist (subscribe, ping) is what guards it. The manifest must not suggest that
  // the relay may forward it.
  app.get('/v1/stream', { websocket: true, ...SHELL_ROUTE }, (socket: WebSocket) => {
    hub.handle(socket);
  });

  return app;
}

/**
 * The MCP authority identity for this service profile. `authorityFor` caches on
 * dataDir alone, so the plugin and MCP route resolvers must describe the same
 * profile from one place or the first caller would silently win.
 */
function mcpAuthorityDeps(deps: ServerDeps): McpAuthorityDeps {
  return {
    serviceId: deps.config.serviceId,
    dataDir: deps.config.paths.root,
    cwd: deps.config.paths.root,
    events: deps.events,
    confirms: deps.confirms,
    resources: deps.resources,
    log: deps.log,
  };
}

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}
