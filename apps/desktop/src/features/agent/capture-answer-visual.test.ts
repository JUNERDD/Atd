import {
  CAPTURE_ANSWER_TOOL,
  extractCaptureProgress,
  parseCaptureAnswer,
  serializeCaptureAnswer,
  validateCaptureToolCall,
} from '@atd/agent-contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentEvent, SubmitRequest, TaskDetail } from '../../client/agent/bridge';
import { emptyInput, type AgentTask, type FileRef } from '../../client/agent/task-schema';
import type { Block } from '../../client/agent/transcript-schema';
import type { CaptureTextProgress, CaptureTextRun } from '../../client/capture-bridge';
import { changeAppLanguage, initialLanguageReady } from '../../i18n';
import { prepareCaptureText } from '../../native-host/native-capture-text';
import type { NativeCommands } from '../../native-host/native-commands';
import { captureRunAnswer } from './capture-run-answer';
import { usableAnswer } from './capture-text-progress';
import { runs } from './capture-text-run';
import { listenCaptureTextRuns } from './capture-text-runs';
import { isCaptureTask, matchesFilter } from './history-view';

let prevDesktop: unknown;
const listeners = new Set<(event: AgentEvent) => void>();

beforeEach(async () => {
  runs.clear();
  listeners.clear();
  prevDesktop = (window as { desktop?: unknown }).desktop;
  const onChange = (fn: (event: AgentEvent) => void) => (
    listeners.add(fn),
    () => listeners.delete(fn)
  );
  (window as { desktop?: unknown }).desktop = { agent: { onChange } };
  await initialLanguageReady;
  await changeAppLanguage('en');
});

afterEach(() => void ((window as { desktop?: unknown }).desktop = prevDesktop));

type MarkItems = Parameters<typeof validateCaptureToolCall>[0]['items'];

it('validates OCR marks, visual shapes, unit decimals, clamping, and degenerate errors', () => {
  const paragraphs = [
    { id: 'p1', text: 'Email: alice@example.com\nToken: sk-live-999' },
    { id: 'p2', text: 'Click Continue to save changes.' },
  ];
  const kept: MarkItems = [
    { tool: 'mosaic', paragraph: 'p1', phrase: 'sk-live-999', text: 'API key redacted' },
    { tool: 'highlight', paragraph: 'p1', phrase: 'alice@example.com', text: 'Contact' },
    { tool: 'step', paragraph: 'p2', text: 'Confirm here' },
    { tool: 'arrow', coords: { x1: 820, y1: 140, x2: 610, y2: 290 }, text: 'Pointer' },
    { tool: 'step', point: { x: 320, y: 260 }, text: 'Click Save' },
  ];
  const valid = validateCaptureToolCall(
    {
      lead: 'Visual walkthrough:',
      items: [
        ...kept,
        { tool: 'mosaic', paragraph: 'p1', phrase: 'missing-phrase', text: '' },
        { tool: 'box', coords: { x1: 480, y1: 310, x2: 120, y2: 240 }, text: 'Toolbar' },
        { tool: 'ellipse', coords: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }, text: 'Badge' },
        { tool: 'mosaic', coords: { x1: -10, y1: 800, x2: 250, y2: 1050 }, text: '' },
        { tool: 'step', coords: { x1: 400, y1: 400, x2: 400, y2: 400 }, text: 'Collapsed' },
      ],
    },
    { action: 'annotate', paragraphs },
  );
  expect(valid).toEqual({
    ok: true,
    value: {
      lead: 'Visual walkthrough:',
      items: [
        ...kept,
        { tool: 'mosaic', paragraph: 'p1', text: '' },
        { tool: 'box', coords: { x1: 120, y1: 240, x2: 480, y2: 310 }, text: 'Toolbar' },
        { tool: 'ellipse', coords: { x1: 100, y1: 200, x2: 300, y2: 400 }, text: 'Badge' },
        { tool: 'mosaic', coords: { x1: 0, y1: 800, x2: 250, y2: 1000 }, text: '' },
        { tool: 'step', point: { x: 400, y: 400 }, text: 'Collapsed' },
      ],
    },
  });
  const bad = (items: MarkItems, action: 'annotate' | 'replaceSelection' = 'annotate') =>
    validateCaptureToolCall({ items }, { action, paragraphs }).ok;
  const rep = (text: string) => ({ tool: 'replace' as const, paragraph: 'p1', text });
  expect(bad([])).toBe(false);
  expect(
    bad([{ tool: 'arrow', coords: { x1: 300, y1: 300, x2: 300, y2: 300 }, text: 'Bad' }]),
  ).toBe(false);
  expect(bad([rep('One'), rep('Two')], 'replaceSelection')).toBe(false);
});

