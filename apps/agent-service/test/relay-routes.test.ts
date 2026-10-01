import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerRelayRoutes, RENDERER_ROUTE, SHELL_ROUTE } from '../dist/relay-routes.js';

const service = { epoch: 3, token: 'fixture-token' };

function relayApp() {
  const app = Fastify({ exposeHeadRoutes: false });
  registerRelayRoutes(app, service);
  return app;
}

test('a route without an exposure stops startup', () => {
  const app = relayApp();
  assert.throws(
    () => app.get('/v1/unclassified', async () => ({})),
    /GET \/v1\/unclassified declares no config\.exposure/,
  );
});

test('wildcard and regex patterns cannot enter the manifest', () => {
  const app = relayApp();
  assert.throws(() => app.get('/v1/files/*', RENDERER_ROUTE, async () => ({})), /wildcard/);
  assert.throws(() => app.get('/v1/files/*', SHELL_ROUTE, async () => ({})), /wildcard/);
  assert.throws(
    () => app.get('/v1/files/:id(^\\d+)', RENDERER_ROUTE, async () => ({})),
    /cannot enter the route manifest/,
  );
});

test('the manifest lists every declared route and method with its exposure', async () => {
  const app = relayApp();
  app.get('/v1/items/:id', RENDERER_ROUTE, async () => ({}));
  app.route({
    method: ['PUT', 'DELETE'],
    url: '/v1/items/:id',
    ...SHELL_ROUTE,
    handler: () => ({}),
  });
  const response = await app.inject({ method: 'GET', url: '/v1/admin/routes' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    epoch: 3,
    routes: [
      { method: 'GET', pathPattern: '/v1/admin/routes', exposure: 'shell' },
      { method: 'GET', pathPattern: '/v1/items/:id', exposure: 'renderer' },
      { method: 'PUT', pathPattern: '/v1/items/:id', exposure: 'shell' },
      { method: 'DELETE', pathPattern: '/v1/items/:id', exposure: 'shell' },
    ],
  });
  const head = await app.inject({ method: 'HEAD', url: '/v1/items/1' });
  assert.equal(head.statusCode, 404);
});
