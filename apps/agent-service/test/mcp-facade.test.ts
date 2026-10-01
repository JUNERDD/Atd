import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test, type TestContext } from 'node:test';
import {
  McpAuthRequiredError,
  McpError as McpRpcError,
  McpHttpError,
  McpSessionExpiredError,
} from '@earendil-works/pi-mcp';
import type { McpUpdate } from '../dist/mcp/errors.js';
import { toPiText } from '../dist/mcp/mapping.js';
import { FakeMcpServer, waitFor, type FakeTool } from './mcp-fake-server.ts';
import { fixedTool, recordingTool, standardTools, tool } from './mcp-fake-tools.ts';
import { answerConfirm, at, facadeKit, httpRecord, operation } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The tool path of the facade: results mapped to the wire shape, arguments validated before
 * anything is sent, the approval gate, progress, cancellation and how failures read to callers.
 * Proxies: mcp-proxies.test.ts; prompts and resources: mcp-catalog.test.ts.
 */

installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

const PICTURE = Buffer.from('not really a png');
const extras: FakeTool[] = [
  recordingTool('typed'),
  fixedTool('link', { content: [{ type: 'resource_link', uri: 'mem://linked', name: 'linked' }] }),
  fixedTool('picture', {
    content: [{ type: 'image', data: PICTURE.toString('base64'), mimeType: 'image/png' }],
  }),
  tool('rpc-error', () => {
    throw new McpRpcError(-32000, 'the database is on fire');
  }),
];

/** A facade over one server `srv` (tools run without asking unless `record` says so). */
function setup(t: TestContext, record = httpRecord('srv')) {
  const fake = new FakeMcpServer({ tools: [...standardTools(), ...extras] });
  const kit = facadeKit(t, [record], { transports: fake.factory, services: harness.service });
  const call = (name: string, args?: Record<string, unknown>, signal?: AbortSignal) =>
    kit.facade.callTool(operation(), 'srv', name, args, signal);
  return { fake, call, ...kit };
}

const answer = (decision: 'once' | 'session' | 'declined') =>
  answerConfirm(harness.service.confirms, decision);

test('a text result keeps its blocks, structured content and error flag', async (t) => {
  const { call } = setup(t);
  assert.deepEqual(await call('echo', { text: 'hi' }), {
    content: [{ type: 'text', text: 'hi' }],
    structuredContent: { echoed: 'hi' },
    isError: false,
    attachments: [],
    limitsNote: '',
  });
  const failed = await call('fail');
  assert.equal(failed.isError, true);
  assert.equal(toPiText(failed), 'MCP tool reported an error:\nboom');
});

test('a structured-only result reads to the model as JSON', async (t) => {
  const { call } = setup(t);
  const result = await call('structured');
  assert.deepEqual([result.content, result.structuredContent], [[], { value: 42 }]);
  assert.equal(toPiText(result), '{\n  "value": 42\n}');
});

test('an image becomes an artifact; a resource link is a reference that is never fetched', async (t) => {
  const { call, fake } = setup(t);
  const picture = await call('picture');
  const attachment = at(picture.attachments);
  assert.deepEqual([attachment.kind, attachment.mimeType], ['image', 'image/png']);
  assert.match(attachment.name ?? '', /^mcp-image-.*\.png$/);
  assert.ok(attachment.artifactId);
  const file = path.join(harness.config.paths.resourcesDir, attachment.artifactId);
  assert.deepEqual(await readFile(file), PICTURE, 'the artifact holds the image bytes');
  assert.match(toPiText(picture), new RegExp(`saved as artifact ${attachment.artifactId}`));

  const link = await call('link');
  assert.deepEqual(link.content, [{ type: 'resource_link', uri: 'mem://linked', name: 'linked' }]);
  assert.equal(toPiText(link), '[link linked: mem://linked] (not fetched)');
  assert.deepEqual(fake.requests('resources/read'), []);
});

test('arguments are validated and coerced before anything is sent', async (t) => {
  const { call, fake } = setup(t);
  await call('typed', { count: '5', flag: 'true' });
  assert.deepEqual(at(fake.requests('tools/call')).params, {
    name: 'typed',
    arguments: { count: 5, flag: true },
  });
  await assert.rejects(call('typed', { flag: true }), (error) => {
    assert.ok(error instanceof Error && 'code' in error && error.code === 'bad_request');
    assert.match(error.message, /Tool typed arguments are invalid: .*count/);
    return true;
  });
  await assert.rejects(call('typed', { count: 'many' }), { code: 'bad_request' });
  assert.equal(fake.requests('tools/call').length, 1, 'the invalid calls never left');
});

test('a tool the record does not allow is refused before it is sent', async (t) => {
  const { call, fake, audit } = setup(t, httpRecord('srv', { excludeTools: ['fail'] }));
  await assert.rejects(call('nope'), { code: 'forbidden', message: /not authorized on srv/ });
  await assert.rejects(call('fail'), { code: 'forbidden', message: /excluded on srv/ });
  assert.ok(audit.some((entry) => entry.reason === 'unknown-tool' && entry.decision === 'deny'));
  const included = setup(t, httpRecord('srv', { includeTools: ['echo'] }));
  await assert.rejects(included.call('fail'), { message: /not in the allowed set/ });
  assert.equal(fake.requests('tools/call').length + included.fake.requests('tools/call').length, 0);
  const pinned = setup(t);
  const stale = pinned.facade.callTool(operation({ configRevision: 7 }), 'srv', 'echo', {
    text: 'x',
  });
  await assert.rejects(stale, { code: 'conflict', message: /keeps revision 7/ });
});

