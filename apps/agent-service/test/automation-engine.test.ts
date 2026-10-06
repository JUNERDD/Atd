import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { automationKit } from './automation-kit.ts';

/**
 * The engine's timing through `tick(now)` (decision D6): a due occurrence fires once on time
 * through the run pipeline with a durable receipt; a run still going turns the next occurrence
 * into an overlap skip; after a sleep the latest missed occurrence fires once, late, after the
 * wake grace (or is skipped); and two runs at once share the slots in FIFO order.
 */

let kit: Awaited<ReturnType<typeof automationKit>> | null = null;
afterEach(async () => {
  await kit?.stop();
  kit = null;
});

async function open(start = '2026-10-06T08:00:00Z') {
  kit = await automationKit(start);
  return kit;
}

test('a due occurrence fires once, on time, as a new unattended task', async () => {
  const k = await open();
  const automation = await k.create({
    delivery: { notify: 'always', includePreviousResult: false },
  });
  assert.equal(
    k.service.store.data.state.automations[automation.id]?.nextDueAt,
    '2026-10-06T09:00:00.000Z',
  );

  await k.tick('2026-10-06T08:59:30Z');
  assert.equal(k.submitted.length, 0, 'not due yet');
  await k.tick('2026-10-06T09:00:20Z');
  assert.equal(k.submitted.length, 1);
  const [fire] = k.submitted;
  assert.ok(fire);
  const [record] = k.runs(automation.id);
  assert.ok(record);
  assert.equal(record.outcome, 'running');
  assert.equal(record.source, 'schedule');
  assert.equal(record.scheduledFor, '2026-10-06T09:00:00.000Z');
  assert.equal(record.late, undefined);
  assert.equal(record.taskId, fire.taskId, 'the record names its task once accepted');
  assert.equal(fire.request.operationId, `auto_${automation.id}_${record.id}`);
  assert.equal(fire.request.taskId, fire.taskId, 'the task id is chosen before the submit');
  assert.deepEqual(fire.internal.origin, { kind: 'automation', automationId: automation.id });
  assert.equal(fire.internal.permissionTier, 'manual');
  assert.equal(fire.internal.title, 'Morning digest · 2026-10-06 09:00');
  assert.deepEqual(fire.internal.trigger, {
    kind: 'automation',
    automationId: automation.id,
    automationRunId: record.id,
    source: 'schedule',
    firedAt: record.firedAt,
  });
  assert.deepEqual(fire.request.tools, ['read', 'write', 'edit', 'grep', 'find', 'ls']);
  assert.equal(fire.request.memory, false);
  const text = fire.request.input.text;
  assert.match(text, /^<automation-context>\nAutomation: Morning digest\n/);
  assert.match(text, /No one is present while it runs/);
  assert.doesNotMatch(text, /NOTHING_NEW/, 'only asked for when notify is whenNew');
  assert.match(text, /<\/automation-context>\n\nSummarize what changed\.$/);
  assert.equal(
    k.service.store.data.state.automations[automation.id]?.nextDueAt,
    '2026-10-07T09:00:00.000Z',
    'the cursor moved on with the receipt',
  );

  await k.tick('2026-10-06T09:00:50Z');
  assert.equal(k.submitted.length, 1, 'the occurrence fires once');

  await k.finish(fire.taskId, fire.runId, 'completed', 'Two new items arrived.');
  await k.settle();
  const [settled] = k.runs(automation.id);
  assert.equal(settled?.outcome, 'delivered');
  assert.equal(settled?.summary, 'Two new items arrived.');
  assert.ok(settled?.finishedAt);
  const notices = k.service.notices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.kind, 'delivered');
  assert.equal(notices[0]?.taskId, fire.taskId);
  assert.equal(notices[0]?.automationName, 'Morning digest');
});

test('an occurrence that comes due while the last run is going is skipped as overlap', async () => {
  const k = await open();
  const automation = await k.create({
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    },
  });
  await k.tick('2026-10-06T08:15:10Z');
  assert.equal(k.submitted.length, 1);
  await k.tick('2026-10-06T08:30:10Z');
  assert.equal(k.submitted.length, 1, 'single-flight');
  const [skipped, running] = k.runs(automation.id);
  assert.equal(skipped?.outcome, 'skipped');
  assert.equal(skipped?.reason, 'overlap');
  assert.ok(skipped?.readAt, 'skips are recorded read');
  assert.equal(running?.outcome, 'running');
  assert.equal(
    k.service.store.data.state.automations[automation.id]?.nextDueAt,
    '2026-10-06T08:45:00.000Z',
  );
  await assert.rejects(k.service.engine.runNow(automation.id), /already running/);
});

