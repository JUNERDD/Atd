import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  DEFAULT_RUN_TOOLS,
  isActiveStatus,
  parse,
  SubmitTaskResponseSchema,
  type AgentTask,
  type CommandCreate,
  type FileRef,
  type SubmitTaskRequest,
} from '@atd/agent-contracts';
import { screenshotTaskInstruction } from '../dist/commands/output-instruction.js';
import { ConnectionStore } from '../dist/credentials/connections.js';
import { ResourceStore } from '../dist/resources.js';
import { requestedOptions } from '../dist/tasks/submit-options.js';
import { fakeModelServer } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

const selection = '@@p0\nFirst picked paragraph';
const replies: string[] = [];
const model = await fakeModelServer(() => replies.shift() ?? 'Answer.');

let harness: Awaited<ReturnType<typeof startTestService>>;
let connectionId = '';
let contextFile: FileRef;

before(async () => {
  harness = await startTestService();
  await harness.call('/v1/settings', {
    method: 'PATCH',
    body: JSON.stringify({ summaryTitles: false }),
  });
  const provider = await harness.call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai-compatible',
      name: 'Ask test connection',
      baseUrl: model.baseUrl,
      authType: 'none',
      defaultModel: 'gpt-5',
      defaultThinkingLevel: 'max',
      options: {},
      customModels: [
        {
          id: 'gpt-5',
          name: 'GPT-5',
          api: 'openai-completions',
          baseUrl: model.baseUrl,
          reasoning: true,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ],
      credential: null,
    }),
  });
  assert.equal(provider.status, 200, await provider.clone().text());
  connectionId = ((await provider.json()) as { connection: { connectionId: string } }).connection
    .connectionId;
  const connections = await ConnectionStore.load(harness.config.paths.root);
  await connections.change((data) => {
    const conn = data.connections.find((item) => item.connectionId === connectionId);
    if (conn) conn.connected = true;
    data.defaultConnectionId = connectionId;
  });
  const store = new ResourceStore(harness.service.ledger, harness.config.paths);
  const saved = await store.save({
    name: 'Screenshot context.md',
    mime: 'text/markdown',
    bytes: Buffer.from('Window: HIX AI'),
  });
  contextFile = { id: saved.id, name: saved.name, size: saved.size, type: saved.mime };
});

after(async () => {
  await harness.stop();
  await model.close();
});

function baseRequest(
  screenshotText: NonNullable<SubmitTaskRequest['screenshotText']>,
  selected = selection,
  extra: Partial<SubmitTaskRequest> = {},
): SubmitTaskRequest {
  return {
    operationId: randomUUID(),
    input: {
      text: 'Summarize the key dates',
      files: [],
      source: 'selection',
      capturedAt: new Date(0).toISOString(),
      selection: selected,
      clipboard: '',
      arguments: {},
      chips: [],
    },
    screenshotText,
    ...extra,
  };
}

