import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  isActiveStatus,
  parse,
  type CommandCreate,
  type TaskInput,
} from '@atd/agent-contracts';
import { starterCommands, syncStarterCommands } from '../dist/commands/starters.js';
import { CommandStore } from '../dist/commands/store.js';
import { ConnectionStore } from '../dist/credentials/connections.js';
import { resolvePreview } from '../dist/tasks/preview.js';
import { startTestService } from './service-harness.ts';

/**
 * A command's own reasoning level: commands stored before it existed take the level their fixed
 * model pinned, starters a version 1 seed added get their shipped level unless the user changed
 * them, and a run asks for the level picked for it, else the command's, else the
 * connection's default.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
  const response = await harness.call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      name: 'Thinking fixture',
      baseUrl: '',
      authType: 'api_key',
      defaultModel: 'gpt-4.1',
      options: {},
      customModels: [],
      credential: null,
    }),
  });
  assert.equal(response.status, 200, await response.clone().text());
});
after(() => harness.stop());

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'command-thinking-'));
}

/** A stored command as a build before command levels wrote it. */
function legacy(id: string, model: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const full: Record<string, unknown> = {
    ...CommandStore.storable(CommandStore.compose({ id, name: id, instructions: 'Do {{input}}' })),
    model,
  };
  delete full.thinkingLevel;
  return { ...full, ...extra };
}

test('a stored command takes the level its fixed model pinned, once', async () => {
  const dir = await scratch();
  const fixed = { mode: 'fixed', connectionId: 'c1', modelId: 'm1' };
  await writeFile(
    path.join(dir, 'commands.json'),
    JSON.stringify({
      version: 2,
      commands: [
        legacy('pinned', { ...fixed, thinkingLevel: 'high' }),
        legacy('unpinned', fixed),
        legacy('inherits', { mode: 'inherit' }),
        legacy('both', { ...fixed, thinkingLevel: 'high' }, { thinkingLevel: 'low' }),
      ],
    }),
  );
  const store = await CommandStore.load(dir);
  const levels = store.list().map(({ id, model, thinkingLevel }) => ({ id, model, thinkingLevel }));
  assert.deepEqual(levels, [
    { id: 'pinned', model: fixed, thinkingLevel: 'high' },
    { id: 'unpinned', model: fixed, thinkingLevel: 'inherit' },
    { id: 'inherits', model: { mode: 'inherit' }, thinkingLevel: 'inherit' },
    { id: 'both', model: fixed, thinkingLevel: 'low' },
  ]);
  // Revisions stay, and a write of the converged file loads the same.
  assert.ok(store.list().every((command) => command.revision === 1));
  await store.reorder(store.list().map((command) => command.id));
  assert.deepEqual((await CommandStore.load(dir)).list(), store.list());
  await rm(dir, { recursive: true, force: true });
});

