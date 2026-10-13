import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { createSyntheticSourceInfo, ExtensionRunner } from '@earendil-works/pi-coding-agent';
import {
  CancelRunResponseSchema,
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  isActiveStatus,
  parse,
  QueueStateSchema,
  ReplaceQueueResponseSchema,
  RunStatusDataSchema,
  TaskSummaryResponseSchema,
  type QueueState,
  type ServiceEvent,
  type TaskRun,
} from '@atd/agent-contracts';
import { fakeModelServer } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

/**
 * What the user queues while a lite command run answers (tasks/held-queue.ts) on the real service
 * and a fake model: the lite session never sees it; the task shows it as its queue and edits it as
 * usual; once the lite run completes, the first message starts the task's next run in the full
 * session, which takes the rest as its follow-ups; Stop withdraws and returns it instead.
 */

const replies: string[] = [];
/** The next request waits until the test opens it, so messages can be queued meanwhile. */
let gate: { reached: () => void; opened: Promise<void> } | null = null;
const model = await fakeModelServer(async () => {
  const held = gate;
  gate = null;
  if (held) {
    held.reached();
    await held.opened;
  }
  return replies.shift() ?? 'Done.';
});
process.env.AI_AGENT_TEMP_API_KEY = 'lite-queue-test';
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

function holdNextRequest(): { reached: Promise<void>; open: () => void } {
  let reached!: () => void;
  let open!: () => void;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  gate = { reached, opened: new Promise<void>((resolve) => (open = resolve)) };
  return { reached: arrived, open };
}

