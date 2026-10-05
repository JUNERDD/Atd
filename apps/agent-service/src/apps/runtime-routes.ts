import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Compile } from 'typebox/compile';
import {
  AppApiNameSchema,
  APP_STREAM_CONTENT_TYPE,
  MAX_IPC_MESSAGE_BYTES,
  parse,
  PostAppDiagnosticsRequestSchema,
  WidgetInstancesRequestSchema,
  type AppStreamLine,
} from '@atd/agent-contracts';
import { SHELL_ROUTE } from '../relay-routes.js';
import { AppFailure, appNotFound, appRoute, toAppError } from './errors.js';
import type { AppService } from './service.js';
import { isAppId } from './store.js';

const ApiName = Compile(AppApiNameSchema);
/** SSE comment interval that keeps idle event streams open through proxies and the shell. */
const HEARTBEAT_MS = 25_000;

type ApiRequest = FastifyRequest<{ Params: { appId: string; name: string } }>;
export type AppRequest = FastifyRequest<{ Params: { appId: string } }>;

/** The app id of a route, or `app_not_found` for anything that cannot be one. */
export function appIdOf(request: AppRequest): string {
  const { appId } = request.params;
  if (!isAppId(appId)) throw appNotFound(appId.slice(0, 64));
  return appId;
}

/** An abort signal that fires when the client goes away before the response finished. */
function clientGone(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

/**
 * The shell's app routes: the runtime an app window loads, its `/api` calls (JSON, or an NDJSON
 * stream when the request accepts `application/x-ndjson`), its backend's event stream (SSE), the
 * page's errors, and the widget instances and snapshots. A client that goes away cancels its
 * call in the backend. Answers the set of stream closers the server runs on close.
 */
export function registerAppRuntimeRoutes(
  app: FastifyInstance,
  service: () => Promise<AppService>,
): Set<() => void> {
  const streams = new Set<() => void>();

  app.get(
    '/v1/apps/:appId/runtime',
    SHELL_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) =>
      (await service()).runtime(appIdOf(request)),
    ),
  );

  app.post(
    '/v1/apps/:appId/api/:name',
    { ...SHELL_ROUTE, bodyLimit: MAX_IPC_MESSAGE_BYTES },
    appRoute(async (request: ApiRequest, reply: FastifyReply) => {
      const apps = await service();
      const appId = appIdOf(request);
      const { name } = request.params;
      if (!ApiName.Check(name)) throw new AppFailure(400, 'bad_request', 'Invalid api name.');
      const input: unknown = request.body ?? null;
      const signal = clientGone(reply);
      const stream = (request.headers.accept ?? '').includes(APP_STREAM_CONTENT_TYPE);
      // Started first, so a backend that cannot start answers with an HTTP error.
      await apps.backends.ensure(appId);
      if (!stream) {
        const value = await apps.backends.call(appId, name, input, { signal });
        return reply.header('content-type', 'application/json').send(JSON.stringify(value ?? null));
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': `${APP_STREAM_CONTENT_TYPE}; charset=utf-8`,
        'cache-control': 'no-cache',
      });
      const write = (line: AppStreamLine) => {
        if (!reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(line)}\n`);
      };
      try {
        const value = await apps.backends.call(appId, name, input, {
          signal,
          onChunk: (data) => write({ type: 'chunk', data }),
        });
        write({ type: 'result', value: value ?? null });
      } catch (error) {
        write({ type: 'error', error: toAppError(error) });
      } finally {
        reply.raw.end();
      }
      return reply;
    }),
  );

  app.get(
    '/v1/apps/:appId/events',
    SHELL_ROUTE,
    appRoute(async (request: AppRequest, reply: FastifyReply) => {
      const apps = await service();
      const appId = appIdOf(request);
      apps.store.get(appId);
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      reply.raw.write(': connected\n\n');
      const unsubscribe = apps.backends.subscribe(appId, (channel, data) => {
        reply.raw.write(`data: ${JSON.stringify({ channel, data })}\n\n`);
      });
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);
      const end = () => {
        clearInterval(heartbeat);
        unsubscribe();
        streams.delete(end);
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      streams.add(end);
      reply.raw.once('close', end);
      return reply;
    }),
  );

  app.post(
    '/v1/apps/:appId/diagnostics',
    SHELL_ROUTE,
    appRoute(async (request: AppRequest, reply: FastifyReply) => {
      const apps = await service();
      const appId = appIdOf(request);
      apps.store.get(appId);
      const body = parse(PostAppDiagnosticsRequestSchema, request.body);
      await apps.diagnostics.append(
        appId,
        body.entries.map((entry) => ({
          at: entry.at,
          source: 'frontend',
          level: entry.kind === 'console' ? 'warning' : 'error',
          version: entry.version,
          message: entry.message,
          ...(entry.stack ? { detail: entry.stack } : {}),
        })),
      );
      return reply.status(204).send();
    }),
  );

  app.post('/v1/widgets/instances', SHELL_ROUTE, async (request, reply) => {
    const body = parse(WidgetInstancesRequestSchema, request.body);
    await (await service()).widgets.setInstances(body.instances);
    return reply.status(204).send();
  });

  app.get('/v1/widgets/snapshots', SHELL_ROUTE, async () => (await service()).widgets.sync());

  return streams;
}
