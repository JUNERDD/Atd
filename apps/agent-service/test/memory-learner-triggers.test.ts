import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Logger } from '../dist/logging.js';
import { isCorrection } from '../dist/memory/learner/cues.js';
import { LearnerJobs } from '../dist/memory/learner/jobs.js';
import {
  CADENCE_TOOL_CALLS,
  CADENCE_TURNS,
  CORRECTION_COOLDOWN_TURNS,
  LearnerTriggers,
  type LearnerRequest,
} from '../dist/memory/learner/triggers.js';

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

test('English correction cues: strong, weak with a directive, and negatives', () => {
  for (const message of [
    "Don't do that again.",
    'I said use pnpm.',
    'I told you about the build.',
    'We already discussed the naming.',
    "Please don't touch the lockfile.",
    "That's not what I asked for.",
    'No, use pnpm instead.',
    'Wrong. Change the port.',
    'Actually, run the tests first.',
    'Stop! Remove that file.',
  ])
    assert.ok(isCorrection(message), message);
  for (const message of [
    'No worries, take your time.',
    'No problem at all.',
    'Actually that looks great.',
    'Stop there for now.',
    'No.',
    'Notably the build passed.',
    'Can you add a test?',
  ])
    assert.ok(!isCorrection(message), message);
});

test('Chinese correction cues: strong, weak with a directive, and negatives', () => {
  for (const message of [
    '不对，应该用 pnpm',
    '错了，改成 3000 端口',
    '别用 npm',
    '不要动这个文件',
    '我说过不要提交 lockfile',
    '我之前跟你说过要先跑测试',
    '不是这样的，我要的是表格',
    '你理解错了',
    '你又忘了加测试',
    '别再这样写了',
    '应该是 pnpm 而不是 npm',
    '停，先别改了',
    '说了多少次了，用中文回答',
  ])
    assert.ok(isCorrection(message), message);
  for (const message of [
    '不错，就这样',
    '没错，继续',
    '别担心，慢慢来',
    '别的方案呢？',
    '要不要再试一次？',
    '这样对不对？',
    '不对称加密怎么用',
    '帮我整理一下区别',
    '特别好，谢谢',
    '错误信息如下：timeout',
    '不对',
  ])
    assert.ok(!isCorrection(message), message);
});

test('only the start of a long message is read for cues', () => {
  assert.ok(!isCorrection(`${'Here is the log. '.repeat(40)}we already discussed this`));
});

test('a correction starts a review at the end of its turn, at most once per cooldown', () => {
  const triggers = new LearnerTriggers();
  triggers.userMessage('No, use pnpm instead.');
  assert.deepEqual(triggers.turnEnded(0), {
    trigger: 'correction',
    correction: 'No, use pnpm instead.',
  });
  const fired: (string | null)[] = [];
  for (let turn = 0; turn < CORRECTION_COOLDOWN_TURNS + 1; turn += 1) {
    triggers.userMessage('不对，应该用 pnpm');
    fired.push(triggers.turnEnded(0)?.trigger ?? null);
  }
  assert.deepEqual(fired, [...Array<null>(CORRECTION_COOLDOWN_TURNS).fill(null), 'correction']);
});

test('the cadence needs two user messages, then ten turns or fifteen tool calls since a review', () => {
  const triggers = new LearnerTriggers();
  triggers.userMessage('Build the app.');
  for (let turn = 0; turn < CADENCE_TURNS * 2; turn += 1) assert.equal(triggers.turnEnded(1), null);
  triggers.userMessage('Also add tests.');
  assert.deepEqual(triggers.turnEnded(0), { trigger: 'cadence' });
  triggers.reviewed();
  for (let turn = 1; turn < CADENCE_TURNS; turn += 1) assert.equal(triggers.turnEnded(0), null);
  assert.deepEqual(triggers.turnEnded(0), { trigger: 'cadence' });
  triggers.reviewed();
  assert.equal(triggers.turnEnded(CADENCE_TOOL_CALLS - 1), null);
  assert.deepEqual(triggers.turnEnded(1), { trigger: 'cadence' });
});

