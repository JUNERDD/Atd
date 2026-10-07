import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { AutomationTrigger, TaskInput } from '@atd/agent-contracts';
import { defaultsMarker } from '../dist/automations/defaults.js';
import { deleteAutomation } from '../dist/automations/edits.js';
import { SystemActivity } from '../dist/system-activity.js';
import { automationKit } from './automation-kit.ts';

/**
 * Idle triggers and the default automation: an idle trigger fires at most once per calendar day
 * in its time zone, only while the shell's fresh report says the Mac has been idle long enough and
 * no run the person started is going; a stale report never counts. Every data dir gets the
 * default memory consolidation once, and deleting it sticks.
 */

let kit: Awaited<ReturnType<typeof automationKit>> | null = null;
afterEach(async () => {
  await kit?.stop();
  kit = null;
});

const idle: AutomationTrigger = { kind: 'idle', idleMinutes: 15, timezone: 'Asia/Shanghai' };

function personInput(text: string): TaskInput {
  return {
    text,
    source: 'manual',
    capturedAt: '2026-10-06T08:00:00Z',
    selection: '',
    clipboard: '',
    files: [],
    arguments: {},
    chips: [],
    folders: [],
  };
}

test('a report goes stale after three minutes; until then idle time keeps counting', () => {
  const clock = { now: Date.parse('2026-10-06T08:00:00Z') };
  const activity = new SystemActivity(() => clock.now);
  assert.equal(activity.idleSeconds(), null, 'no report: unknown');
  activity.report(100);
  clock.now += 60_000;
  assert.equal(activity.idleSeconds(), 160);
  clock.now += 121_000;
  assert.equal(activity.idleSeconds(), null, 'older than the stale bound');
  assert.equal(activity.idleSeconds(clock.now - 300_000), null, 'a clock that went back');
});

test('an idle trigger fires once per local day, only when idle with no run of the person', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z', { defaults: false });
  kit = k;
  const automation = await k.create({ trigger: idle });
  assert.equal(k.service.store.data.state.automations[automation.id]?.nextDueAt, undefined);

  await k.tick('2026-10-06T08:00:00Z');
  assert.equal(k.submitted.length, 0, 'no report: never idle');
  k.activity.report(600);
  await k.tick('2026-10-06T08:00:30Z');
  assert.equal(k.submitted.length, 0, '630 seconds is not 15 minutes');

  const person = await k.manager.submit({ operationId: 'person-1', input: personInput('Hi') });
  k.activity.report(900);
  await k.tick('2026-10-06T08:01:00Z');
  assert.equal(k.submitted.length, 1, 'only the person run');
  await k.finish(person.taskId, person.runId, 'completed', 'Hello.');
  await k.tick('2026-10-06T08:01:30Z');
  assert.equal(k.submitted.length, 2, 'fires once the person run ended');
  const fire = k.submitted[1];
  assert.ok(fire);
  assert.equal(fire.internal.trigger?.source, 'idle');
  assert.equal(fire.internal.title, 'Morning digest · 2026-10-06 16:01', 'titled in its zone');
  assert.match(fire.request.input.text, /The Mac has been idle/);
  const [record] = k.runs(automation.id);
  assert.equal(record?.source, 'idle');
  assert.equal(record?.scheduledFor, undefined);

  await k.finish(fire.taskId, fire.runId, 'completed', 'Tidied up.');
  await k.settle();
  assert.equal(k.runs(automation.id)[0]?.outcome, 'delivered');
  k.activity.report(3000);
  await k.tick('2026-10-06T08:02:00Z');
  await k.tick('2026-10-06T08:03:00Z');
  assert.equal(k.submitted.length, 2, 'once per day');

  // 16:00Z is midnight in Shanghai. The jump starts the wake grace, which holds it off first.
  k.activity.report(3000);
  await k.tick('2026-10-06T16:00:30Z');
  assert.equal(k.submitted.length, 2, 'within the wake grace');
  k.activity.report(3000);
  await k.tick('2026-10-06T16:01:40Z');
  assert.equal(k.submitted.length, 3, 'a new local day');
  assert.equal(k.runs(automation.id).length, 2);
});

test('a stale report never fires; a global pause holds it off without a record', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z', { defaults: false });
  kit = k;
  const automation = await k.create({ trigger: idle });
  await k.tick('2026-10-06T08:00:00Z');
  k.activity.report(3600);
  await k.service.edits().store.change((data) => {
    data.definitions.paused = true;
  });
  await k.tick('2026-10-06T08:00:30Z');
  assert.equal(k.submitted.length, 0);
  assert.deepEqual(k.runs(automation.id), [], 'the pause records nothing');
  await k.service.edits().store.change((data) => {
    data.definitions.paused = false;
  });

  await k.tick('2026-10-06T08:03:20Z');
  await k.tick('2026-10-06T08:04:30Z');
  assert.equal(k.submitted.length, 0, 'the report went stale');
  k.activity.report(3600);
  await k.tick('2026-10-06T08:05:00Z');
  assert.equal(k.submitted.length, 1, 'a fresh report fires it');
});

test('every data dir gets the default consolidation once, and deleting it sticks', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z', { language: 'zh-CN' });
  kit = k;
  const [seeded] = k.service.store.data.definitions.automations;
  assert.ok(seeded);
  assert.equal(seeded.id, 'default-memory-consolidation');
  assert.equal(seeded.name, '整理记忆');
  assert.equal(seeded.createdBy, 'user');
  assert.deepEqual(seeded.trigger, {
    kind: 'idle',
    idleMinutes: 120,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  assert.deepEqual(seeded.action, { kind: 'consolidateMemory' });
  assert.deepEqual(seeded.policy, {
    permissionTier: 'auto',
    memory: true,
    folderIds: [],
    maxDurationMinutes: 15,
    missedRuns: 'skip',
  });
  assert.deepEqual(seeded.delivery, { notify: 'whenNew', includePreviousResult: false });
  const marker = JSON.parse(await readFile(defaultsMarker(k.root), 'utf8'));
  assert.deepEqual(marker.added, ['default-memory-consolidation']);

  await deleteAutomation(k.service.edits(), seeded.id, async () => undefined);
  await k.restart();
  assert.deepEqual(k.service.store.data.definitions.automations, [], 'never added again');
});

test('an unreadable store is not seeded, and the next start tries again', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z', { defaults: false });
  kit = k;
  await rm(defaultsMarker(k.root));
  const file = path.join(k.root, 'automations', 'automations.json');
  await writeFile(file, '{"version": 1, "automa');
  await k.restart();
  assert.ok(k.service.store.problem);
  await assert.rejects(access(defaultsMarker(k.root)), 'no marker while unreadable');

  await rm(file);
  await k.restart();
  assert.deepEqual(
    k.service.store.data.definitions.automations.map((item) => item.id),
    ['default-memory-consolidation'],
  );
});
