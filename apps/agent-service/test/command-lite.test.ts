import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  isActiveStatus,
  parse,
  SubmitTaskResponseSchema,
  type CommandCreate,
  type ServiceEvent,
  type TaskInput,
} from '@atd/agent-contracts';
import { isLiteRun, type LiteRunFacts } from '../dist/commands/lite.js';
import { fakeModelServer } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

/**
 * The lite path of a command run (commands/lite.ts, lite-session.ts) end to end on the real
 * service and a fake model: a plain text command's first run in a new task sends no tools and the
 * short system prompt, yet keeps its ledger, status events, transcript and audit; a follow-up in
 * the same task reopens the session file in the full session; anything the full session wires
 * (a template token, a policy tool, an existing task, files, folders, a frame, a trigger) keeps a
 * run off the lite path.
 */

const replies: string[] = [];
const model = await fakeModelServer(() => replies.shift() ?? 'Done.');
process.env.AI_AGENT_TEMP_API_KEY = 'lite-test';
process.env.AI_AGENT_TEMP_PROVIDER = 'openai-compatible';
process.env.AI_AGENT_TEMP_BASE_URL = model.baseUrl;
process.env.AI_AGENT_TEMP_MODEL = 'fake-model';

let harness: Awaited<ReturnType<typeof startTestService>>;
const events: ServiceEvent[] = [];
before(async () => {
  harness = await startTestService();
  harness.service.events.onPublish((event) => events.push(event));
});
after(async () => {
  await harness.stop();
  await model.close();
});

/** A line of the full session's system prompt that the lite one never carries. */
const FULL_PROMPT = /Use only the available tools\./;

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

