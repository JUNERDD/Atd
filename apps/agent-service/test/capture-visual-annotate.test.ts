import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  CAPTURE_ANSWER_TOOL,
  CommandScreenshotTextSchema,
  isActiveStatus,
  parse,
  SubmitTaskRequestSchema,
  SubmitTaskResponseSchema,
  TaskSnapshotSchema,
  type AgentTask,
  type FileRef,
  type ScreenshotTextFollowUp,
  type SubmitTaskRequest,
} from '@atd/agent-contracts';
import { isLiteRun } from '../dist/commands/lite.js';
import { screenshotTaskInstruction } from '../dist/commands/output-instruction.js';
import { ConnectionStore } from '../dist/credentials/connections.js';
import { ResourceStore } from '../dist/resources.js';
import { requestedOptions } from '../dist/tasks/submit-options.js';
import { isClosedJsonObject, isToolCallStreaming } from '../dist/transcript-tool-streaming.js';
import { fakeModelServer, type FakeReply } from './fake-model-server.ts';
import { startTestService } from './service-harness.ts';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);
const replies: FakeReply[] = [];
const model = await fakeModelServer(() => replies.shift() ?? 'Plain card explanation.');

let harness: Awaited<ReturnType<typeof startTestService>>;
let connectionId = '';
let shotFile1: FileRef;
let shotFile2: FileRef;

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
      name: 'Visual Ask connection',
      baseUrl: model.baseUrl,
      authType: 'none',
      defaultModel: 'gpt-5',
      defaultThinkingLevel: 'medium',
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
  const saveShot = async (name: string): Promise<FileRef> => {
    const s = await store.save({ name, mime: 'image/png', bytes: TINY_PNG });
    return { id: s.id, name: s.name, size: s.size, type: s.mime };
  };
  [shotFile1, shotFile2] = await Promise.all([
    saveShot('capture-1.png'),
    saveShot('capture-2.png'),
  ]);
});

after(async () => {
  await harness.stop();
  await model.close();
});

const st = (
  output: ScreenshotTextFollowUp['output'],
  paragraphs = 0,
  turn: ScreenshotTextFollowUp['turn'] = 'run',
  scope: ScreenshotTextFollowUp['scope'] = 'all',
): ScreenshotTextFollowUp => ({ scope, paragraphs, output, turn });

const makeReq = (
  screenshotText: ScreenshotTextFollowUp,
  selection = '',
  files: FileRef[] = [],
  text = 'Point to the settings gear',
): SubmitTaskRequest => ({
  operationId: randomUUID(),
  input: {
    text,
    files,
    source: 'manual',
    capturedAt: new Date(0).toISOString(),
    selection,
    clipboard: '',
    arguments: {},
    chips: [],
  },
  screenshotText,
});

const inst = (s: ScreenshotTextFollowUp, sel = '', hasFiles = true) =>
  screenshotTaskInstruction(s, sel, s.turn === 'run', hasFiles);
const declaredTools = (body: string) =>
  ((JSON.parse(body) as { tools?: { function?: { name?: string } }[] }).tools ?? []).map(
    (t) => t.function?.name ?? '',
  );
const markCall = (args: Record<string, unknown>): FakeReply => ({
  toolCalls: [{ name: CAPTURE_ANSWER_TOOL, arguments: args }],
});

