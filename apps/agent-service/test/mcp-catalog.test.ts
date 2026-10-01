import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import { promptPreviewToInput } from '../dist/mcp/mapping.js';
import { FakeMcpServer } from './mcp-fake-server.ts';
import { standardTools } from './mcp-fake-tools.ts';
import { at, facadeKit, httpRecord, operation } from './mcp-kit.ts';
import { installMemoryKeyring } from './memory-keyring.ts';
import { startTestService } from './service-harness.ts';

/**
 * What a server offers besides tools, through the facade: prompts (paged, previewed) and
 * resources (listed, templated, read only when the server lists them).
 */

installMemoryKeyring();
let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

const greeting = { uri: 'mem://greeting', mimeType: 'text/plain', text: 'hello' };

function setup(
  t: TestContext,
  init: ConstructorParameters<typeof FakeMcpServer>[0] = {},
  exposed = true,
) {
  const fake = new FakeMcpServer({
    tools: standardTools(),
    resources: [{ uri: 'mem://greeting', name: 'greeting', mimeType: 'text/plain' }],
    templates: [{ uriTemplate: 'mem://items/{id}', name: 'item' }],
    prompts: [
      { name: 'greet', description: 'Greets.', arguments: [{ name: 'name', required: true }] },
    ],
    ...init,
  });
  fake.contents.set(greeting.uri, greeting);
  fake.contents.set('mem://items/7', { uri: 'mem://items/7', text: 'seven' });
  fake.contents.set('mem://secret', { uri: 'mem://secret', text: 'not listed' });
  const kit = facadeKit(t, [httpRecord('srv', { exposeResources: exposed })], {
    transports: fake.factory,
    services: harness.service,
  });
  return { fake, ...kit };
}

test('prompts are listed with their arguments', async (t) => {
  const { facade } = setup(t, {
    prompts: [
      { name: 'greet', description: 'Greets.', arguments: [{ name: 'name', required: true }] },
      { name: 'bare' },
    ],
  });
  const [greet, bare] = await facade.listPrompts('srv');
  assert.deepEqual(greet, {
    serverId: 'srv',
    connectionId: 'conn-srv',
    name: 'greet',
    title: null,
    description: 'Greets.',
    args: [{ name: 'name', description: null, required: true }],
    meta: null,
  });
  assert.deepEqual([bare?.name, bare?.args, bare?.description], ['bare', [], null]);
});

test('every page of the prompts is read; a repeated cursor and a bad entry fail the list', async (t) => {
  const { facade, fake, connections } = setup(t, {
    prompts: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name })),
  });
  fake.promptPageSize = 2;
  await connections.ensure('srv');
  const connected = fake.requests('prompts/list').length;
  assert.deepEqual(
    (await facade.listPrompts('srv')).map((p) => p.name),
    ['a', 'b', 'c', 'd', 'e'],
  );
  const cursors = fake
    .requests('prompts/list')
    .slice(connected)
    .map((r) => r.params);
  assert.deepEqual(cursors, [undefined, { cursor: 'page-1' }, { cursor: 'page-2' }]);

  fake.repeatPromptCursor = true;
  await assert.rejects(facade.listPrompts('srv'), {
    code: 'internal',
    message: /cursor it had already returned/,
  });
  fake.repeatPromptCursor = false;
  fake.promptPageSize = 0;
  fake.prompts.push(JSON.parse('{"description":"has no name"}'));
  await assert.rejects(facade.listPrompts('srv'), {
    message: /Invalid entry in MCP prompts\/list result/,
  });
});

test('a prompt is fetched with its arguments and previewed as input, never as a system prompt', async (t) => {
  const { facade, fake } = setup(t);
  const response = await facade.getPrompt(operation(), 'srv', 'greet', { name: 'Ada' });
  assert.deepEqual(response, {
    serverId: 'srv',
    name: 'greet',
    description: null,
    messages: [{ role: 'user', content: { type: 'text', text: 'greet {"name":"Ada"}' } }],
  });
  assert.equal(promptPreviewToInput(response), '[user]\ngreet {"name":"Ada"}');
  await assert.rejects(facade.getPrompt(operation(), 'srv', 'nope'), {
    code: 'forbidden',
    message: /Prompt nope is not authorized on srv/,
  });
  assert.equal(fake.requests('prompts/get').length, 1, 'only the listed prompt was asked for');
});