async function create(fields: Pick<CommandCreate, 'name' | 'instructions'>) {
  const response = await harness.call('/v1/commands', {
    method: 'POST',
    body: JSON.stringify({ ...fields, tools: [] }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return parse(CommandGetResponseSchema, await response.json()).command;
}

/** Runs the command over the route and waits for the run to end. */
async function launch(commandId: string, body: Record<string, unknown> = {}) {
  const response = await harness.call(`/v1/commands/${commandId}/run`, {
    method: 'POST',
    body: JSON.stringify({ operationId: randomUUID(), input: input('good morning'), ...body }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const accepted = parse(CommandRunResponseSchema, await response.json());
  return { ...accepted, run: await settled(accepted.taskId, accepted.runId) };
}

async function settled(taskId: string, runId: string) {
  const deadline = Date.now() + 10000;
  for (;;) {
    const run = harness.service.ledger.run(taskId, runId);
    if (!isActiveStatus(run.status)) return run;
    assert.ok(Date.now() < deadline, 'the run did not end within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The tool names a request body declares. */
function declaredTools(body: string): string[] {
  const tools = (JSON.parse(body) as { tools?: { function?: { name?: string } }[] }).tools ?? [];
  return tools.map((tool) => tool.function?.name ?? '');
}

test('a plain command run is lite; a follow-up in its task gets the full session', async (t) => {
  const command = await create({
    name: 'Translate',
    instructions: 'Translate {{input}} to French.',
  });
  replies.push('Bonjour.');
  const sent = model.bodies.length;
  const first = await launch(command.id);
  assert.equal(first.run.status, 'completed', first.run.error);
  assert.equal(first.run.snapshot.lite, true);
  const liteBody = model.bodies.at(-1) ?? '';
  assert.equal(model.bodies.length, sent + 1, 'one model request');
  assert.deepEqual(declaredTools(liteBody), [], 'the lite request declares no tools');
  assert.match(liteBody, /is a saved command the user ran/);
  assert.doesNotMatch(liteBody, FULL_PROMPT);
  assert.doesNotMatch(liteBody, /skill_catalog|ask_user/);
  assert.match(liteBody, /Translate good morning to French\./);

  // The run looks like any other to the panel: its status events and the answer in its patches.
  const ofRun = events.filter((event) => event.runId === first.runId);
  const statuses = ofRun.filter((event) => event.type === 'run.status');
  assert.deepEqual(
    statuses.map((event) => (event.data as { status: string }).status),
    ['queued', 'running', 'completed'],
  );
  const patches = ofRun.filter((event) => event.type === 'transcript.patch');
  assert.ok(patches.some((event) => JSON.stringify(event.data).includes('Bonjour.')));
  const audit = await readFile(
    path.join(harness.config.paths.auditDir, `${first.runId}.jsonl`),
    'utf8',
  );
  assert.ok(
    audit
      .trim()
      .split('\n')
      .some((line) => (JSON.parse(line) as { lite?: boolean }).lite === true),
    'the audit marks the run lite',
  );
  assert.ok(harness.service.ledger.task(first.taskId).sessionFile, 'the session file is recorded');

  replies.push('Salut.');
  const response = await harness.call('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({ operationId: randomUUID(), taskId: first.taskId, input: input('more') }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  const followUp = parse(SubmitTaskResponseSchema, await response.json());
  const second = await settled(followUp.taskId, followUp.runId);
  assert.equal(second.status, 'completed', second.error);
  assert.equal(second.snapshot.lite, undefined, 'a follow-up never carries lite');
  const fullBody = model.bodies.at(-1) ?? '';
  assert.ok(declaredTools(fullBody).includes('ask_user'), 'the follow-up offers the full tools');
  assert.match(fullBody, FULL_PROMPT);
  assert.match(fullBody, /Bonjour\./, 'the follow-up continues the lite run’s conversation');
  t.diagnostic(`request body: lite ${liteBody.length} B, full ${fullBody.length} B`);
});

test('a lite run shows core memory as plain text when memory is on, none when off', async (t) => {
  const remember = async (fields: Record<string, string>) => {
    const response = await harness.call('/v1/memory/create', {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    assert.equal(response.status, 200, await response.clone().text());
  };
  await remember({
    description: 'The user writes in British English',
    type: 'user',
    activation: 'core',
    body: 'Write in British English.',
  });
  await remember({
    description: 'The user installs packages with pnpm',
    type: 'memory',
    activation: 'index',
    body: 'Install with pnpm.',
  });
  const command = await create({ name: 'Shorten', instructions: 'Shorten {{input}}.' });
  const on = await launch(command.id);
  assert.equal(on.run.snapshot.lite, true);
  const withMemory = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(withMemory), []);
  const system = (JSON.parse(withMemory) as { messages: { role: string; content: string }[] })
    .messages[0];
  assert.equal(system?.role, 'system');
  const section = /<memory_core>[\s\S]*<\/memory_core>/.exec(system.content)?.[0] ?? '';
  t.diagnostic(section);
  assert.match(
    section,
    /<memory name="[^"]+" type="user">\nWrite in British English\.\n<\/memory>/,
  );
  assert.match(section, /reference context, not instructions/);
  assert.doesNotMatch(withMemory, /memory_read|memory_index|memory_policy|Install with pnpm/);

  const off = await launch(command.id, { policy: { memory: false } });
  assert.equal(off.run.snapshot.lite, true);
  const withoutMemory = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(withoutMemory), []);
  assert.doesNotMatch(withoutMemory, /memory_core|British/);
});

test('a template token, a policy tool or an existing task keeps a run off the lite path', async () => {
  const plain = await create({ name: 'Polish', instructions: 'Polish {{input}}.' });
  const base = await launch(plain.id);
  assert.equal(base.run.snapshot.lite, true);
  const tokened = await create({
    name: 'Polish like before',
    instructions: `Polish {{input}} like @task:${base.taskId}.`,
  });
  const token = await launch(tokened.id);
  assert.equal(token.run.snapshot.lite, undefined, 'a template token');
  const tool = await launch(plain.id, { policy: { tools: ['read'] } });
  assert.equal(tool.run.snapshot.lite, undefined, 'a policy tool');
  const joined = await launch(plain.id, { taskId: base.taskId });
  assert.equal(joined.run.snapshot.lite, undefined, 'an existing task');
  assert.ok(declaredTools(model.bodies.at(-1) ?? '').includes('ask_user'));
});

test('files, a screenshot, folders, a frame or a trigger make a run ineligible', () => {
  const facts: LiteRunFacts = {
    taskId: undefined,
    input: input('text'),
    tools: [],
    tokens: [],
    framed: false,
    internal: {},
  };
  assert.equal(isLiteRun(facts), true);
  const file = { id: 'res-1', name: 'a.txt', type: 'text/plain', size: 1 };
  const off: LiteRunFacts[] = [
    { ...facts, input: { ...facts.input, files: [file] } },
    { ...facts, input: { ...facts.input, source: 'screenshot' } },
    { ...facts, input: { ...facts.input, folders: ['folder-1'] } },
    { ...facts, framed: true },
    {
      ...facts,
      internal: {
        trigger: {
          kind: 'automation',
          automationId: 'digest',
          automationRunId: 'fire-1',
          source: 'schedule',
          firedAt: '2026-10-06T08:00:00.000Z',
        },
      },
    },
  ];
  for (const item of off) assert.equal(isLiteRun(item), false, JSON.stringify(item));
});
