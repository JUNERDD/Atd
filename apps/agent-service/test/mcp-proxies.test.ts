import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import type { McpServerConfig } from '@ai/agent-contracts';
import { McpError as McpRpcError } from '@earendil-works/pi-mcp';
import { normalizeInputSchema } from '../dist/mcp/policy.js';
import {
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
async function bind(t: TestContext, records: McpServerConfig[], tier?: McpProxyHost['preapprove']) {
  const fake = new FakeMcpServer({ tools: [...standardTools(), ...extras] });
  const kit = facadeKit(t, records, { transports: fake.factory, services: harness.service });
  const host: McpProxyHost = {
    taskId: 'task-1',
    runId: () => 'run-1',
    executionId: () => 'exec-1',
    audit: (entry) => void kit.audit.push(entry),
    log: kit.log,
    ...(tier ? { preapprove: tier } : {}),
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
  const { prepared, named, tools } = await bind(t, [httpRecord('srv'), httpRecord('other')]);
  assert.equal(tools.length, prepared.bindings.length);
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
  assert.equal(hinted.description, 'MCP tool hinted on srv. Approval is per call.');
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
  };
  fake.failNext('initialize', 1, () => new Error('connection refused'));
  const prepared = await prepareMcpTools(host, { facade: kit.facade, records });
  assert.deepEqual([...new Set(prepared.bindings.map((b) => b.serverId))], ['up']);
  assert.ok(audit.some((e) => e.decision === 'bind-skip' && e.tool === 'mcp:down'));
});

test('a call returns the result as text, structured content and details', async (t) => {
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
    structuredContent: { echoed: 'hi' },
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
  assert.deepEqual(structured.structuredContent, { value: 42 });
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
