import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import type { GateRequest } from '../dist/harness/gate.js';
import { runAutomationCall } from '../dist/automations/tool.js';
import { automationKit, draft } from './automation-kit.ts';

/**
 * The automations store never stops a boot (decision D9): a file that cannot be read leaves the
 * engine inert and the list reporting the problem, and the next change moves the file aside.
 * The `automation` tool (decision D10) asks before every change, and refuses changes in a run an
 * automation started.
 */

let kit: Awaited<ReturnType<typeof automationKit>> | null = null;
afterEach(async () => {
  await kit?.stop();
  kit = null;
});

test('an unreadable file leaves automations inert until the next change moves it aside', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z');
  kit = k;
  await k.create();
  const dir = path.join(k.root, 'automations');
  await writeFile(path.join(dir, 'automations.json'), '{"version": 1, "automa');
  await writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 2, automations: {} }));
  await k.restart();

  const listed = await k.service.list();
  assert.deepEqual(listed.automations, []);
  assert.match(listed.problem ?? '', /saved automations file could not be read/);
  assert.match(listed.problem ?? '', /run history file is damaged or from a newer version/);
  await k.tick('2026-10-06T09:00:10Z');
  assert.equal(k.submitted.length, 0, 'nothing fires while inert');
  await assert.rejects(k.service.engine.runNow('anything'), /cannot run until/);

  const created = await k.create({
    name: 'Fresh start',
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'interval', everyMinutes: 15 },
      timezone: 'UTC',
    },
  });
  const files = await readdir(dir);
  assert.equal(files.filter((name) => name.startsWith('automations.json.invalid-')).length, 1);
  assert.equal(files.filter((name) => name.startsWith('state.json.invalid-')).length, 1);
  const saved = JSON.parse(await readFile(path.join(dir, 'automations.json'), 'utf8'));
  assert.deepEqual(
    saved.automations.map((item: { id: string }) => item.id),
    [created.id],
  );
  const after = await k.service.list();
  assert.equal(after.problem, undefined);
  assert.equal(after.automations.length, 1);
  await k.tick('2026-10-06T09:15:20Z');
  assert.equal(k.submitted.length, 1, 'firing again after the save');
});

test('the agent tool asks before every change and only reads in an automation run', async () => {
  const k = await automationKit('2026-10-06T08:00:00Z');
  kit = k;
  const asked: GateRequest[] = [];
  let unattended = false;
  const ctx = {
    dataDir: k.root,
    gate: async (request: GateRequest) => {
      asked.push(request);
      return 'once' as const;
    },
    unattended: () => unattended,
    folders: () => [],
  };
  const call = (args: unknown) => runAutomationCall(ctx, args, 'call-1', undefined);

  assert.equal(await call({ op: 'list' }), 'The person has no automations yet.');
  const preview = JSON.parse(
    await call({
      op: 'preview',
      trigger: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' }, timezone: 'UTC' },
    }),
  );
  assert.equal(preview.nextRuns.length, 3);
  assert.equal(asked.length, 0, 'reading asks nothing');

  const created = JSON.parse(await call({ op: 'create', automation: draft() }));
  assert.equal(asked.length, 1);
  const [confirm] = asked;
  assert.equal(confirm?.askAlways, true);
  assert.deepEqual(confirm?.scope, { tool: 'automation' });
  assert.equal(confirm?.title, 'Create the automation "Morning digest"?');
  assert.match(confirm?.detail ?? '', /When: Every day at 09:00 \(UTC\)/);
  assert.match(
    confirm?.detail ?? '',
    /Next runs: 2026-10-06 09:00; 2026-10-07 09:00; 2026-10-08 09:00/,
  );
  assert.match(confirm?.detail ?? '', /Approval tier: manual/);
  assert.match(confirm?.detail ?? '', /Tools: read, write, edit, grep, find, ls/);
  assert.match(confirm?.detail ?? '', /Notifies when there is something new/);
  assert.equal(k.service.automation(created.id).createdBy, 'agent');

  await assert.rejects(
    call({
      op: 'create',
      automation: draft({
        trigger: { kind: 'automation', automationId: 'gone', outcomes: ['failed'] },
      }),
    }),
    /\(unknownAutomation\)/,
  );
  assert.equal(asked.length, 1, 'a draft that cannot be saved is refused before asking');

  unattended = true;
  await assert.rejects(
    call({ op: 'run', automationId: created.id }),
    /cannot change or run automations/,
  );
  await assert.rejects(call({ op: 'delete', automationId: created.id }), /cannot change or run/);
  assert.ok(JSON.parse(await call({ op: 'get', automationId: created.id })).automation);
  assert.equal(asked.length, 1);

  unattended = false;
  const ran = JSON.parse(await call({ op: 'run', automationId: created.id }));
  assert.equal(ran.outcome, 'running');
  assert.equal(asked.at(-1)?.title, 'Run the automation "Morning digest" now?');
});