function declaredTools(body: string): string[] {
  const tools = (JSON.parse(body) as { tools?: { function?: { name?: string } }[] }).tools ?? [];
  return tools.map((tool) => tool.function?.name ?? '');
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

async function submitTask(body: Record<string, unknown>) {
  const res = await harness.call('/v1/tasks', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(res.status, 200, await res.clone().text());
  const accepted = parse(SubmitTaskResponseSchema, await res.json());
  return { ...accepted, run: await settled(accepted.taskId, accepted.runId) };
}

test('screenshotTaskInstruction appends selection, relaxes scope:all for targeted asks, and states card text boundary', () => {
  const newAsk = screenshotTaskInstruction(
    { scope: 'picked', paragraphs: 1, output: 'replaceSelection', turn: 'run' },
    selection,
    true,
  );
  assert.ok(newAsk.includes('Your answer replaces the paragraphs on the screenshot.'));
  assert.ok(newAsk.endsWith(`\n\n${selection}`));

  const copyAsk = screenshotTaskInstruction(
    { scope: 'picked', paragraphs: 1, output: 'copy', turn: 'run' },
    selection,
    true,
  );
  assert.ok(copyAsk.includes('copied to the clipboard as is'));
  assert.ok(copyAsk.endsWith(`\n\n${selection}`));

  const repeatCard = screenshotTaskInstruction(
    { scope: 'all', paragraphs: 3, output: 'card', turn: 'run' },
    selection,
    false,
  );
  assert.equal(repeatCard.includes('replaces the paragraphs'), false);
  assert.equal(repeatCard.includes('copied to the clipboard'), false);
  assert.ok(repeatCard.includes('delivered only as text beside the screenshot'));
  assert.ok(repeatCard.includes('answer that request directly without summarizing unrelated'));
  assert.ok(repeatCard.endsWith(`\n\n${selection}`));

  const followUpSame = screenshotTaskInstruction(
    { scope: 'picked', paragraphs: 1, output: 'card', turn: 'followUp' },
    '',
    false,
  );
  assert.equal(followUpSame.includes('@@p0'), false);
  const followUpReread = screenshotTaskInstruction(
    { scope: 'picked', paragraphs: 1, output: 'card', turn: 'followUp' },
    selection,
    false,
  );
  assert.ok(followUpReread.endsWith(`\n\n${selection}`));
});

test('requestedOptions routes eligible inline Ask runs to lite while preserving panel, chip and fromCommand boundaries', () => {
  const inline = requestedOptions(
    baseRequest({ scope: 'picked', paragraphs: 1, output: 'annotate', turn: 'run' }),
    null,
    {},
  );
  assert.ok(inline.instructions?.includes(selection));
  assert.equal(inline.lite, true);

  assert.equal(
    requestedOptions(
      baseRequest({ scope: 'all', paragraphs: 2, output: 'panel', turn: 'run' }),
      null,
      {},
    ).lite,
    undefined,
  );
  assert.equal(
    requestedOptions(
      baseRequest({ scope: 'picked', paragraphs: 1, output: 'card', turn: 'run' }, selection, {
        fromCommand: true,
      }),
      null,
      {},
    ).lite,
    undefined,
  );

  const liteTask = { runs: [{ snapshot: { lite: true } }] } as unknown as AgentTask;
  assert.equal(
    requestedOptions(
      baseRequest({ scope: 'picked', paragraphs: 1, output: 'card', turn: 'followUp' }, ''),
      liteTask,
      {},
    ).lite,
    true,
  );

  const withChip = baseRequest(
    { scope: 'picked', paragraphs: 1, output: 'card', turn: 'followUp' },
    '',
  );
  withChip.input.text = 'q Shorter';
  withChip.input.chips = [{ from: 0, to: 1, chip: { kind: 'quote', text: 'Prior answer' } }];
  assert.equal(requestedOptions(withChip, liteTask, {}).lite, undefined);

  assert.throws(
    () =>
      requestedOptions(
        baseRequest({ scope: 'picked', paragraphs: 1, output: 'card', turn: 'followUp' }),
        null,
        {},
      ),
    /^TypeError: Invalid data: screenshotText followUp/,
  );
  assert.throws(
    () =>
      requestedOptions(
        baseRequest({ scope: 'all', paragraphs: 1, output: 'panel', turn: 'run' }, '   '),
        {} as AgentTask,
        {},
      ),
    /^TypeError: Invalid data: screenshotText run needs selection/,
  );
});

test('inline screenshot-text Ask runs lite with inherited thinking and no resource paths, then restores full tools and thinking in panel', async () => {
  replies.push('First inline answer.', 'Refined inline answer.', 'Panel answer with tools.');
  const firstReq = baseRequest(
    { scope: 'all', paragraphs: 1, output: 'card', turn: 'run' },
    selection,
    { model: { connectionId, modelId: 'gpt-5' } },
  );
  firstReq.input.files = [contextFile];
  const first = await submitTask(firstReq);
  assert.equal(first.run.status, 'completed', first.run.error);
  assert.equal(first.run.snapshot.lite, true);
  assert.equal(first.run.snapshot.thinkingLevel, 'max');
  assert.deepEqual(first.run.snapshot.tools, [...DEFAULT_RUN_TOOLS]);
  const firstBody = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(firstBody), []);
  assert.doesNotMatch(firstBody, /is a saved command the user ran/);
  assert.doesNotMatch(firstBody, /Read-only resource:/);
  assert.match(firstBody, /Window: HIX AI/);

  const secondReq = baseRequest(
    { scope: 'all', paragraphs: 1, output: 'card', turn: 'followUp' },
    '',
    { taskId: first.taskId },
  );
  secondReq.input.text = 'Shorter please';
  const second = await submitTask(secondReq);
  assert.equal(second.run.status, 'completed', second.run.error);
  assert.equal(second.run.snapshot.lite, true);
  assert.equal(second.run.snapshot.thinkingLevel, 'max');
  assert.deepEqual(declaredTools(model.bodies.at(-1) ?? ''), []);
  assert.match(model.bodies.at(-1) ?? '', /First inline answer\./);

  const panel = await submitTask({
    operationId: randomUUID(),
    taskId: first.taskId,
    input: {
      ...firstReq.input,
      source: 'manual',
      text: 'Now inspect with full tools',
      selection: '',
      files: [contextFile],
    },
  });
  assert.equal(panel.run.status, 'completed', panel.run.error);
  assert.equal(panel.run.snapshot.lite, undefined);
  assert.equal(panel.run.snapshot.thinkingLevel, 'max');
  assert.deepEqual(panel.run.snapshot.tools, [...DEFAULT_RUN_TOOLS]);
  const panelBody = model.bodies.at(-1) ?? '';
  const tools = declaredTools(panelBody);
  assert.ok(tools.includes('read') && tools.includes('bash') && tools.includes('ask_user'));
  assert.match(panelBody, /Read-only resource:/);
  assert.match(panelBody, /Refined inline answer\./);
});

test('saved commands on screenshotText take lite only without tokens or tools, while non-screenshotText file runs stay full', async () => {
  const createCmd = async (
    fields: Pick<CommandCreate, 'name' | 'instructions'> & { files?: boolean },
  ) => {
    const { files = false, ...rest } = fields;
    const res = await harness.call('/v1/commands', {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        input: { source: 'selection', required: true, files, selection: true, clipboard: false },
        output: { action: 'card', review: false },
        tools: [],
      }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    return parse(CommandGetResponseSchema, await res.json()).command;
  };
  const runCmd = async (id: string, body: Record<string, unknown>) => {
    const res = await harness.call(`/v1/commands/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ operationId: randomUUID(), ...body }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const accepted = parse(CommandRunResponseSchema, await res.json());
    return settled(accepted.taskId, accepted.runId);
  };
  const plain = await createCmd({ name: 'Explain Shot', instructions: 'Explain {{input}}.' });
  const skilled = await createCmd({
    name: 'Skilled Shot',
    instructions: 'Follow /skill:create-command on {{input}}.',
  });
  const fileCmd = await createCmd({
    name: 'File Shot',
    instructions: 'Check {{input}}.',
    files: true,
  });
  const shot = { scope: 'picked' as const, paragraphs: 1 };
  const shotInput = {
    ...baseRequest({ ...shot, output: 'card' }).input,
    files: [contextFile],
    folders: [],
  };

  replies.push('Plain shot done.', 'Skilled shot done.', 'File run done.');
  const plainRun = await runCmd(plain.id, { input: shotInput, screenshotText: shot });
  assert.equal(plainRun.snapshot.lite, true);
  const plainBody = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(plainBody), []);
  assert.match(plainBody, /is a saved command the user ran/);
  assert.doesNotMatch(plainBody, /Read-only resource:/);

  const skilledRun = await runCmd(skilled.id, { input: shotInput, screenshotText: shot });
  assert.equal(skilledRun.snapshot.lite, undefined);

  const fileRun = await runCmd(fileCmd.id, { input: shotInput });
  assert.equal(fileRun.snapshot.lite, undefined);
});
