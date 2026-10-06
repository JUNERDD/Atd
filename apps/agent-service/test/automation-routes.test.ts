import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  AutomationItemSchema,
  AutomationListResponseSchema,
  AutomationNoticesResponseSchema,
  AutomationRunsResponseSchema,
  ErrorEnvelopeSchema,
  parse,
  PreviewAutomationTriggerResponseSchema,
  type AutomationTrigger,
} from '@atd/agent-contracts';
import { draft } from './automation-kit.ts';
import { startTestService } from './service-harness.ts';
import { openStream } from './stream-client.ts';

/**
 * The automation routes on the real service (decision record §3): status codes, the 400s that
 * name a problem, revision guards, previews, the global pause, the shell's notice routes, and the
 * one coalesced `automations` invalidation every write sends.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
let scratch = '';
before(async () => {
  harness = await startTestService();
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'automation-routes-')));
});
after(async () => {
  await harness.stop();
  await rm(scratch, { recursive: true, force: true });
});

async function send(pathname: string, method = 'GET', body?: unknown) {
  const response = await harness.call(pathname, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: (text ? JSON.parse(text) : null) as unknown };
}

async function refused(pathname: string, method: string, body: unknown, status: number) {
  const response = await send(pathname, method, body);
  assert.equal(response.status, status, JSON.stringify(response.json));
  return parse(ErrorEnvelopeSchema, response.json).error;
}

const daily: AutomationTrigger = {
  kind: 'schedule',
  schedule: { kind: 'daily', time: '09:00' },
  timezone: 'Asia/Shanghai',
};

test('automations are created, read, changed, switched and deleted', async () => {
  const empty = parse(AutomationListResponseSchema, (await send('/v1/automations')).json);
  assert.deepEqual(empty, { automations: [], paused: false });

  const stream = await openStream(harness.baseUrl, harness.config.token);
  const created = await send('/v1/automations', 'POST', draft({ trigger: daily }));
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const item = parse(AutomationItemSchema, created.json);
  assert.equal(item.automation.createdBy, 'user');
  assert.equal(item.automation.revision, 1);
  assert.ok(item.status.nextRunAt);
  assert.equal(item.status.running, false);
  assert.deepEqual(item.status.folders, []);
  const frame = await stream.next('invalidate');
  assert.equal(frame.scope, 'automations');
  stream.close();

  const id = item.automation.id;
  assert.equal((await send(`/v1/automations/${id}`)).status, 200);
  assert.equal((await send('/v1/automations/unknown-id')).status, 404);

  const stale = await refused(
    `/v1/automations/${id}`,
    'PUT',
    {
      expectedRevision: 7,
      automation: draft({ trigger: daily }),
    },
    409,
  );
  assert.equal(stale.code, 'conflict');
  const renamed = await send(`/v1/automations/${id}`, 'PUT', {
    expectedRevision: 1,
    automation: draft({ name: 'Evening digest', trigger: daily }),
  });
  assert.equal(parse(AutomationItemSchema, renamed.json).automation.revision, 2);

  const off = await send(`/v1/automations/${id}`, 'PATCH', { enabled: false });
  const switched = parse(AutomationItemSchema, off.json);
  assert.equal(switched.automation.enabled, false);
  assert.equal(switched.status.nextRunAt, undefined);

  const runs = await send(`/v1/automations/${id}/runs?limit=5`);
  assert.deepEqual(parse(AutomationRunsResponseSchema, runs.json), { runs: [] });
  await refused(`/v1/automations/${id}/runs?limit=abc`, 'GET', undefined, 400);
  assert.equal((await send('/v1/automation-runs/read', 'POST', { runIds: ['x'] })).status, 204);

  assert.equal((await send(`/v1/automations/${id}`, 'DELETE')).status, 204);
  assert.equal((await send(`/v1/automations/${id}`)).status, 404);
});

test('saves name the problem; previews report it with the next run times', async () => {
  const tooOften = await refused(
    '/v1/automations',
    'POST',
    draft({
      trigger: {
        kind: 'schedule',
        schedule: { kind: 'cron', expression: '*/5 * * * *' },
        timezone: 'UTC',
      },
    }),
    400,
  );
  assert.match(tooOften.message, /\(tooFrequent\)/);
  const zone = await refused(
    '/v1/automations',
    'POST',
    draft({
      trigger: { ...daily, timezone: 'Mars/Olympus' },
    }),
    400,
  );
  assert.match(zone.message, /\(invalidTimeZone\)/);
  const folder = await refused(
    '/v1/automations',
    'POST',
    draft({
      trigger: {
        kind: 'folder',
        folderId: 'not-registered',
        events: ['added'],
        patterns: [],
        recursive: false,
      },
    }),
    400,
  );
  assert.match(folder.message, /\(unknownFolder\)/);
  const command = await refused(
    '/v1/automations',
    'POST',
    draft({
      action: { kind: 'command', commandId: 'no-such-command', arguments: {}, input: '' },
    }),
    400,
  );
  assert.match(command.message, /\(commandUnavailable\)/);

  const preview = async (body: unknown) =>
    parse(
      PreviewAutomationTriggerResponseSchema,
      (await send('/v1/automations/preview', 'POST', body)).json,
    );
  const next = await preview({ trigger: daily, count: 3 });
  assert.equal(next.nextRuns.length, 3);
  assert.equal(next.problem, undefined);
  assert.match(next.nextRuns[0] ?? '', /T01:00:00\.000Z$/, '09:00 in Shanghai');
  assert.deepEqual(
    await preview({ trigger: { kind: 'automation', automationId: 'gone', outcomes: ['failed'] } }),
    {
      nextRuns: [],
      problem: 'unknownAutomation',
    },
  );

  const first = parse(
    AutomationItemSchema,
    (await send('/v1/automations', 'POST', draft({ trigger: daily }))).json,
  );
  const chained = draft({
    name: 'Follow-up',
    trigger: { kind: 'automation', automationId: first.automation.id, outcomes: ['delivered'] },
  });
  const second = parse(AutomationItemSchema, (await send('/v1/automations', 'POST', chained)).json);
  const loop = await preview({
    trigger: { kind: 'automation', automationId: second.automation.id, outcomes: ['delivered'] },
    automationId: first.automation.id,
  });
  assert.equal(loop.problem, 'chainLoop');
  const back = await refused(
    `/v1/automations/${first.automation.id}`,
    'PUT',
    {
      expectedRevision: 1,
      automation: draft({
        trigger: { kind: 'automation', automationId: second.automation.id, outcomes: ['failed'] },
      }),
    },
    400,
  );
  assert.match(back.message, /\(chainLoop\)/);
});

