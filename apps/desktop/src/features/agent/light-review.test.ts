import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import { fixtureCommands } from '../../../tests/command-fixtures';
import type {
  AgentEvent,
  CommandProgressAction,
  LightCommandBridge,
  TaskDetail,
} from '../../client/agent/bridge';
import { emptyInput, type RunStatus } from '../../client/agent/task-schema';
import { changeAppLanguage, initialLanguageReady } from '../../i18n';
import { MAX_REVIEW_VERSIONS } from '../../native-bridge/command-review';
import { followCommandRuns } from './command-results';
import { actOnProgress, settleLightRun, startLightRun, type LightHost } from './light-command';
import { lightRuns, type LightLaunch } from './light-command-run';
import { clearIsland, islandIdentity } from './island-owner';

beforeEach(async () => {
  await initialLanguageReady;
  await changeAppLanguage('en');
  clearIsland();
  lightRuns.holding.clear();
});
afterEach(() => {
  clearIsland();
  lightRuns.holding.clear();
  delete window.desktop;
});

function harness(writable = true, runs = 'review-run') {
  const { api } = installBridge({ status: 'running' });
  const command = fixtureCommands()[0]!;
  const launch: LightLaunch = {
    command,
    notice: '',
    input: { ...emptyInput(), selection: '原文', arguments: { language: 'English' } },
    output: { action: 'replaceSelection', review: true },
    target: { id: 'review-target', app: 'Editor', writable, selectionKind: 'text' },
  };
  let sequence = 0;
  const submit = vi.fn<LightCommandBridge['submit']>(async (_key, request) => {
    const detail = await api.submit(request);
    detail.task.runs[0]!.id = `${runs}-${++sequence}`;
    return detail;
  });
  const light = {
    submit,
    show: vi.fn<LightCommandBridge['show']>().mockResolvedValue(),
    hide: vi.fn<LightCommandBridge['hide']>().mockResolvedValue(),
    release: vi.fn(),
    onAction: () => () => {},
  } satisfies LightCommandBridge;
  window.desktop!.agent!.light = light;
  const host = {
    openTask: vi.fn(),
    showInput: vi.fn(),
    reveal: vi.fn(),
    run: vi.fn(),
  } satisfies LightHost;
  const act = (
    action: CommandProgressAction['action'],
    extra: Partial<CommandProgressAction> = {},
  ) => actOnProgress({ target: launch.target.id, action, ...extra }, host);
  const settle = (runId: string, status: RunStatus = 'completed', answer = 'Hello world') =>
    settleLightRun({
      run: { taskId: 'test-task', runId, output: launch.output, target: launch.target },
      status,
      answer,
    });
  return { api, launch, light, host, act, settle, start: () => startLightRun(launch, light) };
}

it.each([true, false])(
  'offers the first answer for review for writable=%s without automatic writes',
  async (writable) => {
    const h = harness(writable);
    await h.start();
    h.settle('review-run-1');
    expect(h.light.show).toHaveBeenLastCalledWith(
      'review-target',
      expect.objectContaining({
        phase: 'answer',
        answer: 'Hello world',
        review: expect.objectContaining({ version: 1, count: 1, source: '原文' }),
      }),
    );
    expect(h.light.hide).not.toHaveBeenCalled();
    expect(h.light.release).not.toHaveBeenCalled();
    expect(h.api.copy).not.toHaveBeenCalled();
    expect(h.api.writeText).not.toHaveBeenCalled();
  },
);

it('regenerates, browses an older version and quotes it when adjusting', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  h.act('regenerate');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-2')).toBe(true));
  h.settle('review-run-2', 'completed', 'Second translation');
  h.act('version', { version: 1 });
  h.act('adjust', { adjust: { text: 'Shorter', adjustments: [] } });
  await vi.waitFor(() => expect(h.light.submit).toHaveBeenCalledTimes(3));
  const request = h.light.submit.mock.calls[2]![1];
  expect(request.commandId).toBeNull();
  expect(request.input.chips).toEqual([
    expect.objectContaining({ chip: { kind: 'quote', text: 'Hello world' } }),
  ]);
  expect(islandIdentity()).toMatchObject({
    review: { versions: [{ answer: 'Hello world' }, { answer: 'Second translation' }] },
  });
});

it('waits for a stopped version to drain before starting its replacement', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  h.act('regenerate');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-2')).toBe(true));
  h.act('stop');
  h.act('adjust', { adjust: { text: 'Shorter', adjustments: [] } });
  expect(h.api.stop).toHaveBeenCalledWith('test-task', 'review-run-2');
  expect(h.light.submit).toHaveBeenCalledTimes(2);
  h.settle('review-run-2', 'completed', 'Late discarded answer');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-3')).toBe(true));
  h.settle('review-run-3', 'completed', 'Short answer');
  expect(islandIdentity()).toMatchObject({
    review: { versions: [{ answer: 'Hello world' }, { answer: 'Short answer' }] },
  });
});