it('suppresses note-less visual box/ellipse marks duplicating marked OCR paragraph bounds', () => {
  const paragraphs = [
    { id: 'p1', text: 'Save button', bounds: { x1: 100, y1: 200, x2: 300, y2: 260 } },
  ];
  const first: MarkItems[number] = { tool: 'highlight', paragraph: 'p1', text: 'Important' };
  const rest: MarkItems = [
    { tool: 'ellipse', coords: { x1: 100, y1: 200, x2: 300, y2: 260 }, text: 'Kept note' },
    { tool: 'arrow', coords: { x1: 50, y1: 150, x2: 110, y2: 210 }, text: '' },
  ];
  const dup: MarkItems[number] = {
    tool: 'box',
    coords: { x1: 105, y1: 202, x2: 295, y2: 258 },
    text: '',
  };
  const res = validateCaptureToolCall(
    { items: [first, dup, ...rest] },
    { action: 'annotate', paragraphs },
  );
  expect(res).toEqual({ ok: true, value: { lead: '', items: [first, ...rest] } });
});

it('extracts streaming progress (holding trailing item until settled) and round-trips JSON', () => {
  const paragraphs = [{ id: 'p1', text: 'Line one' }];
  const opts = { action: 'annotate' as const, paragraphs };
  const first = { tool: 'highlight', paragraph: 'p1', text: 'First' };
  const args = {
    lead: 'Summary',
    items: [first, { tool: 'box', coords: { x1: 10, y1: 10, x2: 100, y2: 100 }, text: 'Trailing' }],
  };
  expect(extractCaptureProgress(args, { ...opts, settled: false }).items).toEqual([first]);
  const settled = extractCaptureProgress(args, { ...opts, settled: true });
  expect(settled.items).toHaveLength(2);
  expect(parseCaptureAnswer(serializeCaptureAnswer(settled), { ...opts, final: true })).toEqual(
    settled,
  );
  expect(serializeCaptureAnswer({ lead: '  ', items: [] })).toBe('');

  const qa = 'This error means port 5173 is busy.\n@MainActor stays intact.';
  expect(parseCaptureAnswer(qa, { action: 'annotate', paragraphs: [], final: true })).toEqual({
    lead: qa,
    items: [],
  });
  const source = { id: 'r1', output: 'annotate' as const, awaitsApply: false, paragraphs: [] };
  expect(usableAnswer(source, qa)).toBe(true);
  expect(usableAnswer({ ...source, output: 'replaceSelection' }, qa)).toBe(false);
  expect(usableAnswer({ ...source, output: 'insertAfterSelection' }, qa)).toBe(false);
});

const now = new Date(0).toISOString();
const baseSnap = {
  command: null,
  definition: 'current',
  input: emptyInput(),
  instructions: '',
  model: { provider: 'openai', connectionId: 'c1', modelId: 'gpt-5', baseUrl: '' },
  tools: [],
  memory: false,
};

function makeDetail(
  id: string,
  status: 'running' | 'completed',
  blocks: Block[],
  snap = {},
): TaskDetail {
  const runsList = [
    { id, status, startedAt: now, finishedAt: null, error: '', snapshot: { ...baseSnap, ...snap } },
  ];
  return {
    task: { id: 'task-zero', title: 'Ask Atd', createdAt: now, updatedAt: now, runs: runsList },
    revision: 0,
    blocks,
    requests: [],
  } as unknown as TaskDetail;
}

