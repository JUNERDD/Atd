import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import type { McpServerConfig } from '@atd/agent-contracts';
import { McpError as McpRpcError } from '@earendil-works/pi-mcp';
import { normalizeInputSchema } from '../dist/mcp/policy.js';
import { renderMcpServersSection } from '../dist/mcp/servers-section.js';
import {
  bindingExposure,
  mcpProxyName,
  mcpProxyPrefix,
  prepareMcpTools,
  type McpGuardedCall,
  type McpProxyHost,
} from '../dist/mcp/tool-proxies.js';
import { FakeMcpServer } from './mcp-fake-server.ts';
import { recordingTool, standardTools, tool } from './mcp-fake-tools.ts';
import { answerConfirm, at, facadeKit, httpRecord, piStandIn, registeredTools } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * The tools a run is given for MCP tools: names, the parameters and annotations models see, and
 * what a call returns. The calls behind them: mcp-facade.test.ts.
 */

installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

const schema = { type: 'object', properties: { a: { type: 'string' } } };
/** Hints as a server may send them: only the booleans are hints. */
const hints = JSON.parse(
  '{"title":"T","readOnlyHint":true,"destructiveHint":false,"openWorldHint":1}',
);
const extras = [
  recordingTool('typed'),
  tool('hinted', undefined, {
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      additionalProperties: false,
      ...schema,
    },
    annotations: hints,
  }),
  tool('plain'),
  tool('rpc-error', () => {
    throw new McpRpcError(-32000, 'the database is on fire');
  }),
];

/** Proxies of `records` as a run binds them; `tier` answers what the task tier is asked. */
async function bind(
  t: TestContext,
  records: McpServerConfig[],
  tier?: McpProxyHost['preapprove'],
  init: ConstructorParameters<typeof FakeMcpServer>[0] = { tools: [...standardTools(), ...extras] },
) {
  const fake = new FakeMcpServer(init);
  const kit = facadeKit(t, records, { transports: fake.factory, services: harness.service });
  const host: McpProxyHost = {
    taskId: 'task-1',
    runId: () => 'run-1',
    executionId: () => 'exec-1',
    audit: (entry) => void kit.audit.push(entry),
    log: kit.log,
    ...(tier ? { preapprove: tier } : {}),
    setStatus: () => undefined,
  };
  const prepared = await prepareMcpTools(host, { facade: kit.facade, records });
  const tools = await registeredTools(prepared.factory);
  return {
    fake,
    kit,
    prepared,
    tools,
    named: (name: string) => at(tools.filter((e) => e.name === name)),
  };
}

test('proxy names are tool-safe, at most 64 characters, and keep their server prefix', () => {
  assert.equal(mcpProxyName('srv', 'echo'), 'mcp__srv__echo');
  assert.equal(mcpProxyName('my.server', 'do-thing!'), 'mcp__my_server__do_thing_');
  assert.equal(
    mcpProxyName('srv', '***'),
    'mcp__srv___',
    'a run of symbols becomes one underscore',
  );
  const long = mcpProxyName('srv', 'a'.repeat(100));
  assert.equal(long.length, 64);
  assert.match(long, /^mcp__srv__a+_[0-9a-f]{8}$/);
  assert.notEqual(long, mcpProxyName('srv', `${'a'.repeat(99)}b`), 'the hash keeps them apart');
  const taken = new Set([mcpProxyName('s', 'a.b')]);
  assert.equal(
    mcpProxyName('s', 'a_b', taken),
    'mcp__s__a_b_2',
    'a name that sanitizes alike is numbered',
  );

  // The model is told to look for `<prefix>*`, so the prefix has to survive shortening.
  const server = 'a-very-long-server-name-'.repeat(4);
  const prefix = mcpProxyPrefix(server);
  assert.ok(prefix.length <= 55, 'a shortened name keeps only its first 55 characters');
  for (const name of ['x', 'y'.repeat(200)]) {
    const proxy = mcpProxyName(server, name);
    assert.ok(proxy.startsWith(prefix) && proxy.length <= 64, `${name.slice(0, 8)}…`);
  }
  assert.notEqual(prefix, mcpProxyPrefix(`${server}2`), 'ids that share their start stay apart');
  assert.match(mcpProxyPrefix('kit:srv'), /^mcp__kit_srv_[0-9a-f]{10}__$/);
  assert.notEqual(mcpProxyPrefix('kit:srv'), mcpProxyPrefix('kit_srv'));
});