test('a server without a capability offers nothing and is not asked', async (t) => {
  const { facade, fake } = setup(t, { capabilities: {} });
  assert.deepEqual(await facade.listPrompts('srv'), []);
  assert.deepEqual(await facade.listTools('srv'), []);
  assert.deepEqual(await facade.listResources('srv'), []);
  assert.deepEqual(await facade.listResourceTemplates('srv'), []);
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://greeting'), {
    code: 'forbidden',
  });
  assert.deepEqual(
    fake.requests().map((r) => r.method),
    ['initialize'],
  );
});

test('resources and their templates are listed', async (t) => {
  const { facade } = setup(t);
  assert.deepEqual(await facade.listResources('srv'), [
    {
      serverId: 'srv',
      connectionId: 'conn-srv',
      uri: 'mem://greeting',
      name: 'greeting',
      description: null,
      mimeType: 'text/plain',
      meta: null,
    },
  ]);
  assert.deepEqual(await facade.listResourceTemplates('srv'), [
    {
      serverId: 'srv',
      connectionId: 'conn-srv',
      uriTemplate: 'mem://items/{id}',
      name: 'item',
      description: null,
      mimeType: null,
      meta: null,
    },
  ]);
});

test('a server that does not implement templates has none', async (t) => {
  const { facade, fake } = setup(t, { templates: null });
  assert.deepEqual(await facade.listResourceTemplates('srv'), []);
  assert.equal(
    fake.requests('resources/templates/list').length,
    1,
    'it was asked, and said -32601',
  );
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://items/7'), {
    code: 'forbidden',
  });
});

test('a listed resource, or one a template covers, is read; any other URI is forbidden', async (t) => {
  const { facade, fake } = setup(t);
  assert.deepEqual(await facade.readResource(operation(), 'srv', 'mem://greeting'), {
    serverId: 'srv',
    uri: 'mem://greeting',
    contents: [greeting],
  });
  const templated = await facade.readResource(operation(), 'srv', 'mem://items/7');
  assert.deepEqual(at(templated.contents), { uri: 'mem://items/7', text: 'seven' });
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://secret'), {
    code: 'forbidden',
    message: /Resource mem:\/\/secret is not authorized on srv/,
  });
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://items/7/deeper'), {
    code: 'forbidden',
  });
  assert.equal(fake.requests('resources/read').length, 2, 'the unauthorized reads never left');
});

test('a resource the server lists but cannot read is an error, and a blob stays a typed blob', async (t) => {
  const { facade, fake } = setup(t);
  fake.resources.push({ uri: 'mem://gone', name: 'gone' }, { uri: 'mem://blob', name: 'blob' });
  const blob = Buffer.from('bytes').toString('base64');
  fake.contents.set('mem://blob', {
    uri: 'mem://blob',
    mimeType: 'application/octet-stream',
    blob,
  });
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://gone'), {
    code: 'internal',
    message: /Resource not found: mem:\/\/gone/,
  });
  const read = await facade.readResource(operation(), 'srv', 'mem://blob');
  assert.deepEqual(read.contents, [
    { uri: 'mem://blob', blob, mimeType: 'application/octet-stream' },
  ]);
});

test('a server whose resources are not exposed lists none and refuses reads', async (t) => {
  const { facade, fake, connections } = setup(t, {}, false);
  await connections.ensure('srv');
  const connected = fake.requests().length;
  assert.deepEqual(await facade.listResources('srv'), []);
  assert.deepEqual(await facade.listResourceTemplates('srv'), []);
  await assert.rejects(facade.readResource(operation(), 'srv', 'mem://greeting'), {
    code: 'forbidden',
    message: /Resources are not exposed on srv/,
  });
  assert.deepEqual(fake.requests().slice(connected), [], 'the server was not asked anything');
});