test('idle and compaction reviews depend on user messages since the last review', () => {
  const triggers = new LearnerTriggers();
  assert.equal(triggers.compactionDue(), false);
  triggers.userMessage('one');
  assert.equal(triggers.compactionDue(), true);
  assert.equal(triggers.idleDue(), false);
  triggers.userMessage('two');
  assert.equal(triggers.idleDue(), true);
  triggers.reviewed();
  assert.equal(triggers.idleDue(), false);
  assert.equal(triggers.compactionDue(), false);
});

function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

test('one review at a time: periodic requests are dropped, a correction waits for the next slot', async () => {
  const started: LearnerRequest[] = [];
  const gates: ReturnType<typeof gate>[] = [];
  const jobs = new LearnerJobs(async (request) => {
    started.push(request);
    const next = gate();
    gates.push(next);
    await next.opened;
  }, silent);
  jobs.request({ trigger: 'cadence' });
  jobs.request({ trigger: 'idle' });
  jobs.request({ trigger: 'correction', correction: 'first' });
  jobs.request({ trigger: 'correction', correction: 'latest' });
  assert.deepEqual(started, [{ trigger: 'cadence' }]);
  gates[0]?.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.at(-1), { trigger: 'correction', correction: 'latest' });
  assert.equal(started.length, 2);
  gates[1]?.open();
  await jobs.close(null, 1000);
  assert.equal(started.length, 2);
});

test('close runs the last review after the running one, within the cap', async () => {
  const started: string[] = [];
  const jobs = new LearnerJobs(async (request) => {
    started.push(request.trigger);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }, silent);
  jobs.request({ trigger: 'cadence' });
  await jobs.close({ trigger: 'shutdown' }, 1000);
  assert.deepEqual(started, ['cadence', 'shutdown']);
  jobs.request({ trigger: 'idle' });
  assert.deepEqual(started, ['cadence', 'shutdown']);
});

test('close aborts a review that outlasts the cap and drops what waits', async () => {
  const signals: AbortSignal[] = [];
  const started: string[] = [];
  const jobs = new LearnerJobs(async (request, signal) => {
    started.push(request.trigger);
    signals.push(signal);
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  }, silent);
  jobs.request({ trigger: 'cadence' });
  const before = Date.now();
  await jobs.close({ trigger: 'shutdown' }, 20);
  assert.ok(Date.now() - before < 1000);
  assert.equal(signals[0]?.aborted, true);
  assert.deepEqual(started, ['cadence']);
});

test(
  'abort ends the running review at once, drops what waits and takes no more',
  {
    timeout: 2000,
  },
  async () => {
    const signals: AbortSignal[] = [];
    const started: string[] = [];
    const jobs = new LearnerJobs(async (request, signal) => {
      started.push(request.trigger);
      signals.push(signal);
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    }, silent);
    jobs.request({ trigger: 'cadence' });
    jobs.request({ trigger: 'correction', correction: 'No, use pnpm instead.' });
    await jobs.abort();
    assert.equal(signals[0]?.aborted, true);
    jobs.request({ trigger: 'idle' });
    await jobs.close({ trigger: 'shutdown' }, 1000);
    assert.deepEqual(started, ['cadence']);
  },
);

test('a failing review is logged and frees the slot', async () => {
  const warnings: string[] = [];
  const log: Logger = { ...silent, warn: (message) => void warnings.push(message) };
  let runs = 0;
  const jobs = new LearnerJobs(async () => {
    runs += 1;
    throw new Error('boom');
  }, log);
  jobs.request({ trigger: 'cadence' });
  await new Promise((resolve) => setImmediate(resolve));
  jobs.request({ trigger: 'idle' });
  await jobs.close(null, 100);
  assert.equal(runs, 2);
  assert.deepEqual(warnings, [
    'A memory review failed unexpectedly.',
    'A memory review failed unexpectedly.',
  ]);
});