test('each authorized tool is bound with the parameters and hints models see', async (t) => {
  const records = [httpRecord('srv'), httpRecord('other')].map((record) => ({
    ...record,
    exposeResources: false,
  }));
  const { prepared, named, tools } = await bind(t, records);
  assert.equal(
    tools.length,
    prepared.bindings.length,
    'no resource tools without exposed resources',
  );
  const mine = prepared.bindings.filter((b) => b.serverId === 'srv').map((b) => b.proxyName);
  assert.deepEqual(mine.slice(0, 3), ['mcp__srv__echo', 'mcp__srv__fail', 'mcp__srv__structured']);
  assert.ok(mine.every((name) => name.startsWith(mcpProxyPrefix('srv'))));
  assert.notEqual(named('mcp__srv__echo'), named('mcp__other__echo'), 'servers do not share names');

  const hinted = named('mcp__srv__hinted');
  const parameters = JSON.parse(JSON.stringify(hinted.parameters));
  assert.deepEqual(parameters, schema, 'no $schema and no additionalProperties');
  assert.deepEqual(parameters, normalizeInputSchema(at(extras, 1).definition.inputSchema));
  assert.deepEqual(hinted.annotations, { readOnlyHint: true, destructiveHint: false });
  assert.equal(named('mcp__srv__plain').annotations, undefined);
  // Without a description or title the tool is named; an unguarded call notes no approval.
  assert.equal(hinted.description, 'MCP tool hinted on srv.');
  assert.equal(named('mcp__srv__echo').description, 'Echo', 'the title stands in');
  assert.deepEqual(hinted.namespace, { name: 'mcp__srv', description: 'MCP server srv' });
  assert.equal(hinted.exposure, 'direct');
  assert.equal(hinted.executionMode, 'sequential');
  const binding = prepared.bindings.find((b) => b.serverId === 'srv' && b.tool === 'hinted');
  assert.deepEqual([binding?.revision, binding?.annotations], [1, hinted.annotations]);
});

test('include and exclude lists, a staged selection and a disabled server narrow the bind', async (t) => {
  const listed = httpRecord('srv', { includeTools: ['e*', 'fail'], excludeTools: ['fail'] });
  const { prepared } = await bind(t, [listed, httpRecord('off', { disabled: true })]);
  assert.deepEqual(
    prepared.bindings.map((b) => b.tool),
    ['echo'],
    'excluded wins; disabled binds nothing',
  );

  const fake = new FakeMcpServer({ tools: standardTools() });
  const record = httpRecord('srv');
  const kit = facadeKit(t, [record], { transports: fake.factory, services: harness.service });
  const host: McpProxyHost = {
    taskId: 't',
    runId: () => 'r',
    executionId: () => 'e',
    audit: () => undefined,
    log: kit.log,
    setStatus: () => undefined,
  };
  const selected = [{ connectionId: 'conn-srv', tool: 'slow' }];
  const staged = await prepareMcpTools(host, { facade: kit.facade, records: [record], selected });
  assert.deepEqual(
    staged.bindings.map((b) => b.tool),
    ['slow'],
  );
});