function markBlock(
  runId: string,
  status: 'running' | 'completed' | 'failed',
  args: object,
  opts?: { id?: string; streaming?: boolean | undefined },
): Block {
  const id = opts?.id ?? `tool-${runId}`;
  return {
    kind: 'tool',
    id,
    runId,
    timestamp: 1,
    endedAt: 2,
    callId: `call-${id}`,
    name: CAPTURE_ANSWER_TOOL,
    args: args as Record<string, unknown>,
    status,
    ...(opts?.streaming === undefined ? {} : { streaming: opts.streaming }),
    output: '',
    partial: '',
    details: { diff: '', truncated: false, fullOutputPath: '' },
    permission: null,
  };
}

it('streams mark_screenshot blocks (running -> completed), 0-tool Q&A, and rescoped follow-ups', async () => {
  const crop = (id: string): FileRef => ({ id, name: `${id}.png`, size: 100, type: 'image/png' });
  const [crop1, crop2] = [crop('shot-1'), crop('shot-2')];
  let onRun: (event: CaptureTextRun) => void = () => {};
  let onAction: Parameters<Parameters<typeof listenCaptureTextRuns>[0]['onAction']>[0] = () => {};
  const updates: CaptureTextProgress[] = [];
  const submitted: SubmitRequest[] = [];
  const twoArgs = {
    lead: 'Marked',
    items: [
      { tool: 'box', coords: { x1: 100, y1: 100, x2: 400, y2: 400 }, text: 'First' },
      { tool: 'arrow', coords: { x1: 50, y1: 50, x2: 100, y2: 100 }, text: 'Second' },
    ],
  };
  const responses = [
    () => makeDetail('run-1', 'running', []),
    () =>
      makeDetail('run-2', 'completed', [
        {
          kind: 'assistant',
          id: 'a2',
          runId: 'run-2',
          timestamp: 1,
          endedAt: 2,
          text: 'Pure Q&A answer.',
          streaming: false,
          stopReason: 'stop',
          error: '',
        },
      ]),
    () =>
      makeDetail('run-3', 'completed', [
        markBlock('run-3', 'completed', {
          lead: 'Rescoped marks',
          items: [{ tool: 'box', coords: { x1: 10, y1: 10, x2: 90, y2: 90 }, text: 'Focus' }],
        }),
      ]),
  ];
  const noop = async () => {};
  const ui = { openTask: noop, showInput: noop, reveal: noop, run: noop };
  const stop = listenCaptureTextRuns(
    {
      prepare: (e) => prepareCaptureText({} as unknown as NativeCommands, e),
      progress: async (u) => void updates.push(u),
      onRun: (fn) => ((onRun = fn), () => {}),
      onAction: (fn) => ((onAction = fn), () => {}),
    },
    {
      submit: vi.fn(async (_k, r: Omit<SubmitRequest, 'action'>) => {
        submitted.push({ action: 'submit', ...r });
        return responses[submitted.length - 1]!();
      }),
      release: vi.fn(),
      show: noop,
      hide: noop,
      onAction: () => noop,
    },
    () => ui,
  );
  const waitLast = (expected: object) =>
    vi.waitFor(() => expect(updates.at(-1)).toMatchObject(expected));
  const waitDone = (result: object, v: number) =>
    waitLast({ state: 'done', result, review: { version: v, count: v } });
  const emit = (event: AgentEvent) => listeners.forEach((fn) => fn(event));
  const patch = (rev: number, blocks: Block[]) =>
    emit({
      type: 'transcript',
      patch: { taskId: 'task-zero', revision: rev, snapshot: false, blocks, removed: [] },
    });

  onRun({
    runId: 'zero-1',
    surface: 'capture',
    question: 'What icon is this?',
    scope: 'all',
    paragraphs: [],
    files: [crop1],
  });
  await vi.waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]?.screenshotText).toEqual({ scope: 'all', paragraphs: 0, turn: 'run' });

  patch(1, [markBlock('run-1', 'running', twoArgs)]);
  await waitLast({ state: 'streaming', result: { lead: 'Marked', items: [twoArgs.items[0]] } });
  patch(2, [markBlock('run-1', 'completed', twoArgs)]);
  emit({ type: 'task', state: makeDetail('run-1', 'completed', []) });
  await waitDone({ lead: 'Marked', items: twoArgs.items }, 1);

  onAction({ runId: 'zero-1', action: 'regenerate' });
  await vi.waitFor(() => expect(submitted).toHaveLength(2));
  expect(submitted[1]?.screenshotText).toEqual({ scope: 'all', paragraphs: 0, turn: 'run' });
  await waitDone({ lead: 'Pure Q&A answer.', items: [] }, 2);

  onAction({
    runId: 'zero-1',
    action: 'adjust',
    adjust: { text: 'Focus on this new area', adjustments: [] },
    reading: { scope: 'all', paragraphs: [], files: [crop2] },
  });
  await vi.waitFor(() => expect(submitted).toHaveLength(3));
  expect(submitted[2]?.screenshotText).toEqual({ scope: 'all', paragraphs: 0 });
  expect(submitted[2]?.input.files).toEqual([crop2]);
  await waitDone({ lead: 'Rescoped marks', items: [{ tool: 'box', text: 'Focus' }] }, 3);
  stop();
});