test('after a sleep the latest missed occurrence runs once, late, after the wake grace', async () => {
  const k = await open();
  const automation = await k.create();
  await k.tick('2026-10-06T08:00:30Z');
  // The Mac slept through two occurrences (the 6th and the 7th at 09:00).
  await k.tick('2026-10-07T10:00:00Z');
  assert.equal(k.submitted.length, 0, 'missed occurrences wait for the wake grace');
  await k.tick('2026-10-07T10:00:30Z');
  assert.equal(k.submitted.length, 0);
  await k.tick('2026-10-07T10:01:00Z');
  assert.equal(k.submitted.length, 1, 'one catch-up for both');
  const [record] = k.runs(automation.id);
  assert.equal(record?.scheduledFor, '2026-10-07T09:00:00.000Z', 'the latest occurrence');
  assert.equal(record?.late, true);
  assert.match(k.submitted[0]?.request.input.text ?? '', /1 h 1 min late because Atd was closed/);
  assert.equal(
    k.service.store.data.state.automations[automation.id]?.nextDueAt,
    '2026-10-08T09:00:00.000Z',
  );
});

test('an automation that skips missed runs records one skip and moves on', async () => {
  const k = await open();
  const base = await k.create();
  const policy = { ...base.policy, missedRuns: 'skip' as const };
  const automation = await k.create({ name: 'Skipper', policy });
  await k.tick('2026-10-06T08:00:30Z');
  await k.tick('2026-10-08T12:00:00Z');
  await k.tick('2026-10-08T12:01:30Z');
  const [skipped, ...older] = k.runs(automation.id);
  assert.equal(skipped?.outcome, 'skipped');
  assert.equal(skipped?.reason, 'missed');
  assert.equal(skipped?.scheduledFor, '2026-10-08T09:00:00.000Z');
  assert.equal(older.length, 0, 'one record for every missed occurrence');
  assert.equal(
    k.service.store.data.state.automations[automation.id]?.nextDueAt,
    '2026-10-09T09:00:00.000Z',
  );
  assert.equal(k.runs(base.id)[0]?.late, true, 'the other one caught up');
});

test('two automation runs at once; the third waits its turn', async () => {
  const k = await open();
  const ids: string[] = [];
  for (const name of ['First', 'Second', 'Third']) ids.push((await k.create({ name })).id);
  await k.tick('2026-10-06T09:00:05Z');
  assert.equal(k.submitted.length, 2);
  for (const id of ids) assert.equal(k.runs(id)[0]?.outcome, 'running', 'every fire has a receipt');
  assert.equal(k.runs(ids[2] ?? '')[0]?.taskId, undefined, 'the third has no task yet');
  const first = k.submitted[0];
  assert.ok(first);
  await k.finish(first.taskId, first.runId, 'completed', 'NOTHING_NEW');
  await k.settle();
  assert.equal(k.submitted.length, 3, 'a slot freed up');
  assert.deepEqual(
    k.submitted.map((item) => item.internal.origin),
    ids.map((automationId) => ({ kind: 'automation', automationId })),
    'first in, first out',
  );
  const [nothing] = k.runs(ids[0] ?? '');
  assert.equal(nothing?.outcome, 'nothingNew');
  assert.ok(nothing?.readAt, 'a run with nothing new is silent');
  assert.equal(k.service.notices().length, 0);
});

test('the global pause turns due occurrences into one skip each pause', async () => {
  const k = await open();
  const automation = await k.create({
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    },
  });
  await k.service.store.change((data) => {
    data.definitions.paused = true;
  });
  await k.tick('2026-10-06T08:15:10Z');
  await k.tick('2026-10-06T08:30:10Z');
  await k.tick('2026-10-06T08:45:10Z');
  assert.equal(k.submitted.length, 0);
  const runs = k.runs(automation.id);
  assert.equal(runs.length, 1, 'the pause leaves one record');
  assert.equal(runs[0]?.reason, 'paused');
  const run = await k.service.engine.runNow(automation.id);
  assert.equal(run.outcome, 'running', 'Run now still runs');
});

test('one automation whose cursor cannot be computed never stops the others', async () => {
  const k = await open();
  const good = await k.create({ name: 'Good' });
  const bad = await k.create({ name: 'Bad' });
  // Its state was lost and its zone is one this runtime no longer knows.
  await k.service.store.change((data) => {
    const item = data.definitions.automations.find((entry) => entry.id === bad.id);
    if (item?.trigger.kind === 'schedule') item.trigger.timezone = 'Mars/Olympus';
    const state = data.state.automations[bad.id];
    if (state) delete state.nextDueAt;
  });
  await k.tick('2026-10-06T08:00:30Z');
  await k.tick('2026-10-06T09:00:10Z');
  assert.equal(k.submitted.length, 1);
  assert.equal(k.runs(good.id)[0]?.outcome, 'running', 'the healthy automation fires');
  assert.equal((await k.service.item(bad.id)).status.problem, 'invalidTimeZone');
});

test('an occurrence a slow tick finds is on time, not missed', async () => {
  const k = await open();
  const base = await k.create({ enabled: false });
  const policy = { ...base.policy, missedRuns: 'skip' as const };
  const automation = await k.create({ name: 'Skipper', policy });
  await k.tick('2026-10-06T08:59:25Z');
  await k.tick('2026-10-06T08:59:55Z');
  // The next tick comes 70 s later (a busy loop, coalesced timers); no sleep was detected.
  await k.tick('2026-10-06T09:01:05Z');
  const [record] = k.runs(automation.id);
  assert.equal(record?.outcome, 'running');
  assert.equal(record?.late, undefined);
});