test('a server that cannot be reached is skipped and audited, not fatal', async (t) => {
  const fake = new FakeMcpServer({ tools: standardTools() });
  const records = [httpRecord('down'), httpRecord('up')];
  const kit = facadeKit(t, records, { transports: fake.factory, services: harness.service });
  const audit: Record<string, unknown>[] = [];
  const host: McpProxyHost = {
    taskId: 't',
    runId: () => 'r',
    executionId: () => 'e',
    audit: (e) => void audit.push(e),
    log: kit.log,
    setStatus: () => undefined,
  };
  fake.failNext('initialize', 1, () => new Error('connection refused'));
  const prepared = await prepareMcpTools(host, { facade: kit.facade, records });
  assert.deepEqual([...new Set(prepared.bindings.map((b) => b.serverId))], ['up']);
  assert.ok(audit.some((e) => e.decision === 'bind-skip' && e.tool === 'mcp:down'));
});

test('a call returns the result as text, a script value and details', async (t) => {
  const asked: McpGuardedCall[] = [];
  const tier = async (call: McpGuardedCall) => (asked.push(call), { allowed: true as const });
  const { named } = await bind(t, [httpRecord('srv')], tier);
  const ctx = piStandIn();
  const echoed = await named('mcp__srv__echo').execute(
    'call-1',
    { text: 'hi' },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(echoed, {
    content: [{ type: 'text', text: 'hi' }],
    details: { server: 'srv', tool: 'echo', isError: false, attachments: [], limitsNote: '' },
    // A codemode script's call resolves to the `CallToolResult` the output schema declares.
    structuredContent: {
      content: [{ type: 'text', text: 'hi' }],
      structuredContent: { echoed: 'hi' },
      isError: false,
    },
  });
  const failed = await named('mcp__srv__fail').execute('call-2', {}, undefined, undefined, ctx);
  assert.equal(failed.isError, true, 'pi shows the call as failed');
  assert.equal(failed.details.isError, true);
  assert.equal(at(failed.content).text, 'MCP tool reported an error:\nboom');
  const structured = await named('mcp__srv__structured').execute(
    'call-3',
    {},
    undefined,
    undefined,
    ctx,
  );
  assert.equal(at(structured.content).text, '{\n  "value": 42\n}');
  assert.deepEqual(structured.structuredContent, {
    content: [],
    structuredContent: { value: 42 },
    isError: false,
  });
  assert.equal('isError' in structured, false);
  assert.deepEqual(asked, [], 'a tool the record does not guard never asks the tier');
});

test('progress reaches pi, and the task tier is asked about a guarded call', async (t) => {
  const asked: McpGuardedCall[] = [];
  const tier = async (call: McpGuardedCall) => (asked.push(call), { allowed: true as const });
  const { named } = await bind(t, [httpRecord('srv', { approveTools: true })], tier);
  const updates: string[] = [];
  const onUpdate = (update: { content: { text: string }[] }) =>
    void updates.push(at(update.content).text);
  await named('mcp__srv__slow').execute('call-4', { steps: 2 }, undefined, onUpdate, piStandIn());
  assert.deepEqual(updates, ['MCP srv/slow: step 1 (1/2)', 'MCP srv/slow: step 2 (2/2)']);
  assert.deepEqual(asked, [
    { toolCallId: 'call-4', serverId: 'srv', tool: 'slow', args: { steps: 2 } },
  ]);
});

test('a declined call and a server error reach the model as plain errors', async (t) => {
  const { named } = await bind(t, [httpRecord('srv', { approveTools: true })]);
  const ctx = piStandIn();
  const declined = named('mcp__srv__echo').execute(
    'call-5',
    { text: 'no' },
    undefined,
    undefined,
    ctx,
  );
  await answerConfirm(harness.service.confirms, 'declined');
  await assert.rejects(declined, { message: 'The user declined this action.' });
  const failing = named('mcp__srv__rpc_error').execute('call-6', {}, undefined, undefined, ctx);
  await answerConfirm(harness.service.confirms, 'once');
  await assert.rejects(failing, { name: 'Error', message: 'the database is on fire' });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    named('mcp__srv__echo').execute('call-7', { text: 'x' }, cancelled.signal, undefined, ctx),
  );
});

