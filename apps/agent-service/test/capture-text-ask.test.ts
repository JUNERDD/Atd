import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  CAPTURE_ANSWER_TOOL,
  CommandGetResponseSchema,
  CommandRunResponseSchema,
  DEFAULT_RUN_TOOLS,
  isActiveStatus,
  parse,
  SubmitTaskResponseSchema,
  type AgentTask,
  type CommandCreate,
  type FileRef,
  type ScreenshotTextFollowUp,
  type SubmitTaskRequest,
} from '@atd/agent-contracts';
import { screenshotTaskInstruction } from '../dist/commands/output-instruction.js';
import { ConnectionStore } from '../dist/credentials/connections.js';
import { ResourceStore } from '../dist/resources.js';
import { requestedOptions } from '../dist/tasks/submit-options.js';
import { fakeModelServer } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

const selection = '[p0 @ 10,20,300,60]\nFirst picked paragraph';
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

const baseRequest = (
  screenshotText: NonNullable<SubmitTaskRequest['screenshotText']>,
  selected = selection,
  extra: Partial<SubmitTaskRequest> = {},
): SubmitTaskRequest => ({
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
});

const declaredTools = (body: string): string[] =>
  ((JSON.parse(body) as { tools?: { function?: { name?: string } }[] }).tools ?? []).map(
    (tool) => tool.function?.name ?? '',
  );

