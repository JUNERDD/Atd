import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { grantKey, type PermissionAnswer } from '@atd/agent-contracts';
import type { ConfirmStore, PermissionRequestDraft } from '../dist/confirms.js';
import { task } from './fixtures.ts';
import { startTestService } from './service-harness.ts';

function input(
  call: string,
  taskId = 'fixture-task',
  runId = 'fixture-run',
): PermissionRequestDraft {
  return {
    taskId,
    runId,
    executionId: 'root:fixture',
    toolCallId: call,
    kind: 'input',
    title: 'Fixture question',
    options: [],
  };
}

function raise(
  store: ConfirmStore,
  draft: PermissionRequestDraft,
  signal: AbortSignal,
  ownAnswerOnly = false,
) {
  let onListed = () => {};
  const listed = new Promise<void>((resolve) => {
    onListed = resolve;
  });
  const answer = store.request(draft, signal, { ownAnswerOnly, listed: onListed });
  // Cleanup may abort a sibling after an earlier assertion failed; callers still observe answer.
  void answer.catch(() => undefined);
  return { answer, listed };
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Confirmation withdrawal did not settle.');
    await delay(5);
  }
}

test('HTTP confirmation/input answers release the run signal listener on every round trip', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const controllers: AbortController[] = [];
  t.after(() => controllers.forEach((controller) => controller.abort()));
  const store = harness.service.confirms;
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    const draft: PermissionRequestDraft =
      cycle % 2 === 0
        ? input(`question-${cycle}`)
        : {
            taskId: 'fixture-task',
            runId: 'fixture-run',
            executionId: 'root:fixture',
            toolCallId: `guard-${cycle}`,
            kind: 'confirmation',
            scope: { tool: 'bash' },
            title: 'Fixture action',
            detail: '',
          };
    const answer: PermissionAnswer =
      draft.kind === 'input'
        ? { answer: 'fixture' }
        : { decision: cycle % 4 === 1 ? 'once' : 'declined' };
    const pending = raise(store, draft, controller.signal);
    await pending.listed;
    assert.equal(
      store.runStatus('fixture-task', 'fixture-run'),
      draft.kind === 'input' ? 'awaiting_input' : 'awaiting_confirmation',
    );
    const request = store.pending()[0];
    assert.ok(request);
    const response = await harness.call('/v1/confirms', {
      method: 'POST',
      body: JSON.stringify({
        requestId: request.id,
        revision: request.revision,
        answer,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await pending.answer, answer);
    assert.deepEqual(store.pending(), []);
    assert.equal(store.runStatus('fixture-task', 'fixture-run'), 'running');
  }
  assert.equal(
    controllers.reduce(
      (sum, controller) => sum + getEventListeners(controller.signal, 'abort').length,
      0,
    ),
    0,
  );
});

test('run cancellation releases its signal listener and rejects late answers', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const controller = new AbortController();
  t.after(() => controller.abort());
  const store = harness.service.confirms;
  const pending = raise(store, input('cancelled'), controller.signal);
  const rejected = assert.rejects(pending.answer, /Fixture stopped/);
  await pending.listed;
  const request = store.pending()[0];
  assert.ok(request);
  await store.cancelRun('fixture-task', 'fixture-run', 'Fixture stopped.');
  await rejected;
  assert.deepEqual(store.pending(), []);
  assert.equal(store.runStatus('fixture-task', 'fixture-run'), 'running');
  await assert.rejects(store.reply(request.id, request.revision, { answer: 'late' }), {
    name: 'ConfirmGone',
  });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('interjection and session grants release listeners while own-answer requests remain waiting', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const controller = new AbortController();
  t.after(() => controller.abort());
  const store = harness.service.confirms;
  const confirm: PermissionRequestDraft = {
    taskId: 'fixture-task',
    runId: 'fixture-run',
    executionId: 'root:fixture',
    toolCallId: 'guard',
    kind: 'confirmation',
    scope: { tool: 'bash' },
    title: 'Fixture action',
    detail: '',
  };
  const grant = raise(store, confirm, controller.signal);
  const own = raise(store, { ...confirm, toolCallId: 'own-answer' }, controller.signal, true);
  await Promise.all([grant.listed, own.listed]);
  await store.grantPending('fixture-task', grantKey({ tool: 'bash' }));
  assert.deepEqual(await grant.answer, { decision: 'session' });
  assert.equal(store.pending().length, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  assert.equal(store.runStatus('fixture-task', 'fixture-run'), 'awaiting_confirmation');
  const question = raise(store, input('steered'), controller.signal);
  await question.listed;
  await store.interject('fixture-task', () => true);
  assert.deepEqual(await own.answer, { decision: 'declined' });
  assert.deepEqual(await question.answer, { skipped: true });
  assert.deepEqual(store.pending(), []);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.deepEqual(await store.request(confirm, controller.signal), { decision: 'declined' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('request expiry releases its signal listener without waiting for a later run abort', async (t) => {
  const harness = await startTestService();
  t.after(() => {
    t.mock.timers.reset();
    return harness.stop();
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const store = harness.service.confirms;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = raise(store, input('expired'), controller.signal);
  const rejected = assert.rejects(pending.answer, /request expired/);
  await pending.listed;
  t.mock.timers.tick(1800000);
  await rejected;
  t.mock.timers.reset();
  assert.deepEqual(store.pending(), []);
  assert.equal(store.runStatus('fixture-task', 'fixture-run'), 'running');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('a child-only abort withdraws its request, preserves a sibling, and removes the listener', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const child = new AbortController();
  const sibling = new AbortController();
  t.after(() => sibling.abort());
  const store = harness.service.confirms;
  const pending = raise(store, input('child'), child.signal);
  const rejected = assert.rejects(pending.answer, /Task stopped/);
  const other = raise(store, input('sibling'), sibling.signal);
  await Promise.all([pending.listed, other.listed]);
  child.abort();
  await rejected;
  await until(() => store.pending().length === 1);
  assert.equal(store.pending()[0]?.toolCallId, 'sibling');
  assert.equal(getEventListeners(child.signal, 'abort').length, 0);
  const remaining = store.pending()[0];
  assert.ok(remaining);
  await store.reply(remaining.id, remaining.revision, { answer: 'sibling answer' });
  assert.deepEqual(await other.answer, { answer: 'sibling answer' });
  assert.equal(getEventListeners(sibling.signal, 'abort').length, 0);
});

test('graceful stop cancels a running task confirmation and releases its signal listener', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const owner = task('running');
  const run = owner.runs[0];
  assert.ok(run);
  await harness.service.ledger.change((data) => {
    data.tasks.push(owner);
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const pending = raise(
    harness.service.confirms,
    input('shutdown', owner.id, run.id),
    controller.signal,
  );
  const rejected = assert.rejects(pending.answer, /Task stopped/);
  await pending.listed;
  await harness.service.stop();
  await rejected;
  assert.deepEqual(harness.service.confirms.pending(), []);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('abort while request persistence awaits cannot strand a waiter or a pending confirmation', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const gate = Promise.withResolvers<void>();
  t.after(() => gate.resolve());
  // A real serialized ledger write holds the request before it can install its abort listener.
  const writing = harness.service.ledger.change(async () => gate.promise);
  const controller = new AbortController();
  const store = harness.service.confirms;
  const pending = raise(store, input('aborted-during-write'), controller.signal, true);
  const rejected = assert.rejects(pending.answer, /Task stopped/);
  controller.abort();
  gate.resolve();
  await writing;
  await rejected;
  await until(() => store.pending().length === 0);
  assert.equal(store.runStatus('fixture-task', 'fixture-run'), 'running');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