test('a guarded tool asks first; a decline stops it, an answer never becomes a grant', async (t) => {
  const { call, fake } = setup(t, httpRecord('srv', { approveTools: true }));
  const declined = call('typed', { count: '3' });
  const request = await answer('declined');
  await assert.rejects(declined, { code: 'forbidden', message: /declined MCP tool typed on srv/ });
  assert.equal(request.title, 'MCP srv / typed');
  assert.equal(fake.requests('tools/call').length, 0, 'nothing was sent');

  const allowed = call('typed', { count: '3' });
  const shown = await answer('session');
  assert.deepEqual(JSON.parse(String(shown.kind === 'confirmation' && shown.detail)), {
    server: 'srv',
    tool: 'typed',
    args: { count: 3 },
  });
  await allowed;
  const again = call('typed', { count: 4 });
  await answer('once');
  await again;
  assert.equal(fake.requests('tools/call').length, 2, 'a "session" answer asked again next time');
});

test('only the tools an approval pattern names ask; a task tier can allow one', async (t) => {
  const { call, fake } = setup(t, httpRecord('srv', { approveTools: ['fail'] }));
  await call('echo', { text: 'runs without asking' });
  assert.equal(harness.service.confirms.pending().length, 0);
  const asking = call('fail');
  await answer('once');
  await asking;
  const tier = setup(t, httpRecord('srv', { approveTools: true }));
  const op = operation({ preapprove: async () => ({ allowed: true }) });
  await tier.facade.callTool(op, 'srv', 'echo', { text: 'preapproved' });
  assert.equal(harness.service.confirms.pending().length, 0);
  assert.equal(fake.requests('tools/call').length, 2);
});

test('progress reaches the caller; a cancelled call is cancelled at the server', async (t) => {
  const { fake, facade } = setup(t);
  const updates: McpUpdate[] = [];
  await facade.callTool(operation(), 'srv', 'slow', { steps: 3 }, undefined, (u) =>
    updates.push(u),
  );
  assert.deepEqual(
    updates.map(({ progress, total, message }) => [progress, total, message]),
    [
      [1, 3, 'step 1'],
      [2, 3, 'step 2'],
      [3, 3, 'step 3'],
    ],
  );
  const abort = new AbortController();
  const call = facade.callTool(operation(), 'srv', 'hang', {}, abort.signal);
  await waitFor(() =>
    fake.requests('tools/call').some((r) => JSON.stringify(r.params).includes('hang')),
  );
  abort.abort();
  await assert.rejects(call, { name: 'AbortError' });
  await waitFor(() => at(fake.sessions).cancelled.length === 1);
});

test('failures read to callers as MCP errors, and a refusal moves the server to auth_required', async (t) => {
  const { call, fake, states } = setup(t, httpRecord('srv', { requestTimeoutMs: 80 }));
  await assert.rejects(call('hang'), { code: 'internal', message: /did not answer within 80 ms/ });
  await assert.rejects(call('rpc-error'), { code: 'internal', message: /the database is on fire/ });
  fake.failNext('tools/call', 1, () => new McpHttpError(403, 'Forbidden'));
  await assert.rejects(call('echo', { text: 'x' }), {
    code: 'auth_required',
    message: /refused the credential \(reauthentication required\)/,
  });
  assert.equal(states.get('srv'), 'auth_required');
  states.set('srv', 'ready');
  fake.failNext(
    'tools/call',
    1,
    () => new McpAuthRequiredError(new Response(null, { status: 401 }), ''),
  );
  await assert.rejects(call('echo', { text: 'x' }), { code: 'auth_required' });
  assert.equal(states.get('srv'), 'auth_required');
});

test('a server that forgot its session gets the request once more on a new connection', async (t) => {
  const { call, fake, facade } = setup(t);
  fake.failNext('tools/call', 1, () => new McpSessionExpiredError());
  assert.equal((await call('echo', { text: 'again' })).isError, false);
  assert.equal(fake.launches.length, 2, 'the connection was replaced');
  fake.failNext('tools/list', 1, () => new McpSessionExpiredError());
  assert.equal((await facade.listTools('srv')).length, 6 + extras.length);
  assert.equal(fake.launches.length, 3);
  fake.failNext('tools/call', 2, () => new McpSessionExpiredError());
  await assert.rejects(call('echo', { text: 'twice' }), { code: 'internal' });
  assert.equal(fake.launches.length, 4, 'one retry, not more');
});

test('a connection that closes under a request fails it', async (t) => {
  const { call, fake } = setup(t);
  const running = call('hang');
  await waitFor(() =>
    fake.requests('tools/call').some((r) => JSON.stringify(r.params).includes('hang')),
  );
  await at(fake.open()).drop();
  await assert.rejects(running, { code: 'internal', message: /connection closed/i });
});
