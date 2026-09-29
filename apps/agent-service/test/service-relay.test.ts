import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Type } from 'typebox';
import {
  ErrorEnvelopeSchema,
  Identifier,
  parse,
  RELAY_EPOCH_CURRENT_HEADER,
  RouteManifestResponseSchema,
} from '@ai/agent-contracts';
import { startTestService } from './service-harness.ts';

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

function call(...args: Parameters<typeof harness.call>) {
  return harness.call(...args);
}

async function errorCode(response: Response): Promise<string> {
  return parse(ErrorEnvelopeSchema, await response.json()).error.code;
}

/** The routes only direct main-token clients may call (the relay refuses them). */
function isShellPath(pathPattern: string): boolean {
  return (
    pathPattern.startsWith('/v1/admin/') ||
    pathPattern.startsWith('/v1/migration/') ||
    pathPattern === '/v1/capabilities/result' ||
    pathPattern === '/v1/resources/import' ||
    pathPattern === '/v1/stream'
  );
}

test('the route manifest classifies every route the service serves', async () => {
  const response = await call('/v1/admin/routes');
  assert.equal(response.status, 200);
  const manifest = parse(RouteManifestResponseSchema, await response.json());
  assert.equal(manifest.epoch, harness.config.epoch);
  const keys = manifest.routes.map((route) => `${route.method} ${route.pathPattern}`);
  assert.equal(new Set(keys).size, keys.length, 'each route appears once');
  assert.ok(manifest.routes.length > 90, `only ${manifest.routes.length} routes listed`);
  for (const key of [
    'GET /v1/admin/routes',
    'POST /v1/admin/shutdown',
    'GET /v1/stream',
    'PUT /v1/mcp/servers/:serverId',
    'POST /v1/mcp/servers/:serverId/enabled',
    'DELETE /v1/mcp/servers/:serverId',
    // Launch approvals: granting is shell-only, withdrawing and the notice are the renderer's.
    'GET /v1/admin/approvals/mcp/:serverId',
    'POST /v1/admin/approvals/mcp',
    'DELETE /v1/mcp/servers/:serverId/approval',
    'POST /v1/mcp/approvals/notice/dismiss',
  ])
    assert.ok(keys.includes(key), `${key} is missing`);
  // MCP servers are edited one at a time; no route replaces the catalog with client records.
  assert.ok(!keys.includes('POST /v1/mcp/configure'), 'POST /v1/mcp/configure is gone');
  // One withdraw route serves both layers; the plugin route that approved from the renderer is gone.
  assert.ok(!keys.some((key) => key.endsWith('/servers/:name/approval')), 'no plugin approval');
  for (const route of manifest.routes)
    assert.equal(
      route.exposure,
      isShellPath(route.pathPattern) ? 'shell' : 'renderer',
      `${route.method} ${route.pathPattern}`,
    );
});

test('the manifest route answers only the main token', async () => {
  assert.equal((await call('/v1/admin/routes', { anonymous: true })).status, 401);
});

test('the relay epoch precondition', async () => {
  const current = String(harness.config.epoch);
  assert.equal((await call('/v1/status')).status, 200, 'absent header: no check');
  assert.equal((await call('/v1/status', { epoch: current })).status, 200, 'same epoch');

  const stale = await call('/v1/status', { epoch: String(harness.config.epoch + 1) });
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get(RELAY_EPOCH_CURRENT_HEADER), current);
  assert.equal(await errorCode(stale), 'epoch_mismatch');

  // Refused before the body is validated or the handler runs, so a relay may replay the POST.
  const post = await call('/v1/tasks', { method: 'POST', body: '{}', epoch: '0' });
  assert.equal(post.status, 409);
  assert.equal(post.headers.get(RELAY_EPOCH_CURRENT_HEADER), current);

  const anonymous = await call('/v1/status', { epoch: '0', anonymous: true });
  assert.equal(anonymous.status, 401, 'no epoch answer without the token');
  assert.equal(anonymous.headers.get(RELAY_EPOCH_CURRENT_HEADER), null);

  for (const malformed of ['abc', '01', '-1', '1.0', '1e3', '1, 2']) {
    const response = await call('/v1/status', { epoch: malformed });
    assert.equal(response.status, 400, `malformed ${JSON.stringify(malformed)}`);
    assert.equal(response.headers.get(RELAY_EPOCH_CURRENT_HEADER), null);
  }
});

test('a business 409 never carries the relay epoch header', async () => {
  const created = await call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      name: 'Conflict fixture',
      baseUrl: '',
      authType: 'api_key',
      defaultModel: '',
      options: {},
      customModels: [],
      credential: null,
    }),
  });
  assert.equal(created.status, 200);
  const { connection } = parse(
    Type.Object({ connection: Type.Object({ connectionId: Identifier }) }),
    await created.json(),
  );
  for (const epoch of [undefined, String(harness.config.epoch)]) {
    const conflict = await call(`/v1/providers/${connection.connectionId}/disconnect`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 99 }),
      epoch,
    });
    assert.equal(conflict.status, 409);
    assert.equal(await errorCode(conflict), 'conflict');
    assert.equal(conflict.headers.get(RELAY_EPOCH_CURRENT_HEADER), null);
  }
});