test('an unmodified starter a version 1 seed added gets its shipped level', async () => {
  const dir = await scratch();
  const starters = starterCommands('en').map((draft) =>
    CommandStore.storable(CommandStore.compose(draft)),
  );
  const stored = starters.map((command) => {
    const old: Record<string, unknown> = { ...command };
    delete old.thinkingLevel;
    // The user saved Polish again and rewrote Summarize's instructions without saving twice.
    if (command.id === 'polish') old.revision = 2;
    if (command.id === 'summarize') old.instructions = 'Summarize {{input}} briefly.';
    return old;
  });
  await writeFile(
    path.join(dir, 'commands.json'),
    JSON.stringify({ version: 2, commands: stored }),
  );
  // `explain` was the user's own command before the seed, so the seed did not add it.
  const added = starters.map(({ id }) => id).filter((id) => id !== 'explain');
  const marker = path.join(dir, 'commands-starters.json');
  await writeFile(marker, JSON.stringify({ version: 1, seededAt: '2026-01-01T00:00:00Z', added }));

  await syncStarterCommands(dir, 'en');
  const levels = Object.fromEntries(
    (await CommandStore.load(dir)).list().map((command) => [command.id, command.thinkingLevel]),
  );
  assert.deepEqual(levels, {
    translate: 'off',
    polish: 'inherit',
    summarize: 'inherit',
    explain: 'inherit',
    'action-items': 'off',
    'review-code': 'inherit',
    'summarize-files': 'inherit',
    'ask-screenshot': 'inherit',
  });
  // The seed's record stays as it was.
  const written = JSON.parse(await readFile(marker, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(written, { version: 1, seededAt: '2026-01-01T00:00:00Z', added });

  // A level the user sets back afterwards stays: their save made the starter theirs.
  const store = await CommandStore.load(dir);
  const translate = store.get('translate');
  await store.update('translate', { ...translate, thinkingLevel: 'inherit' }, translate.revision);
  await syncStarterCommands(dir, 'en');
  assert.equal((await CommandStore.load(dir)).get('translate').thinkingLevel, 'inherit');
  await rm(dir, { recursive: true, force: true });
});

test('a fresh seed stores the shipped levels', async () => {
  const dir = await scratch();
  await syncStarterCommands(dir, 'en');
  const store = await CommandStore.load(dir);
  assert.equal(store.get('polish').thinkingLevel, 'off');
  assert.equal(store.get('review-code').thinkingLevel, 'inherit');
  const written = JSON.parse(await readFile(path.join(dir, 'commands-starters.json'), 'utf8'));
  assert.equal((written as { version: number }).version, 2);
  await rm(dir, { recursive: true, force: true });
});

function input(text: string): TaskInput {
  return {
    text,
    source: 'manual',
    capturedAt: new Date().toISOString(),
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
    chips: [],
    folders: [],
  };
}

async function create(fields: CommandCreate) {
  const response = await harness.call('/v1/commands', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return parse(CommandGetResponseSchema, await response.json()).command;
}

test('a run asks for the picked level, else the command’s, else the connection’s', async () => {
  const dataDir = harness.config.paths.root;
  const connections = await ConnectionStore.load(dataDir);
  // The fixture connection, without a key, is not the default until a test makes it so.
  await connections.change((data) => {
    const [connection] = data.connections;
    assert.ok(connection);
    connection.defaultThinkingLevel = 'medium';
    data.defaultConnectionId = connection.connectionId;
  });
  const ctx = { dataDir, ledger: harness.service.ledger };
  const quick = await create({ name: 'Quick', instructions: 'Do {{input}}', thinkingLevel: 'off' });
  const plain = await create({ name: 'Plain', instructions: 'Do {{input}}' });
  assert.equal(plain.thinkingLevel, 'inherit');
  const level = async (commandId: string, picked?: 'high') =>
    (
      await resolvePreview(ctx, {
        input: input('it'),
        commandId,
        ...(picked ? { policy: { thinkingLevel: picked } } : {}),
      })
    ).snapshot.thinkingLevel;
  assert.equal(await level(quick.id), 'off');
  assert.equal(await level(quick.id, 'high'), 'high');
  assert.equal(await level(plain.id), 'medium');

  // The launch freezes what the preview resolves.
  const response = await harness.call(`/v1/commands/${quick.id}/run`, {
    method: 'POST',
    body: JSON.stringify({ operationId: randomUUID(), input: input('it') }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const accepted = parse(CommandRunResponseSchema, await response.json());
  const [run] = harness.service.ledger.task(accepted.taskId).runs;
  assert.equal(run?.snapshot.thinkingLevel, 'off');
  // The run fails without a key; let it end before the service stops.
  const deadline = Date.now() + 10000;
  const ledger = harness.service.ledger;
  while (ledger.task(accepted.taskId).runs.some((item) => isActiveStatus(item.status))) {
    assert.ok(Date.now() < deadline, 'the run did not end within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
});
