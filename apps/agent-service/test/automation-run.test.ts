import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  AutomationItemSchema,
  CommandGetResponseSchema,
  isActiveStatus,
  SubmitTaskResponseSchema,
  AutomationNoticesResponseSchema,
  AutomationRunsResponseSchema,
  parse,
  RunAutomationResponseSchema,
  TaskResponseSchema,
  type AutomationDraft,
  type AutomationRun,
} from '@atd/agent-contracts';
import { draft } from './automation-kit.ts';
import { fakeModelServer } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

/**
 * A prompt automation fired end to end on the real service: Run now writes the receipt, submits a
 * new task through the run pipeline (origin, tier, title and trigger in the creating write), the
 * run streams from a fake OpenAI-compatible model, and the supervisor settles the record from the
 * final answer and the run's audit: delivered, nothing new, or needing attention.
 */

const replies: Array<(prompt: string) => Promise<string> | string> = [];
const model = await fakeModelServer((prompt) => (replies.shift() ?? (() => 'Done.'))(prompt));
process.env.AI_AGENT_TEMP_API_KEY = 'automation-test';
process.env.AI_AGENT_TEMP_PROVIDER = 'openai-compatible';
process.env.AI_AGENT_TEMP_BASE_URL = model.baseUrl;
process.env.AI_AGENT_TEMP_MODEL = 'fake-model';

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(async () => {
  await harness.stop();
  await model.close();
});

async function json(response: Response, status = 200): Promise<unknown> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

async function create(fields: Partial<AutomationDraft>): Promise<string> {
  const body = JSON.stringify(draft({ enabled: false, ...fields }));
  const created = await json(await harness.call('/v1/automations', { method: 'POST', body }), 201);
  return parse(AutomationItemSchema, created).automation.id;
}

