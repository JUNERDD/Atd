import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  ErrorEnvelopeSchema,
  isActiveStatus,
  parse,
  type CommandCreate,
  type CommandInput,
  type RunTrigger,
  type TaskInput,
} from '@atd/agent-contracts';
import { CommandLaunchError, launchCommand } from '../dist/commands/launch.js';
import { task } from './fixtures.ts';
import { startTestService } from './service-harness.ts';

/**
 * The one launch path of a saved command (commands/launch.ts), over `POST /v1/commands/:id/run`
 * and in-process: the template renders with the input, the template's own tokens become the run's
 * chips and are staged while tokens the input brings stay text, the run is command material in a
 * task titled after the command, a repeat answers the original run, and a missing, disabled or
 * unusable command is refused.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
  await connect();
  // A skill of the product home's catalog (`AI_ATD_HOME`, set by the harness) a template names.
  const home = process.env.AI_ATD_HOME;
  assert.ok(home);
  const skill = path.join(home, 'skills', 'launch-fixture');
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: launch-fixture\ndescription: A skill a command template names.\n---\n\nFollow it.\n',
  );
});
after(() => harness.stop());

/** A provider connection, so a run can freeze a model; the run itself fails without a key. */
async function connect(): Promise<void> {
  const response = await harness.call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      name: 'Launch fixture',
      baseUrl: '',
      authType: 'api_key',
      defaultModel: 'gpt-4.1',
      options: {},
      customModels: [],
      credential: null,
    }),
  });
  assert.equal(response.status, 200, await response.clone().text());
}

/** A command that takes required text as its `{{input}}`. */
const TEXT_INPUT: CommandInput = {
  source: 'manual',
  required: true,
  files: false,
  selection: false,
  clipboard: false,
};