async function settled(taskId: string, runId: string) {
  const deadline = Date.now() + 20000;
  for (;;) {
    const run = harness.service.ledger.run(taskId, runId);
    if (!isActiveStatus(run.status)) return run;
    assert.ok(Date.now() < deadline, 'the run did not end within 20 s');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function submitTask(body: Record<string, unknown>) {
  const res = await harness.call('/v1/tasks', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(res.status, 200, await res.clone().text());
  const accepted = parse(SubmitTaskResponseSchema, await res.json());
  return { ...accepted, run: await settled(accepted.taskId, accepted.runId) };
}

const st = (
  output: ScreenshotTextFollowUp['output'],
  scope: ScreenshotTextFollowUp['scope'] = 'picked',
  paragraphs = 1,
  turn: ScreenshotTextFollowUp['turn'] = 'run',
): ScreenshotTextFollowUp => ({ scope, paragraphs, output, turn });

const inst = (s: ScreenshotTextFollowUp, sel = selection, isNew = s.turn === 'run') =>
  screenshotTaskInstruction(s, sel, isNew);

test('screenshotTaskInstruction appends selection, relaxes scope:all for targeted asks, and states card text boundary', () => {
  const newAsk = inst(st('replaceSelection'));
  assert.ok(newAsk.includes('Your answer replaces the paragraphs on the screenshot.'));
  assert.ok(newAsk.includes(CAPTURE_ANSWER_TOOL) && newAsk.includes('[<id> @ x1,y1,x2,y2]'));
  assert.equal(newAsk.includes('@@'), false);
  assert.ok(newAsk.endsWith(`\n\n${selection}`));

  const copyAsk = inst(st('copy'));
  assert.ok(
    copyAsk.includes('copied to the clipboard as is') && copyAsk.endsWith(`\n\n${selection}`),
  );

  const repeatCard = inst(st('card', 'all', 3), selection, false);
  assert.equal(repeatCard.includes('replaces the paragraphs'), false);
  assert.equal(repeatCard.includes('copied to the clipboard'), false);
  assert.ok(repeatCard.includes('delivered only as text beside the screenshot'));
  assert.ok(
    repeatCard.includes('answer that request directly without summarizing unrelated') &&
      repeatCard.endsWith(`\n\n${selection}`),
  );

  assert.equal(inst(st('card', 'picked', 1, 'followUp'), '').includes('[p0'), false);
  assert.ok(inst(st('card', 'picked', 1, 'followUp')).endsWith(`\n\n${selection}`));
});

test('requestedOptions routes eligible inline Ask runs to lite while preserving panel, chip and fromCommand boundaries', () => {
  const opts = (
    shotText: ScreenshotTextFollowUp,
    prev: AgentTask | null = null,
    sel = selection,
    extra: Partial<SubmitTaskRequest> = {},
  ) => requestedOptions(baseRequest(shotText, sel, extra), prev, {});

  const inline = opts(st('annotate'));
  assert.ok(inline.instructions?.includes(selection));
  assert.equal(inline.lite, true);
  assert.equal(inline.captureOutput, 'annotate');
  assert.equal(inline.fromCapture, true);
  assert.equal(opts(st('card')).captureOutput, undefined);
  assert.equal(opts(st('panel', 'all', 2)).lite, undefined);
  assert.equal(opts(st('card'), null, selection, { fromCommand: true }).lite, undefined);

  const liteTask = { runs: [{ snapshot: { lite: true } }] } as unknown as AgentTask;
  assert.equal(opts(st('card', 'picked', 1, 'followUp'), liteTask, '').lite, true);

  const withChip = baseRequest(st('card', 'picked', 1, 'followUp'), '');
  withChip.input.text = 'q Shorter';
  withChip.input.chips = [{ from: 0, to: 1, chip: { kind: 'quote', text: 'Prior answer' } }];
  assert.equal(requestedOptions(withChip, liteTask, {}).lite, undefined);

  assert.throws(
    () => opts(st('card', 'picked', 1, 'followUp')),
    /^TypeError: Invalid data: screenshotText followUp/,
  );
  assert.throws(
    () => opts(st('panel', 'all'), {} as AgentTask, '   '),
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
  assert.equal(first.run.snapshot.captureOutput, undefined);
  assert.equal(first.run.snapshot.thinkingLevel, 'max');
  assert.deepEqual(first.run.snapshot.tools, [...DEFAULT_RUN_TOOLS]);
  const firstBody = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(firstBody), []);
  assert.doesNotMatch(firstBody, /is a saved command the user ran|Read-only resource:/);
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
  assert.equal(tools.includes(CAPTURE_ANSWER_TOOL), false);
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

  replies.push(
    'Plain shot done.',
    'Skilled shot done.',
    'File run done.',
    'Translated shot done.',
    'Translated text done.',
  );
  const plainRun = await runCmd(plain.id, { input: shotInput, screenshotText: shot });
  assert.equal(plainRun.snapshot.lite, true);
  assert.equal(plainRun.snapshot.captureOutput, undefined);
  assert.equal(plainRun.snapshot.fromCapture, true);
  const plainBody = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(plainBody), []);
  assert.match(plainBody, /is a saved command the user ran/);
  assert.doesNotMatch(plainBody, /Read-only resource:/);

  assert.equal(
    (await runCmd(skilled.id, { input: shotInput, screenshotText: shot })).snapshot.lite,
    undefined,
  );
  assert.equal((await runCmd(fileCmd.id, { input: shotInput })).snapshot.lite, undefined);

  const translateCmd = await createCmd({ name: 'Translate', instructions: 'Translate {{input}}.' });
  const shotTranslate = await runCmd(translateCmd.id, {
    input: { ...shotInput, text: 'UniqueCaptureSearchToken', files: [] },
    screenshotText: shot,
  });
  const textTranslate = await runCmd(translateCmd.id, {
    input: { ...shotInput, text: 'UniqueCaptureSearchToken', files: [] },
  });
  assert.equal(shotTranslate.snapshot.fromCapture, true);
  assert.equal(shotTranslate.snapshot.fromCommand, true);
  assert.equal(textTranslate.snapshot.fromCapture, undefined);

  const searchIds = async (qs: string) => {
    const res = await harness.call(`/v1/tasks/search?${qs}`);
    assert.equal(res.status, 200, await res.clone().text());
    return ((await res.json()) as { hits: Array<{ taskId: string }> }).hits.map((h) => h.taskId);
  };
  assert.ok(
    (await searchIds('query=First&captures=only')).length >= 1,
    'captures=only finds Ask-on-screenshot with Screenshot context.md',
  );
  const translateCaptureHits = await searchIds('query=UniqueCaptureSearchToken&captures=only');
  assert.equal(translateCaptureHits.length, 1);
  assert.deepEqual(
    await searchIds('query=UniqueCaptureSearchToken&commands=exclude&captures=all'),
    translateCaptureHits,
  );
});
