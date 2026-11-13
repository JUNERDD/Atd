import { beforeEach, expect, it } from 'vitest';
import { fixtureCommands } from '../../../tests/command-fixtures';
import { emptyInput } from '../../client/agent/task-schema';
import { ASK_CAPTURE_COMMAND_ID, prepareCaptureText } from '../../native-host/native-capture-text';
import type { NativeCommands } from '../../native-host/native-commands';
import { changeAppLanguage, initialLanguageReady } from '../../i18n';
import type { LightLaunch } from './light-command-run';
import { adjustPlan, type ReviewLaunch, versionRequest } from './light-review-request';

const command = fixtureCommands()[0]!;
const base = { answer: 'Earlier translation', values: { language: 'English' } };
const launch: LightLaunch = {
  command,
  input: { ...emptyInput(), selection: '原文', arguments: base.values },
  output: { action: 'replaceSelection', review: true },
  target: { id: 'review-target', app: 'Editor', writable: true, selectionKind: 'text' },
  notice: '',
  shortcutId: 'translate-shortcut',
};

beforeEach(async () => {
  await initialLanguageReady;
  await changeAppLanguage('en');
});

it('does nothing for whitespace, unchanged values, or invalid option values', () => {
  for (const language of ['English', 'invalid']) {
    expect(
      adjustPlan(command, base, true, {
        text: ' \n ',
        adjustments: [],
        arguments: { choices: { language, unknown: 'ignored' }, toggles: {} },
      }),
    ).toBeNull();
  }
});

it('treats an unset switch and false as the same effective value', () => {
  const withSwitch = {
    ...command,
    parameters: [
      ...command.parameters,
      { key: 'short', label: 'Short', description: '', required: false, type: 'boolean' as const },
    ],
  };
  expect(
    adjustPlan(withSwitch, base, true, {
      text: '',
      adjustments: [],
      arguments: { choices: {}, toggles: { short: false } },
    }),
  ).toBeNull();
});

it('reruns the original command for an option-only change, preserving source and output', () => {
  const next = adjustPlan(command, base, true, {
    text: '',
    adjustments: [],
    arguments: { choices: { language: 'French' }, toggles: {} },
  });
  expect(next).toEqual({
    kind: 'options',
    plan: { kind: 'command', values: { language: 'French' } },
  });
  expect(versionRequest(launch, 'review-task', next!.plan)).toMatchObject({
    taskId: 'review-task',
    commandId: command.id,
    commandRevision: command.revision,
    shortcutId: launch.shortcutId,
    output: launch.output,
    input: { selection: '原文', arguments: { language: 'French' } },
  });
});

it('combines options, chosen adjustments and typed text into one ordered follow-up', () => {
  const next = adjustPlan(command, base, true, {
    text: '  Keep names  ',
    adjustments: ['More natural', 'Shorter'],
    arguments: { choices: { language: 'French' }, toggles: {} },
  });
  expect(next).toEqual({
    kind: 'adjust',
    plan: {
      kind: 'followUp',
      values: { language: 'French' },
      text: 'Target language: French\nMore natural\nShorter\nKeep names',
      quote: null,
    },
  });
  const request = versionRequest(launch, 'review-task', next!.plan);
  expect(request.commandId).toBeNull();
  expect(request.policy).toBeNull();
  expect(request.input.chips).toEqual([]);
  expect(request.input.selection).toBe('');
});

it('quotes the displayed older answer so the follow-up cannot adjust the latest by mistake', () => {
  const next = adjustPlan(command, base, false, { text: 'Shorter', adjustments: [] });
  expect(next?.plan).toMatchObject({ kind: 'followUp', quote: base.answer });
  const request = versionRequest(launch, 'review-task', next!.plan);
  expect(request.input.chips).toEqual([
    expect.objectContaining({ chip: { kind: 'quote', text: base.answer } }),
  ]);
  expect(request.input.text).toContain('Shorter');
});

it('omits commandId and commandRevision when rerunning an Ask launch via versionRequest', () => {
  const askLaunch: ReviewLaunch = {
    ...launch,
    ask: true,
    output: { action: 'card', review: false },
  };
  const request = versionRequest(askLaunch, 'ask-task', { kind: 'command', values: {} });
  expect(request).toMatchObject({
    taskId: 'ask-task',
    commandId: null,
    commandRevision: null,
    input: askLaunch.input,
    output: { action: 'card', review: false },
  });
});

it('prepares a free-form Ask capture-text launch and honors a picked output action', async () => {
  const unusedCommands = {} as unknown as NativeCommands;
  const baseRun = {
    runId: 'ct-ask-1',
    surface: 'capture' as const,
    question: 'What does this mean?',
    scope: 'picked' as const,
    paragraphs: [{ id: 'p0', text: 'First paragraph' }],
    files: [],
  };
  const defaultAsk = await prepareCaptureText(unusedCommands, baseRun);
  expect(defaultAsk.command.id).toBe(ASK_CAPTURE_COMMAND_ID);
  expect(defaultAsk.input.text).toBe('What does this mean?');
  expect(defaultAsk.input.selection).toContain('[p0]');
  expect(defaultAsk.output).toEqual({ action: 'annotate', review: false });

  const withBounds = await prepareCaptureText(unusedCommands, {
    ...baseRun,
    paragraphs: [
      { id: 'p0', text: 'First paragraph', bounds: { x1: 10, y1: 20, x2: 300, y2: 80 } },
    ],
  });
  expect(withBounds.input.selection).toContain('[p0 @ 10,20,300,80]');

  const pickedOutput = await prepareCaptureText(unusedCommands, {
    ...baseRun,
    arguments: { choices: {}, toggles: {}, output: 'card' },
  });
  expect(pickedOutput.output).toEqual({ action: 'card', review: false });
});