test('auto exposure defers a server that binds more than ten tools; a set exposure wins', async (t) => {
  const many = Array.from({ length: 11 }, (_, index) => tool(`t${index}`));
  const records = [
    httpRecord('big'),
    httpRecord('small', { includeTools: ['t1', 't2'] }),
    httpRecord('pinned', { exposure: 'direct' }),
    httpRecord('lazy', { exposure: 'deferred', includeTools: ['t1'] }),
  ];
  const { prepared, named } = await bind(t, records, undefined, { tools: many });
  const exposures = new Map(prepared.bindings.map((b) => [b.serverId, b.exposure]));
  assert.deepEqual(Object.fromEntries(exposures), {
    big: 'deferred',
    small: 'direct',
    pinned: 'direct',
    lazy: 'deferred',
  });
  assert.equal(named('mcp__big__t0').exposure, 'deferred', 'pi registers it deferred');
  assert.deepEqual(
    [bindingExposure('auto', 10), bindingExposure('auto', 11), bindingExposure('direct', 99)],
    ['direct', 'deferred', 'direct'],
  );
  // Deferred servers are listed even without instructions, so the model knows to search.
  const section = renderMcpServersSection(prepared.bindings) ?? '';
  assert.match(
    section,
    /## mcp__big \(server big\)\nIts tools are not loaded yet: find .*tool_search/,
  );
  assert.match(section, /## mcp__lazy \(server lazy\)/);
  assert.doesNotMatch(section, /mcp__small|mcp__pinned/, 'declared servers without instructions');
});

test('servers that expose resources get the resource tools, which reach only them', async (t) => {
  const greeting = { uri: 'mem://greeting', mimeType: 'text/plain', text: 'hello' };
  const records = [httpRecord('srv'), httpRecord('closed', { exposeResources: false })];
  const { prepared, named, fake } = await bind(t, records, undefined, {
    tools: standardTools(),
    resources: [
      { uri: greeting.uri, name: 'greeting', mimeType: 'text/plain' },
      { uri: 'ui://widget', name: 'widget' },
    ],
    templates: [{ uriTemplate: 'mem://items/{id}', name: 'item', description: 'An item.' }],
  });
  fake.contents.set(greeting.uri, greeting);
  assert.deepEqual(prepared.resourceServers, [{ serverId: 'srv', revision: 1 }]);
  const ctx = piStandIn();
  const run = (name: string, args: Record<string, unknown>) =>
    named(name).execute(`call-${name}`, args, undefined, undefined, ctx);
  const listed = await run('list_mcp_resources', {});
  assert.deepEqual(JSON.parse(at(listed.content).text), {
    resources: [{ server: 'srv', uri: greeting.uri, name: 'greeting', mimeType: 'text/plain' }],
  });
  const templates = await run('list_mcp_resource_templates', { server: 'srv' });
  assert.deepEqual(templates.structuredContent, {
    server: 'srv',
    resourceTemplates: [
      { server: 'srv', uriTemplate: 'mem://items/{id}', name: 'item', description: 'An item.' },
    ],
  });
  const read = await run('read_mcp_resource', { server: 'srv', uri: greeting.uri });
  assert.deepEqual(read.content, [{ type: 'text', text: 'hello' }]);
  assert.deepEqual(read.structuredContent, {
    server: 'srv',
    uri: greeting.uri,
    contents: [greeting],
  });
  await assert.rejects(run('read_mcp_resource', { server: 'closed', uri: greeting.uri }), {
    message: /"closed" has no resources\. Servers with resources: srv/,
  });
  await assert.rejects(run('read_mcp_resource', { server: 'srv', uri: 'mem://unlisted' }), {
    message: /not authorized on srv/,
  });
  await assert.rejects(run('list_mcp_resources', { server: 'srv', cursor: 'page-2' }), {
    message: /always complete/,
  });
});