test('a registered folder can be watched; the pause and the notices are reachable', async () => {
  const watched = path.join(scratch, 'inbox');
  await mkdir(watched);
  const registered = await send('/v1/folders/register', 'POST', { paths: [watched] });
  const folderId = (registered.json as { registered: Array<{ folder: { id: string } }> })
    .registered[0]?.folder.id;
  assert.ok(folderId);
  const created = await send(
    '/v1/automations',
    'POST',
    draft({
      trigger: {
        kind: 'folder',
        folderId,
        events: ['added', 'changed'],
        patterns: ['*.csv'],
        recursive: true,
      },
    }),
  );
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const watching = parse(AutomationItemSchema, created.json);
  assert.deepEqual(
    watching.status.folders,
    [{ id: folderId, name: 'inbox' }],
    'names, never paths',
  );

  const paused = await send('/v1/automation-settings', 'PATCH', { paused: true });
  assert.deepEqual(paused.json, { paused: true });
  assert.equal(
    parse(AutomationListResponseSchema, (await send('/v1/automations')).json).paused,
    true,
  );
  await send('/v1/automation-settings', 'PATCH', { paused: false });

  const notices = parse(
    AutomationNoticesResponseSchema,
    (await send('/v1/automation-notices')).json,
  );
  assert.deepEqual(notices, { notices: [] });
  assert.equal(
    (await send('/v1/automation-notices/ack', 'POST', { ids: ['unknown'] })).status,
    204,
  );
  await refused('/v1/automation-notices/ack', 'POST', { ids: [] }, 400);
});
