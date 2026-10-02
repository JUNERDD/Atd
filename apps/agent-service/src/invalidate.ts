import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { InvalidateFrame, InvalidateScope } from '@atd/agent-contracts';

/**
 * Successful writes that change shared data, by route prefix. Staging routes, tool and resource
 * calls, and task routes whose changes already travel as task events are absent on purpose.
 * Commands are absent too: the command store announces every write itself (see server.ts).
 */
const PREFIX_SCOPES: ReadonlyArray<readonly [string, InvalidateScope]> = [
  ['/v1/settings', 'settings'],
  ['/v1/providers', 'providers'],
  ['/v1/skills', 'extensions'],
  ['/v1/roles', 'extensions'],
  ['/v1/agents', 'extensions'],
  ['/v1/builtins', 'extensions'],
  ['/v1/mcp/servers', 'extensions'],
  ['/v1/mcp/connect', 'extensions'],
  ['/v1/mcp/disconnect', 'extensions'],
  ['/v1/mcp/reconnect', 'extensions'],
  ['/v1/mcp/revoke', 'extensions'],
  ['/v1/mcp/auth/complete', 'extensions'],
  ['/v1/mcp/refresh', 'extensions'],
  ['/v1/mcp/logout', 'extensions'],
  // The shell's launch approval: the panel's approval banner and the Extensions rows show it.
  ['/v1/admin/approvals/mcp', 'extensions'],
  ['/v1/memory', 'memory'],
  ['/v1/plugins', 'extensions'],
];

/**
 * Writes that change nobody else's view: next-run staging a client makes for itself, and plugin
 * previews, which only fetch a bundle into short-lived staging.
 */
const PRIVATE_WRITES = new Set([
  '/v1/skills/stage',
  '/v1/plugins/preview',
  '/v1/plugins/:id/update/preview',
]);

/** The plugin item switch that can be the memory pause (plugins/toggle.ts). */
const PLUGIN_SWITCHES = new Set(['/v1/plugins/:id/items/:kind/:name/enabled']);

/** Frames handlers named for their request (`announceInvalidation`). */
const announced = new WeakMap<FastifyRequest, InvalidateFrame[]>();

/**
 * Names a frame the route alone cannot tell, such as the id of a task a write created; it is
 * sent with the route's own frames once the write succeeds.
 */
export function announceInvalidation(request: FastifyRequest, frame: InvalidateFrame): void {
  announced.set(request, [...(announced.get(request) ?? []), frame]);
}

function framesFor(request: FastifyRequest): InvalidateFrame[] {
  return [...routeFrames(request), ...(announced.get(request) ?? [])];
}

function routeFrames(request: FastifyRequest): InvalidateFrame[] {
  const route = request.routeOptions.url ?? '';
  if (PRIVATE_WRITES.has(route)) return [];
  if (route === '/v1/tasks/:taskId') {
    const { taskId } = request.params as { taskId: string };
    if (request.method === 'PATCH') return [{ type: 'invalidate', scope: 'task', taskId }];
    if (request.method === 'DELETE') return [{ type: 'invalidate', scope: 'task.deleted', taskId }];
    return [];
  }
  const match = PREFIX_SCOPES.find(
    ([prefix]) => route === prefix || route.startsWith(`${prefix}/`),
  );
  if (!match) return [];
  const frames: InvalidateFrame[] = [{ type: 'invalidate', scope: match[1] }];
  // Personal's memory switch is the memory pause, which the Memory section also shows.
  const { kind } = request.params as { kind?: string };
  if (PLUGIN_SWITCHES.has(route) && kind === 'memory')
    frames.push({ type: 'invalidate', scope: 'memory' });
  return frames;
}

/**
 * Tells every stream client which shared data changed after a successful write, whichever client
 * made it. One hook covers every route, so a new write route only needs a prefix entry above, or
 * an announcement when the frame depends on what the write created.
 */
export function registerInvalidation(
  app: FastifyInstance,
  notify: (frame: InvalidateFrame) => void,
): void {
  app.addHook('onResponse', (request, reply, done) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && reply.statusCode < 400)
      for (const frame of framesFor(request)) notify(frame);
    done();
  });
}
