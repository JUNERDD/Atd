import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PermissionRequestDraft } from '../dist/confirms.js';
import { startTestService } from './service-harness.ts';

function question(runId: string): PermissionRequestDraft {
  return {
    taskId: 'race-task',
    runId,
    executionId: 'root:fixture',
    toolCallId: `question-${runId}`,
    kind: 'input',
    title: 'Synthetic question',
    options: [],
  };
}

for (const blockedWrite of [false, true]) {
  test(`cancellation includes an already started request before waiter registration (blocked=${blockedWrite})`, async (t) => {
    const harness = await startTestService();
    t.after(() => harness.stop());
    const store = harness.service.confirms;
    const gate = Promise.withResolvers<void>();
    t.after(() => gate.resolve());
    const writing = blockedWrite
      ? harness.service.ledger.change(async () => gate.promise)
      : Promise.resolve();
    const resolved: string[] = [];
    const unsubscribe = harness.service.events.onPublish((event) => {
      if (event.type === 'confirm.resolved') resolved.push(event.type);
    });
    t.after(unsubscribe);
    const listed = Promise.withResolvers<void>();
    // ask_user follows this no-signal path; the store must order cancellation with persistence.
    const answer = store.request(question('cancelled'), undefined, {
      listed: () => listed.resolve(),
    });
    void answer.catch(() => undefined);
    t.after(() => store.cancelRun('race-task', 'cancelled', 'Fixture cleanup.'));
    const cancelling = store.cancelRun('race-task', 'cancelled', 'Fixture stopped.');
    gate.resolve();
    await Promise.all([writing, cancelling, listed.promise]);
    assert.deepEqual(store.pending(), []);
    await assert.rejects(answer, /Fixture stopped/);
    assert.equal(store.runStatus('race-task', 'cancelled'), 'running');
    assert.equal(resolved.length, 1);
    await store.cancelRun('race-task', 'cancelled', 'Repeated stop.');
    assert.equal(resolved.length, 1, 'a cancelled request settles exactly once');

    const nextListed = Promise.withResolvers<void>();
    const next = store.request(question('next-run'), undefined, {
      listed: () => nextListed.resolve(),
    });
    await nextListed.promise;
    const request = store.pending()[0];
    assert.ok(request);
    await store.reply(request.id, request.revision, { answer: 'next answer' });
    assert.deepEqual(await next, { answer: 'next answer' });
    assert.deepEqual(store.pending(), []);
  });
}
