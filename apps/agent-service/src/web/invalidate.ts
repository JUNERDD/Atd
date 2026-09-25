import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { InvalidateFrame, InvalidateScope } from '@ai/agent-contracts';

/**
 * Successful writes that change shared data, by route prefix. Staging routes, tool and resource
 * calls, and task routes whose changes already travel as task events are absent on purpose.
 */
const PREFIX_SCOPES: ReadonlyArray<readonly [string, InvalidateScope]> = [
  ['/v1/settings', 'settings'],
  ['/v1/commands', 'commands'],
  ['/v1/providers', 'providers'],
  ['/v1/skills', 'extensions'],
  ['/v1/roles', 'extensions'],
  ['/v1/agents', 'extensions'],
  ['/v1/builtins', 'extensions'],
  ['/v1/mcp/configure', 'extensions'],
  ['/v1/mcp/connect', 'extensions'],
  ['/v1/mcp/disconnect', 'extensions'],
  ['/v1/mcp/reconnect', 'extensions'],
  ['/v1/mcp/revoke', 'extensions'],
  ['/v1/mcp/auth/complete', 'extensions'],
  ['/v1/mcp/refresh', 'extensions'],
  ['/v1/mcp/logout', 'extensions'],
  ['/v1/memory', 'memory'],
];

/** Staging writes a client makes for its own next run; nobody else's view changes. */
const PRIVATE_WRITES = new Set(['/v1/skills/stage']);

function frameFor(request: FastifyRequest): InvalidateFrame | null {
  const route = request.routeOptions.url ?? '';
  if (PRIVATE_WRITES.has(route)) return null;
  if (route === '/v1/tasks/:taskId') {
    const { taskId } = request.params as { taskId: string };
    if (request.method === 'PATCH') return { type: 'invalidate', scope: 'task', taskId };
    if (request.method === 'DELETE') return { type: 'invalidate', scope: 'task.deleted', taskId };
    return null;
  }
  const match = PREFIX_SCOPES.find(
    ([prefix]) => route === prefix || route.startsWith(`${prefix}/`),
  );
  return match ? { type: 'invalidate', scope: match[1] } : null;
}

/**
 * Tells every stream client which shared data changed after a successful write, whichever client
 * made it. One hook covers every route, so a new write route only needs a prefix entry above.
 */
export function registerInvalidation(
  app: FastifyInstance,
  notify: (frame: InvalidateFrame) => void,
): void {
  app.addHook('onResponse', (request, reply, done) => {
    if (request.method !== 'GET' && request.method !== 'HEAD' && reply.statusCode < 400) {
      const frame = frameFor(request);
      if (frame) notify(frame);
    }
    done();
  });
}