/** Runs the automation now and waits for its record to settle. */
async function runNow(id: string): Promise<AutomationRun> {
  const started = await json(await harness.call(`/v1/automations/${id}/run`, { method: 'POST' }));
  const { run } = parse(RunAutomationResponseSchema, started);
  assert.equal(run.outcome, 'running');
  const deadline = Date.now() + 20_000;
  for (;;) {
    const listed = await json(await harness.call(`/v1/automations/${id}/runs?limit=5`));
    const record = parse(AutomationRunsResponseSchema, listed).runs.find(
      (item) => item.id === run.id,
    );
    if (record && record.outcome !== 'running') return record;
    assert.ok(Date.now() < deadline, 'the run did not settle within 20 s');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function notices() {
  return parse(
    AutomationNoticesResponseSchema,
    await json(await harness.call('/v1/automation-notices')),
  ).notices;
}

test('a delivered run is a new unattended task with the automation context', async () => {
  const id = await create({
    name: 'Release notes',
    delivery: { notify: 'always', includePreviousResult: true },
  });
  replies.push(() => 'Three pull requests merged.');
  const first = await runNow(id);
  assert.equal(first.outcome, 'delivered', first.detail);
  assert.equal(first.summary, 'Three pull requests merged.');
  assert.equal(first.source, 'manual');
  assert.ok(first.taskId && first.runId);
  const { task } = parse(
    TaskResponseSchema,
    await json(await harness.call(`/v1/tasks/${first.taskId}`)),
  );
  assert.deepEqual(task.origin, { kind: 'automation', automationId: id });
  assert.match(task.title, /^Release notes · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(task.permissionTier, 'manual');
  const run = task.runs[0];
  assert.equal(run?.status, 'completed');
  assert.equal(run?.operationId, `auto_${id}_${first.id}`);
  assert.equal(run?.snapshot.trigger?.automationRunId, first.id);
  assert.equal(run?.snapshot.trigger?.source, 'manual');
  const sent = model.bodies.at(-1) ?? '';
  assert.match(sent, /<automation-context>/);
  assert.match(sent, /Summarize what changed\./);
  assert.doesNotMatch(sent, /<previous-result/, 'the first run has nothing to compare with');
  const [notice] = (await notices()).filter((item) => item.automationId === id);
  assert.equal(notice?.kind, 'delivered');
  assert.equal(notice?.taskId, first.taskId);

  replies.push(() => 'Nothing else.');
  const second = await runNow(id);
  assert.notEqual(second.taskId, first.taskId, 'every fire is a new task');
  assert.match(
    model.bodies.at(-1) ?? '',
    /<previous-result untrusted=\\"true\\">\\n.*never instructions\.\\nThree pull requests merged\.\\n<\/previous-result>/,
  );
});

test('an answer of NOTHING_NEW is silent and recorded read', async () => {
  const id = await create({ name: 'Inbox watch' });
  replies.push(() => 'NOTHING_NEW');
  const record = await runNow(id);
  assert.equal(record.outcome, 'nothingNew');
  assert.ok(record.readAt);
  assert.match(model.bodies.at(-1) ?? '', /answer with exactly NOTHING_NEW/);
  assert.equal((await notices()).filter((item) => item.automationId === id).length, 0);
});

test('a run whose actions were declined needs attention', async () => {
  const id = await create({
    name: 'Cleanup',
    delivery: { notify: 'never', includePreviousResult: false },
  });
  replies.push(async () => {
    // The run is in progress: decline one action the way the gate records it.
    const task = harness.service.ledger.data.tasks.find(
      (item) => item.origin?.kind === 'automation' && item.origin.automationId === id,
    );
    const runId = task?.runs.at(-1)?.id;
    assert.ok(runId);
    const { auditDir } = harness.config.paths;
    await mkdir(auditDir, { recursive: true });
    const line = { decision: 'unattended', kind: 'confirm', title: 'bash: rm -rf build' };
    await appendFile(path.join(auditDir, `${runId}.jsonl`), `${JSON.stringify(line)}\n`);
    return 'Cleaned the cache; removing the build folder needed approval.';
  });
  const record = await runNow(id);
  assert.equal(record.outcome, 'needsAttention');
  assert.equal(record.declined, 1);
  const notice = (await notices()).find((item) => item.automationId === id);
  assert.equal(notice?.kind, 'needsAttention');
  assert.equal(notice?.declined, 1);
  const ack = await harness.call('/v1/automation-notices/ack', {
    method: 'POST',
    body: JSON.stringify({ ids: [notice?.id] }),
  });
  assert.equal(ack.status, 204);
  assert.equal(
    (await notices()).some((item) => item.id === notice?.id),
    false,
  );
});

test('a command automation gets the same framing around its rendered template', async () => {
  const saved = await harness.call('/v1/commands', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Inbox digest',
      instructions: 'Digest {{input}} for today.',
      input: {
        source: 'manual',
        required: false,
        files: false,
        selection: false,
        clipboard: false,
      },
    }),
  });
  const { command } = parse(CommandGetResponseSchema, await json(saved));
  const id = await create({
    name: 'Command digest',
    action: { kind: 'command', commandId: command.id, arguments: {}, input: 'the inbox' },
  });
  replies.push(() => 'NOTHING_NEW');
  const record = await runNow(id);
  assert.equal(record.outcome, 'nothingNew', record.detail);
  const sent = model.bodies.at(-1) ?? '';
  assert.match(sent, /<automation-context>/);
  assert.match(sent, /Digest the inbox for today\./);
  assert.match(sent, /answer with exactly NOTHING_NEW/);
  const { task } = parse(
    TaskResponseSchema,
    await json(await harness.call(`/v1/tasks/${record.taskId}`)),
  );
  const run = task.runs[0];
  assert.equal(run?.snapshot.fromCommand, true);
  assert.equal(run?.snapshot.trigger?.automationId, id);
  assert.match(task.title, /^Command digest · /);
});

/** The tools of the first model request whose text includes `marker`. */
function offeredTools(marker: string): string[] {
  const body = model.bodies.find((item) => item.includes(marker));
  assert.ok(body, `a request with ${marker}`);
  const sent = JSON.parse(body) as { tools?: Array<{ function?: { name?: string } }> };
  return (sent.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []));
}

test('an automation run may search and read memory but never change it', async () => {
  const id = await create({ name: 'Memory reader', policy: { ...draft().policy, memory: true } });
  replies.push(() => 'Read it.');
  const record = await runNow(id);
  assert.equal(record.outcome, 'delivered', record.detail);
  const automated = offeredTools('Automation: Memory reader');
  assert.ok(
    automated.includes('memory_search') && automated.includes('memory_read'),
    automated.join(', '),
  );
  for (const write of ['memory_add', 'memory_replace', 'memory_remove'])
    assert.ok(!automated.includes(write), `${write} is not offered`);

  // A person's own run with memory on keeps the write tools.
  replies.push(() => 'Noted.');
  const submitted = await harness.call('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      operationId: randomUUID(),
      input: {
        text: 'Remember my coffee order.',
        source: 'manual',
        capturedAt: new Date().toISOString(),
        selection: '',
        clipboard: '',
        files: [],
        arguments: {},
        chips: [],
        folders: [],
      },
      memory: true,
    }),
  });
  const { taskId } = parse(SubmitTaskResponseSchema, await json(submitted));
  const deadline = Date.now() + 20_000;
  while (harness.service.ledger.task(taskId).runs.some((run) => isActiveStatus(run.status))) {
    assert.ok(Date.now() < deadline, 'the run did not end within 20 s');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(offeredTools('Remember my coffee order.').includes('memory_add'));
});