async function post(pathname: string, body: unknown): Promise<unknown> {
  const response = await harness.call(pathname, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function plainInput(text: string) {
  const capturedAt = new Date().toISOString();
  const empty = { selection: '', clipboard: '', files: [], arguments: {}, chips: [], folders: [] };
  return { text, source: 'manual', capturedAt, ...empty };
}

/** Starts a plain command's run in a new task without waiting for it; its request is held. */
async function startLiteRun(name: string) {
  const created = await post('/v1/commands', {
    name,
    instructions: `${name} {{input}}.`,
    tools: [],
  });
  const { command } = parse(CommandGetResponseSchema, created);
  const held = holdNextRequest();
  const input = plainInput('good morning');
  const accepted = parse(
    CommandRunResponseSchema,
    await post(`/v1/commands/${command.id}/run`, { operationId: randomUUID(), input }),
  );
  await held.reached;
  return { ...accepted, open: held.open };
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    assert.ok(Date.now() < deadline, `${what} within 10 s`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function settledRun(taskId: string, index: number): Promise<TaskRun> {
  return until(() => {
    const run = harness.service.ledger.task(taskId).runs[index];
    return run && !isActiveStatus(run.status) ? run : undefined;
  }, `run ${index} ended`);
}

async function shownQueue(taskId: string): Promise<QueueState> {
  const response = await harness.call(`/v1/tasks/${taskId}/summary`);
  return parse(TaskSummaryResponseSchema, await response.json()).summary.queue;
}

function lastQueueUpdate(taskId: string): QueueState | undefined {
  const update = events.findLast(
    (event) => event.taskId === taskId && event.type === 'queue.update',
  );
  return update && parse(QueueStateSchema, update.data);
}

/** The user prompts of the run requests sent since `sent`, without memory reviews. */
function runPrompts(sent: number): string[] {
  return model.prompts
    .slice(sent)
    .filter((_, index) => !model.bodies[sent + index]?.includes('You review a conversation'));
}

/** The tool names a request body declares. */
function declaredTools(body: string): string[] {
  const tools = (JSON.parse(body) as { tools?: { function?: { name?: string } }[] }).tools ?? [];
  return tools.map((tool) => tool.function?.name ?? '');
}

test('messages queued during a lite run are answered by the full session after it', async () => {
  const sent = model.bodies.length;
  const lite = await startLiteRun('Translate');
  const queue = `/v1/tasks/${lite.taskId}/queue`;
  await post(queue, { text: 'Now in Spanish.', mode: 'followUp' });
  // A steer has nothing to steer in a lite run: it waits as a follow-up.
  await post(queue, { text: 'Keep it short.', mode: 'steer' });
  const kept = { steering: [], followUp: ['Now in Spanish.', 'Keep it short.'] };
  assert.deepEqual(await shownQueue(lite.taskId), kept);
  assert.deepEqual(lastQueueUpdate(lite.taskId), kept);
  const reordered = { steering: [], followUp: ['Keep it short.', 'Now in Spanish.'] };
  const replaced = await post(`${queue}/replace`, { followUp: reordered.followUp });
  assert.deepEqual(parse(ReplaceQueueResponseSchema, replaced).queue, reordered);
  assert.deepEqual(lastQueueUpdate(lite.taskId), reordered);

  replies.push('Bonjour.', 'Short.', 'Hola.');
  lite.open();
  const first = await settledRun(lite.taskId, 0);
  assert.equal(first.status, 'completed', first.error);
  assert.equal(first.snapshot.lite, true);
  const next = await settledRun(lite.taskId, 1);
  assert.equal(next.status, 'completed', next.error);
  assert.equal(next.snapshot.lite, undefined, 'the kept message runs as a normal run');
  assert.equal(next.snapshot.input.text, 'Keep it short.');
  assert.equal(harness.service.ledger.task(lite.taskId).runs.length, 2, 'one run takes them all');

  // The memory review of the full run, once the task idles, is not one of the run's requests.
  const runRequests = model.bodies
    .map((body, index) => ({ body, prompt: model.prompts[index] }))
    .slice(sent)
    .filter(({ body }) => !body.includes('You review a conversation'));
  const bodies = runRequests.map(({ body }) => body);
  assert.equal(bodies.length, 3, 'the lite answer, then the next run’s prompt and follow-up');
  const [liteBody = '', ...fullBodies] = bodies;
  assert.deepEqual(declaredTools(liteBody), []);
  assert.doesNotMatch(liteBody, /Now in Spanish|Keep it short/, 'the lite session never sees them');
  for (const body of fullBodies) {
    assert.ok(declaredTools(body).includes('ask_user'), 'the full session declares its tools');
    assert.match(body, FULL_PROMPT);
    assert.match(body, /Bonjour\./, 'the full session continues the lite run’s conversation');
  }
  assert.deepEqual(
    runRequests.map(({ prompt }) => prompt),
    ['Translate good morning.', 'Keep it short.', 'Now in Spanish.'],
  );
  assert.deepEqual(await shownQueue(lite.taskId), { steering: [], followUp: [] });
});

test('Stop during a lite run returns its kept messages and starts nothing', async () => {
  const sent = model.bodies.length;
  const lite = await startLiteRun('Summarize');
  await post(`/v1/tasks/${lite.taskId}/queue`, { text: 'Never mind.', mode: 'followUp' });
  const cancelled = parse(
    CancelRunResponseSchema,
    await post(`/v1/tasks/${lite.taskId}/runs/${lite.runId}/cancel`, {}),
  );
  assert.deepEqual(cancelled.unsent, { steering: [], followUp: ['Never mind.'] });
  lite.open();
  const run = await settledRun(lite.taskId, 0);
  assert.equal(run.status, 'stopped');
  assert.deepEqual(await shownQueue(lite.taskId), { steering: [], followUp: [] });
  assert.deepEqual(lastQueueUpdate(lite.taskId), { steering: [], followUp: [] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(harness.service.ledger.task(lite.taskId).runs.length, 1);
  assert.equal(model.bodies.length, sent + 1, 'no request after the stopped lite one');
});

test('a message sent as the lite run completes waits behind the kept ones', async () => {
  const sent = model.prompts.length;
  const lite = await startLiteRun('Rephrase');
  const queue = `/v1/tasks/${lite.taskId}/queue`;
  await post(queue, { text: 'Now in Spanish.', mode: 'followUp' });
  await post(queue, { text: 'Keep it short.', mode: 'followUp' });
  // The moment the lite run is seen to end, the user sends a message both ways.
  let seen: { runs: TaskRun[]; submitted: Promise<Response>; queued: Promise<Response> } | null =
    null;
  const unsubscribe = harness.service.events.onPublish((event) => {
    if (event.runId !== lite.runId || event.type !== 'run.status') return;
    if (parse(RunStatusDataSchema, event.data).status !== 'completed') return;
    const submit = { operationId: randomUUID(), taskId: lite.taskId, input: plainInput('Jump.') };
    seen = {
      runs: structuredClone(harness.service.ledger.task(lite.taskId).runs),
      submitted: harness.call('/v1/tasks', { method: 'POST', body: JSON.stringify(submit) }),
      queued: harness.call(queue, {
        method: 'POST',
        body: JSON.stringify({ text: 'And Italian.', mode: 'followUp' }),
      }),
    };
  });
  try {
    lite.open();
    const at = await until(() => seen ?? undefined, 'the lite run completed');
    assert.equal(at.runs.length, 2, 'the kept message’s run is accepted before the lite run ends');
    assert.equal(at.runs[1]?.status, 'queued');
    assert.equal(at.runs[1]?.snapshot.input.text, 'Now in Spanish.');
    assert.equal((await at.submitted).status, 409, 'a new run cannot overtake the kept messages');
    assert.equal((await at.queued).status, 200, await (await at.queued).clone().text());
  } finally {
    unsubscribe();
  }
  const next = await settledRun(lite.taskId, 1);
  assert.equal(next.status, 'completed', next.error);
  assert.equal(harness.service.ledger.task(lite.taskId).runs.length, 2);
  assert.deepEqual(runPrompts(sent), [
    'Rephrase good morning.',
    'Now in Spanish.',
    'Keep it short.',
    'And Italian.',
  ]);
});

test('a kept extension command reaches the model as a run’s prompt', async () => {
  // No extension of the service registers a command, so the test gives every session `/deploy`.
  const sourceInfo = createSyntheticSourceInfo('test:deploy', { source: 'test' });
  const deploy = { name: 'deploy', invocationName: 'deploy', sourceInfo, handler: async () => {} };
  const getCommand = mock.method(ExtensionRunner.prototype, 'getCommand', (name: string) =>
    name === deploy.name ? deploy : undefined,
  );
  try {
    const sent = model.prompts.length;
    const lite = await startLiteRun('Fix');
    const queue = `/v1/tasks/${lite.taskId}/queue`;
    for (const text of ['Keep it short.', '/deploy now', 'Thanks.'])
      await post(queue, { text, mode: 'followUp' });
    lite.open();
    for (const index of [0, 1, 2]) {
      const run = await settledRun(lite.taskId, index);
      assert.equal(run.status, 'completed', run.error);
    }
    const runs = harness.service.ledger.task(lite.taskId).runs;
    assert.deepEqual(
      runs.slice(1).map((run) => run.snapshot.input.text),
      ['Keep it short.', '/deploy now'],
      'the command waits to be a run’s prompt; the message after it follows that run',
    );
    assert.deepEqual(runPrompts(sent), [
      'Fix good morning.',
      'Keep it short.',
      '/deploy now',
      'Thanks.',
    ]);
    assert.deepEqual(await shownQueue(lite.taskId), { steering: [], followUp: [] });
  } finally {
    getCommand.mock.restore();
  }
});