async function runShot(
  s: ScreenshotTextFollowUp,
  sel = '',
  files: FileRef[] = [shotFile1],
  extra: Record<string, unknown> = {},
  text?: string,
) {
  const res = await harness.call('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      ...makeReq(s, sel, files, text),
      model: { connectionId, modelId: 'gpt-5' },
      ...extra,
    }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  const accepted = parse(SubmitTaskResponseSchema, await res.json());
  const deadline = Date.now() + 20000;
  for (;;) {
    const run = harness.service.ledger.run(accepted.taskId, accepted.runId);
    if (!isActiveStatus(run.status)) return { ...accepted, run };
    assert.ok(Date.now() < deadline, 'run timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function taskSnapshot(taskId: string) {
  const res = await harness.call(`/v1/tasks/${taskId}/snapshot`);
  assert.equal(res.status, 200, await res.clone().text());
  return parse(TaskSnapshotSchema, ((await res.json()) as { snapshot: unknown }).snapshot);
}
const toolStatuses = async (taskId: string) =>
  (await taskSnapshot(taskId)).blocks
    .filter((b) => b.kind === 'tool' && b.name === CAPTURE_ANSWER_TOOL)
    .map((b) => b.status);
const rep = (paragraph: string, text: string) => ({ tool: 'replace', paragraph, text });

test('schemas and requestedOptions validate 0-paragraph screenshot runs and reject text-replacement outputs', () => {
  assert.deepEqual(parse(CommandScreenshotTextSchema, { scope: 'all', paragraphs: 0 }), {
    scope: 'all',
    paragraphs: 0,
  });
  const validReq = makeReq(st('annotate'), '', [shotFile1]);
  assert.equal(parse(SubmitTaskRequestSchema, validReq).screenshotText?.paragraphs, 0);

  const opts = requestedOptions(validReq, null, {});
  assert.equal(opts.lite, true);
  assert.equal(opts.captureOutput, 'annotate');
  assert.ok(opts.instructions?.includes('no text paragraphs were recognized'));
  assert.equal(opts.instructions?.endsWith('\n\n'), false);

  assert.throws(
    () => requestedOptions(makeReq(st('annotate', 0, 'run', 'picked')), null, {}),
    /0-paragraph screenshotText requires scope "all"/,
  );
  for (const output of ['replaceSelection', 'insertAfterSelection'] as const) {
    assert.throws(
      () => requestedOptions(makeReq(st(output)), null, {}),
      /requires recognized screenshot text/,
    );
  }
});

test('screenshotTaskInstruction uses mark_screenshot, coordinate headers, and 0-tool Q&A rules', () => {
  const hybrid = inst(
    st('annotate', 2),
    '[p1 @ 10,20,200,50]\nHello\n\n[p2 @ 10,70,200,100]\nWorld',
  );
  assert.equal(hybrid.includes('@@'), false);
  assert.ok(
    hybrid.includes('reply directly in plain Markdown with 0 tool calls') &&
      hybrid.includes(`do NOT call \`${CAPTURE_ANSWER_TOOL}\``),
  );
  assert.ok(
    hybrid.includes('`{ tool: "mosaic", paragraph, phrase?, text? }`') &&
      hybrid.includes('`((k-1)*1000)/N`'),
  );
  assert.ok(hybrid.includes('Never add a duplicate visual `box` or `ellipse`'));

  const visual = inst(st('annotate'));
  assert.equal(visual.includes('Prefer OCR'), false);
  assert.ok(visual.includes('`tool: "box"`') && visual.includes('`tool: "step"`'));
  const f1 = inst(st('annotate', 0, 'followUp'), '', false);
  const f2 = inst(st('annotate', 0, 'followUp'), '', true);
  assert.ok(f1.includes('attached earlier in this conversation'));
  assert.ok(f2.includes('The user changed the screenshot region'));

  const card = inst(st('card'));
  assert.ok(card.includes('never tell the user to retake the screenshot'));
  assert.ok(card.includes("'When done' ('回答完成后')") && card.includes("Mosaic ('马赛克')"));
  assert.ok(card.includes("'Mark up the screenshot' ('标注在截图上')"));
});

test('isLiteRun permits screenshotText runs even when input.source is screenshot', () => {
  const base = {
    taskId: undefined,
    input: {
      ...makeReq(st('annotate'), '', [shotFile1]).input,
      source: 'screenshot' as const,
    },
    tools: [],
    tokens: [],
    framed: false,
    internal: {},
  };
  assert.equal(isLiteRun({ ...base, screenshotText: false }), false);
  assert.equal(isLiteRun({ ...base, screenshotText: true }), true);
});

test('0-paragraph annotate executes mark_screenshot in 1 turn with terminate:true and rescopes cleanly', async () => {
  const beforeCount = model.bodies.length;
  replies.push(
    markCall({
      items: [{ tool: 'arrow', coords: { x1: 820, y1: 120, x2: 940, y2: 60 }, text: 'Gear' }],
    }),
    markCall({
      lead: 'Updated focus',
      items: [{ tool: 'box', coords: { x1: 200, y1: 300, x2: 600, y2: 700 }, text: 'Crop' }],
    }),
  );
  const first = await runShot(st('annotate'));
  assert.equal(first.run.status, 'completed', first.run.error);
  assert.equal(first.run.snapshot.lite, true);
  assert.equal(first.run.snapshot.captureOutput, 'annotate');
  assert.equal(model.bodies.length - beforeCount, 1);
  const body1 = model.bodies.at(-1) ?? '';
  assert.deepEqual(declaredTools(body1), [CAPTURE_ANSWER_TOOL]);
  assert.match(body1, /no text paragraphs were recognized/);

  const second = await runShot(
    st('annotate', 0, 'followUp'),
    '',
    [shotFile2],
    { taskId: first.taskId },
    'Box the new region instead',
  );
  assert.equal(second.run.status, 'completed', second.run.error);
  assert.equal(second.run.snapshot.lite, true);
  assert.equal(model.bodies.length - beforeCount, 2);
  assert.match(model.bodies.at(-1) ?? '', /The user changed the screenshot region/);
  assert.equal((harness.service.ledger.task(first.taskId) as AgentTask).runs.length, 2);
});

test('annotate self-corrects on isError:true then completes on turn 2, and supports 0-tool Q&A', async () => {
  const beforeCount = model.bodies.length;
  replies.push(
    markCall({ items: [{ tool: 'highlight', paragraph: 'unknown-id', text: 'Bad' }] }),
    markCall({ items: [{ tool: 'highlight', paragraph: 'p1', text: 'Valid note' }] }),
  );
  const ocrSpec = st('annotate', 1, 'run', 'picked');
  const ocrSel = '[p1 @ 10,20,200,50]\nHello world';
  const retryRun = await runShot(ocrSpec, ocrSel);
  assert.equal(retryRun.run.status, 'completed', retryRun.run.error);
  assert.equal(model.bodies.length - beforeCount, 2);
  assert.match(model.bodies.at(-1) ?? '', /Unknown paragraph id/);
  assert.deepEqual(await toolStatuses(retryRun.taskId), ['failed', 'completed']);

  const qaBefore = model.bodies.length;
  replies.push('It means **Hello world**.');
  const qaRun = await runShot(ocrSpec, ocrSel);
  assert.equal(qaRun.run.status, 'completed', qaRun.run.error);
  assert.equal(model.bodies.length - qaBefore, 1);
  const qaBlocks = (await taskSnapshot(qaRun.taskId)).blocks;
  assert.equal(
    qaBlocks.some((b) => b.kind === 'tool'),
    false,
  );
  assert.ok(qaBlocks.some((b) => b.kind === 'assistant' && b.text.includes('Hello world')));
});

test('parallel instruction thresholds, multi-call mark_screenshot execution, and tool streaming helper', async () => {
  for (const output of ['replaceSelection', 'insertAfterSelection'] as const) {
    const small = inst(st(output, 2, 'run', 'picked'), '[p1]\nA\n\n[p2]\nB');
    const large = inst(st(output, 5, 'run', 'picked'), '[p1]\nA\n\n[p2]\nB');
    assert.ok(small.includes(`Call \`${CAPTURE_ANSWER_TOOL}\` once`));
    assert.ok(
      large.includes(`Emit parallel \`${CAPTURE_ANSWER_TOOL}\` tool calls`) &&
        large.includes('grouping 2-3 consecutive paragraphs per call'),
    );
  }

  assert.equal(isToolCallStreaming({ partialArgs: '{"items":[' }, true), true);
  assert.equal(
    isToolCallStreaming({ partialArgs: '{"items":[{"tool":"replace","paragraph":"p1"}]}' }, true),
    false,
  );
  assert.equal(isToolCallStreaming({ partialArgs: '{"items":[]}' }, false), false);
  assert.equal(isToolCallStreaming({ partialJson: '{"a":"}"}' }, true), false);
  assert.equal(isToolCallStreaming({}, true), true);
  assert.equal(isClosedJsonObject('{} {}'), false);
  assert.equal(isClosedJsonObject('{"a":"\\"}"} '), true);

  const fourParagraphs = '[p1]\nOne\n\n[p2]\nTwo\n\n[p3]\nThree\n\n[p4]\nFour';
  const b1 = { items: [rep('p1', '1'), rep('p2', '2')] };
  const b2 = { items: [rep('p3', '3'), rep('p4', '4')] };
  const call = (arguments_: Record<string, unknown>) => ({
    name: CAPTURE_ANSWER_TOOL,
    arguments: arguments_,
  });
  const parallelBefore = model.bodies.length;
  replies.push({ toolCalls: [call(b1), call(b2)] });
  const parallelRun = await runShot(st('replaceSelection', 4, 'run', 'picked'), fourParagraphs);
  assert.equal(parallelRun.run.status, 'completed', parallelRun.run.error);
  assert.equal(model.bodies.length - parallelBefore, 1);
  assert.deepEqual(await toolStatuses(parallelRun.taskId), ['completed', 'completed']);

  const retryBefore = model.bodies.length;
  replies.push({ toolCalls: [call(b1), call({ items: [rep('unknown', '3')] })] }, markCall(b2));
  const retryRun = await runShot(st('replaceSelection', 4, 'run', 'picked'), fourParagraphs);
  assert.equal(retryRun.run.status, 'completed', retryRun.run.error);
  assert.equal(model.bodies.length - retryBefore, 2);
  assert.match(model.bodies.at(-1) ?? '', /Fix and re-issue only this failed mark_screenshot call/);
  assert.deepEqual(await toolStatuses(retryRun.taskId), ['completed', 'failed', 'completed']);
});