it('merges parallel mark_screenshot progressive streaming and turn-2 retry after a failed batch', () => {
  const paragraphs = ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, text: `Line ${id}` }));
  const src = { output: 'replaceSelection' as const, paragraphs };
  const p = (paragraph: string, text: string) => ({ tool: 'replace' as const, paragraph, text });
  const a1 = { items: [p('p1', 'One'), p('p2', 'Two')] };
  const a2 = { items: [p('p3', 'Three'), p('p4', 'Four')] };
  const check = (blocks: Block[], exp: string[], final = false) => {
    const res = parseCaptureAnswer(captureRunAnswer(blocks, 'r1', src), {
      action: 'replaceSelection',
      paragraphs,
      final,
    });
    expect(res?.items.map((i) => i.paragraph)).toEqual(exp);
  };
  const b = (
    id: string,
    s: 'running' | 'completed' | 'failed',
    args: object,
    streaming?: boolean,
  ) => markBlock('r1', s, args, { id, streaming });
  check([b('c1', 'running', a1, false), b('c2', 'running', a2, true)], ['p1', 'p2', 'p3']);
  check([b('c1', 'completed', a1), b('c2', 'completed', a2)], ['p1', 'p2', 'p3', 'p4'], true);
  check(
    [b('c1', 'completed', a1), b('c2', 'failed', a2), b('c3', 'completed', a2)],
    ['p1', 'p2', 'p3', 'p4'],
    true,
  );
});

it('classifies historical screenshot Ask and saved capture commands in history-view', () => {
  const ctx: FileRef = {
    id: 'ctx-1',
    name: 'Screenshot 2026-11-13 at 17.35.00 context.md',
    size: 42,
    type: 'text/markdown',
  };
  const taskOf = (source: 'manual' | 'selection', files: FileRef[], extra = {}) =>
    makeDetail('r1', 'completed', [], { input: { ...emptyInput(), source, files }, ...extra })
      .task as unknown as AgentTask;
  const [ask, cmd, flag] = [
    taskOf('manual', [ctx]),
    taskOf('selection', [ctx], { fromCommand: true }),
    taskOf('selection', [], { fromCommand: true, fromCapture: true }),
  ];
  for (const task of [ask, cmd, flag]) {
    expect(isCaptureTask(task)).toBe(true);
    expect(matchesFilter(task, 'captures')).toBe(true);
    expect(matchesFilter(task, 'all', false, false)).toBe(false);
    expect(matchesFilter(task, 'all', false, true)).toBe(true);
  }
  expect(matchesFilter(cmd, 'all', true, false)).toBe(true);
});