it('closing during submit stops the late run and releases only after it ends', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  const submit = h.light.submit.getMockImplementation()!;
  const deferred = Promise.withResolvers<TaskDetail>();
  h.light.submit.mockImplementationOnce(() => deferred.promise);
  h.act('regenerate');
  h.act('close');
  const shown = h.light.show.mock.calls.length;
  expect(h.light.release).not.toHaveBeenCalled();
  deferred.resolve(await submit('review-target', h.light.submit.mock.calls[1]![1]));
  await vi.waitFor(() => expect(h.api.stop).toHaveBeenCalledWith('test-task', 'review-run-2'));
  expect(h.light.release).not.toHaveBeenCalled();
  h.settle('review-run-2', 'completed', 'Late answer');
  expect(h.light.release).toHaveBeenCalledExactlyOnceWith('review-target');
  expect(h.light.show).toHaveBeenCalledTimes(shown);
});

it('a failed version keeps the previous answer and allows another attempt', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  h.act('regenerate');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-2')).toBe(true));
  h.settle('review-run-2', 'failed', 'Partial text');
  expect(h.light.show).toHaveBeenLastCalledWith(
    'review-target',
    expect.objectContaining({
      answer: 'Hello world',
      note: expect.any(String),
      review: expect.objectContaining({ count: 1 }),
    }),
  );
  expect(islandIdentity()).toMatchObject({ review: { pending: null } });
  h.act('regenerate');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-3')).toBe(true));
});

it('opening in the panel keeps its active version running and stops HUD updates', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  h.act('regenerate');
  await vi.waitFor(() => expect(lightRuns.holding.has('review-run-2')).toBe(true));
  h.act('open');
  const shown = h.light.show.mock.calls.length;
  expect(h.host.openTask).toHaveBeenCalledWith('test-task');
  expect(h.light.hide).toHaveBeenCalledWith('review-target');
  expect(h.api.stop).not.toHaveBeenCalled();
  expect(h.settle('review-run-2')).toBe(false);
  expect(h.light.release).toHaveBeenCalledExactlyOnceWith('review-target');
  expect(h.light.show).toHaveBeenCalledTimes(shown);
});

it('makes no more than the supported number of versions', async () => {
  const h = harness();
  await h.start();
  h.settle('review-run-1');
  for (let version = 2; version <= MAX_REVIEW_VERSIONS; version++) {
    h.act('regenerate');
    await vi.waitFor(() => expect(lightRuns.holding.has(`review-run-${version}`)).toBe(true));
    h.settle(`review-run-${version}`);
  }
  h.act('regenerate');
  expect(h.light.submit).toHaveBeenCalledTimes(MAX_REVIEW_VERSIONS);
  expect(islandIdentity()).toMatchObject({ review: { pending: null } });
});

/** The run's answer so far, as a transcript snapshot of the review's task carries it. */
function partial(runId: string, text: string): AgentEvent {
  const block = { id: `${runId}-answer`, runId, timestamp: 0, endedAt: 0, text };
  return {
    type: 'transcript',
    patch: {
      taskId: 'test-task',
      revision: 1,
      snapshot: true,
      removed: [],
      blocks: [{ ...block, kind: 'assistant', streaming: true, stopReason: null, error: '' }],
    },
  };
}

it('pages through versions while a new one streams onto its own page', async () => {
  // Run ids of their own: the remembered command runs outlive each test.
  const h = harness(true, 'paging-run');
  const shown = () => h.light.show.mock.lastCall?.[1];
  await h.start();
  h.settle('paging-run-1');
  h.act('regenerate');
  expect(shown()).toMatchObject({ answer: '', review: { version: 2, count: 1 } });
  await vi.waitFor(() => expect(lightRuns.holding.has('paging-run-2')).toBe(true));
  followCommandRuns(partial('paging-run-2', 'Second'));
  expect(shown()).toMatchObject({
    answer: 'Second',
    review: { version: 2, pending: 'regenerate' },
  });
  h.act('version', { version: 1 });
  expect(shown()).toMatchObject({ answer: 'Hello world', review: { version: 1, count: 1 } });
  h.settle('paging-run-2', 'completed', 'Second translation');
  expect(shown()).toMatchObject({ answer: 'Hello world', review: { version: 1, count: 2 } });
  h.act('version', { version: 2 });
  expect(shown()).toMatchObject({ answer: 'Second translation', review: { version: 2, count: 2 } });
});

it('streams an answer onto the card and keeps what came when stopped', async () => {
  const h = harness(false, 'card-run');
  h.launch.output = { action: 'replaceSelection', review: false };
  const { name } = h.launch.command;
  const shown = () => h.light.show.mock.lastCall?.[1];
  await h.start();
  followCommandRuns(partial('card-run-1', ' \n'));
  expect(shown()).toMatchObject({ phase: 'working' });
  followCommandRuns(partial('card-run-1', 'Hel'));
  expect(shown()).toEqual({ phase: 'answer', command: name, answer: 'Hel', streaming: true });
  h.act('stop');
  expect(h.api.stop).toHaveBeenCalledWith('test-task', 'card-run-1');
  expect(shown()).toEqual({
    phase: 'answer',
    command: name,
    answer: 'Hel',
    note: `${name} was stopped.`,
  });
  const count = h.light.show.mock.calls.length;
  expect(h.settle('card-run-1', 'stopped', '')).toBe(true);
  expect(h.light.show).toHaveBeenCalledTimes(count);
});