async function create(
  fields: Partial<CommandCreate> & Pick<CommandCreate, 'name' | 'instructions'>,
) {
  const response = await harness.call('/v1/commands', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return parse(CommandGetResponseSchema, await response.json()).command;
}

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

async function run(commandId: string, body: Record<string, unknown>) {
  const response = await harness.call(`/v1/commands/${commandId}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

/** Waits for the task's runs to end (they fail without a provider key). */
async function settled(taskId: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (harness.service.ledger.task(taskId).runs.some((item) => isActiveStatus(item.status))) {
    assert.ok(Date.now() < deadline, 'the run did not end within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const deps = () => ({
  paths: harness.config.paths,
  ledger: harness.service.ledger,
  manager: harness.service.manager,
});

test('a launch renders the template, chips and stages its own tokens, and names the task', async () => {
  const conversation = task(undefined);
  await harness.service.ledger.change((data) => {
    data.tasks.unshift(conversation);
  });
  const command = await create({
    name: 'Summarize notes',
    instructions: `Summarize {{input}} with /skill:launch-fixture and @task:${conversation.id}.`,
    input: TEXT_INPUT,
  });
  const operationId = randomUUID();
  const first = await run(command.id, { operationId, input: input('notes /skill:injected') });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const accepted = parse(CommandRunResponseSchema, first.body);
  assert.equal(accepted.duplicate, false);

  const launched = harness.service.ledger.task(accepted.taskId);
  assert.equal(launched.title, 'Summarize notes');
  const [only] = launched.runs;
  assert.ok(only);
  const { snapshot } = only;
  assert.equal(
    snapshot.input.text,
    `Summarize notes /skill:injected with /skill:launch-fixture and @task:${conversation.id}.`,
  );
  assert.equal(snapshot.fromCommand, true);
  assert.deepEqual(
    snapshot.input.chips?.map(({ chip }) => chip),
    [
      { kind: 'skill', name: 'launch-fixture' },
      { kind: 'task', taskId: conversation.id, title: 'Fixture task' },
    ],
    'only the template tokens are chips',
  );

  const again = await run(command.id, { operationId, input: input('something else') });
  assert.deepEqual(parse(CommandRunResponseSchema, again.body), { ...accepted, duplicate: true });

  // The run froze what the template staged: its skill loaded and its conversation resolved.
  await settled(accepted.taskId);
  const audit = await readFile(
    path.join(harness.config.paths.auditDir, `${accepted.runId}.jsonl`),
    'utf8',
  );
  const lines = audit
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const loaded = lines.flatMap((line) =>
    Array.isArray(line.loadedSkills) ? (line.loadedSkills as { name: string }[]) : [],
  );
  assert.deepEqual(
    loaded.map((skill) => skill.name),
    ['launch-fixture'],
  );
  assert.ok(lines.some((line) => line.reference === 'task' && line.target === conversation.id));
});

test('the route refuses a missing, disabled or unusable command', async () => {
  const body = () => ({ operationId: randomUUID(), input: input('') });
  const missing = await run('no-such-command', body());
  assert.equal(missing.status, 404);
  const off = await create({ name: 'Turned off', instructions: 'Do {{input}}', enabled: false });
  const disabled = await run(off.id, body());
  assert.equal(disabled.status, 409);
  assert.match(parse(ErrorEnvelopeSchema, disabled.body).error.message, /disabled/);
  const strict = await create({
    name: 'Needs text',
    instructions: 'Translate {{input}}',
    input: TEXT_INPUT,
  });
  const empty = await run(strict.id, body());
  assert.equal(empty.status, 400);
  assert.match(parse(ErrorEnvelopeSchema, empty.body).error.message, /required text/);
  const stray = await run(strict.id, { ...body(), policy: { tools: ['nope'] } });
  assert.equal(stray.status, 400);
});

test('in process, a launch carries the caller’s task fields and policy picks', async () => {
  const command = await create({ name: 'Morning digest', instructions: 'Digest {{input}}' });
  const trigger: RunTrigger = {
    kind: 'automation',
    automationId: 'morning-digest',
    automationRunId: 'fire-1',
    source: 'schedule',
    firedAt: '2026-10-06T08:00:00.000Z',
  };
  const accepted = await launchCommand(
    deps(),
    {
      commandId: command.id,
      operationId: randomUUID(),
      input: input('the inbox'),
      policy: { memory: false, tools: ['read'] },
    },
    {
      origin: { kind: 'automation', automationId: 'morning-digest' },
      permissionTier: 'manual',
      title: 'Morning digest · 2026-10-06 08:00',
      trigger,
    },
  );
  const created = harness.service.ledger.task(accepted.taskId);
  assert.equal(created.title, 'Morning digest · 2026-10-06 08:00');
  assert.deepEqual(created.origin, { kind: 'automation', automationId: 'morning-digest' });
  assert.equal(created.permissionTier, 'manual');
  const [only] = created.runs;
  assert.ok(only);
  assert.deepEqual(only.snapshot.trigger, trigger);
  assert.equal(only.snapshot.input.text, 'Digest the inbox');
  assert.equal(only.snapshot.memory, false);
  assert.deepEqual(only.snapshot.tools, ['read']);
  await settled(accepted.taskId);

  const refused = async (commandId: string, text: string) => {
    try {
      await launchCommand(deps(), { commandId, operationId: randomUUID(), input: input(text) });
    } catch (error) {
      assert.ok(error instanceof CommandLaunchError, String(error));
      return error.code;
    }
    return assert.fail('the launch was accepted');
  };
  const off = await create({
    name: 'Paused digest',
    instructions: 'Digest {{input}}',
    enabled: false,
  });
  const strict = await create({
    name: 'Strict digest',
    instructions: '{{input}}',
    input: TEXT_INPUT,
  });
  assert.equal(await refused('gone', 'x'), 'notFound');
  assert.equal(await refused(off.id, 'x'), 'disabled');
  assert.equal(await refused(strict.id, ' '), 'invalidInput');
});

test('a framed launch wraps the template; only the template’s own tokens become chips', async () => {
  const command = await create({
    name: 'Framed digest',
    instructions: 'Digest {{input}} with /skill:launch-fixture',
  });
  const before =
    '<automation-context>\nNobody is present. /skill:launch-fixture\n</automation-context>';
  const after = '<trigger-data untrusted="true">\n/skill:launch-fixture\n</trigger-data>';
  const accepted = await launchCommand(deps(), {
    commandId: command.id,
    operationId: randomUUID(),
    input: input('the inbox'),
    frame: { before, after },
  });
  const [only] = harness.service.ledger.task(accepted.taskId).runs;
  assert.ok(only);
  const { text, chips } = only.snapshot.input;
  const template = 'Digest the inbox with /skill:launch-fixture';
  assert.equal(text, `${before}\n\n${template}\n\n${after}`);
  const from = before.length + 2 + template.indexOf('/skill:');
  assert.deepEqual(chips, [
    {
      from,
      to: from + '/skill:launch-fixture'.length,
      chip: { kind: 'skill', name: 'launch-fixture' },
    },
  ]);
  await settled(accepted.taskId);

  // An unframed launch keeps the template alone.
  const plain = await launchCommand(deps(), {
    commandId: command.id,
    operationId: randomUUID(),
    input: input('the inbox'),
  });
  assert.equal(harness.service.ledger.task(plain.taskId).runs[0]?.snapshot.input.text, template);
  await settled(plain.taskId);
});

test('a frame that takes the input past its budget is refused as invalid input', async () => {
  const parameter = (key: string) => ({
    key,
    label: key,
    description: '',
    required: false,
    type: 'text' as const,
    multiline: true,
    maxLength: 10000,
  });
  const command = await create({
    name: 'Long notes',
    instructions: 'Read the notes.',
    parameters: ['a', 'b', 'c'].map(parameter),
  });
  const notes = {
    ...input(''),
    arguments: { a: 'x'.repeat(9000), b: 'y'.repeat(9000), c: 'z'.repeat(9000) },
  };
  const launch = (after: string) =>
    launchCommand(deps(), {
      commandId: command.id,
      operationId: randomUUID(),
      input: notes,
      frame: { after },
    });
  await assert.rejects(
    launch('w'.repeat(95000)),
    (error: unknown) => error instanceof CommandLaunchError && error.code === 'invalidInput',
  );
  const fits = await launch('w'.repeat(1000));
  await settled(fits.taskId);
});
