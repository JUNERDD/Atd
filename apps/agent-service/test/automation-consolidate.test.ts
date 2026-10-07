import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { AutomationDraft } from '@atd/agent-contracts';
import { deleteAutomation } from '../dist/automations/edits.js';
import { automationKit } from './automation-kit.ts';

/**
 * `consolidateMemory` runs: they start no task, call the memory engine's job with the policy's
 * model and an abort signal, and settle its answer as the run's result (delivered, nothing new,
 * skipped while memory learning is paused, failed). They are stopped by deletion, their maximum
 * duration and the service stopping; a record a crash left running settles as interrupted.
 * Having no task to open, every result is recorded as read.
 */

let kit: Awaited<ReturnType<typeof automationKit>> | null = null;
afterEach(async () => {
  await kit?.stop();
  kit = null;
});

const consolidation: Partial<AutomationDraft> = {
  name: 'Consolidate memory',
  trigger: { kind: 'idle', idleMinutes: 15, timezone: 'UTC' },
  action: { kind: 'consolidateMemory' },
  // Ignored for this action: an unregistered folder does not refuse the save.
  policy: {
    permissionTier: 'auto',
    memory: true,
    folderIds: ['not-registered'],
    maxDurationMinutes: 15,
    missedRuns: 'skip',
    thinkingLevel: 'low',
  },
};

async function open() {
  const k = await automationKit('2026-10-06T08:00:00Z', { defaults: false });
  kit = k;
  const automation = await k.create(consolidation);
  /** Runs it now and answers the job's call with what `respond` does. */
  const run = async (respond: (call: (typeof k.consolidations)[number]) => void) => {
    const record = await k.service.engine.runNow(automation.id);
    await k.settle();
    const call = k.consolidations.at(-1);
    assert.ok(call);
    assert.equal(call.request.automationRunId, record.id);
    respond(call);
    await k.settle();
    return k.runs(automation.id)[0];
  };
  return { k, automation, run };
}

test('each answer of the memory engine settles the run, with no task', async () => {
  const { k, automation, run } = await open();
  const follower = await k.create({
    name: 'After consolidation',
    trigger: { kind: 'automation', automationId: automation.id, outcomes: ['delivered'] },
  });

  const delivered = await run((call) => {
    assert.equal(call.request.automationId, automation.id);
    assert.equal(call.request.model, undefined);
    assert.equal(call.request.thinkingLevel, 'low');
    assert.equal(call.request.signal.aborted, false);
    call.answer({ outcome: 'delivered', summary: 'Merged 3 notes.', applied: 3, proposed: 1 });
  });
  assert.equal(delivered?.outcome, 'delivered');
  assert.equal(delivered?.summary, 'Merged 3 notes.');
  assert.equal(delivered?.taskId, undefined);
  assert.equal(delivered?.readAt, delivered?.finishedAt, 'no task to open: recorded as read');
  const notice = k.service.notices().find((item) => item.automationId === automation.id);
  assert.equal(notice?.kind, 'delivered');
  assert.equal(notice?.taskId, undefined);
  assert.equal(k.submitted.length, 1, 'only the chained automation starts a task');
  assert.deepEqual(k.submitted[0]?.internal.origin, {
    kind: 'automation',
    automationId: follower.id,
  });
  assert.match(k.submitted[0]?.request.input.text ?? '', /Merged 3 notes\./);

  const quiet = await run((call) => call.answer({ outcome: 'nothingNew' }));
  assert.equal(quiet?.outcome, 'nothingNew');
  assert.ok(quiet?.readAt, 'silent runs are read');
  const paused = await run((call) => call.answer({ outcome: 'skipped', reason: 'memoryPaused' }));
  assert.equal(paused?.outcome, 'skipped');
  assert.equal(paused?.reason, 'memoryPaused');
  assert.equal(k.service.notices().length, 1, 'neither posts a notice');

  const noModel = await run((call) =>
    call.answer({ outcome: 'failed', reason: 'modelUnavailable', detail: 'No connection.' }),
  );
  assert.equal(noModel?.outcome, 'failed');
  assert.equal(noModel?.reason, 'modelUnavailable');
  assert.equal(noModel?.detail, 'No connection.');
  const broken = await run((call) => call.fail(new Error('The reply was not JSON.')));
  assert.equal(broken?.reason, 'runFailed');
  assert.equal(broken?.detail, 'The reply was not JSON.');
  assert.equal(k.service.notices().at(-1)?.kind, 'failed');
  assert.equal(broken?.readAt, broken?.finishedAt, 'failures are read too; their notice remains');

  // The third failure in a row: running past its maximum duration turns the automation off.
  await k.service.engine.runNow(automation.id);
  await k.settle();
  const late = k.consolidations.at(-1);
  await k.tick('2026-10-06T08:16:00Z');
  assert.equal(late?.request.signal.aborted, true);
  assert.equal(k.runs(automation.id)[0]?.outcome, 'timedOut');
  assert.equal(k.service.automation(automation.id).enabled, false);
  assert.equal(k.service.store.data.state.automations[automation.id]?.pausedReason, 'failures');
  assert.equal((await k.service.item(automation.id)).status.unread, 0);
});

test('deleting stops it; a stop settles it; a crash leaves it interrupted', async () => {
  const { k, automation } = await open();
  await k.service.engine.runNow(automation.id);
  await k.settle();
  await k.restart();
  const [stopped] = k.runs(automation.id);
  assert.equal(k.consolidations[0]?.request.signal.aborted, true);
  assert.equal(stopped?.outcome, 'stopped');
  assert.equal(stopped?.detail, 'Atd quit during the run.');

  await k.service.store.change((data) => {
    data.state.automations[automation.id]?.runs.unshift({
      id: 'left-running',
      automationId: automation.id,
      source: 'idle',
      firedAt: '2026-10-06T08:00:00.000Z',
      outcome: 'running',
    });
  });
  await k.restart();
  const [interrupted] = k.runs(automation.id);
  assert.equal(interrupted?.outcome, 'interrupted');
  assert.equal(interrupted?.detail, 'Atd stopped during the memory consolidation.');
  assert.ok(interrupted?.readAt);

  await k.service.engine.runNow(automation.id);
  await k.settle();
  await deleteAutomation(k.service.edits(), automation.id, async () => undefined);
  await k.settle();
  assert.equal(k.consolidations.at(-1)?.request.signal.aborted, true);
  assert.equal(k.service.store.data.state.automations[automation.id], undefined);
});
