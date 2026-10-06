import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentHttpClient } from '@atd/agent-client';
import type { InvalidateFrame } from '@atd/agent-contracts';
import { automationItem } from '../../tests/automation-fixtures';
import { AutomationConflictError, AutomationProblemError } from '../client/automations-contract';
import type { NativeBridge } from '../native-bridge/client';
import type { NativeConnection } from './native-connection';
import { nativeAutomations, nativeTaskOpen } from './native-automations';
import type { WindowMessages } from './window-messages';

const BASE = 'ai-app://renderer';

/** A relay that answers each request with the next queued response and records what was sent. */
function fakeRelay(...responses: Response[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const response = responses.shift();
    if (!response) throw new Error('No response queued.');
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  const sent = (index: number) => {
    const [url, init] = fetch.mock.calls[index] ?? [];
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    return { url, method: init?.method, headers: init?.headers, body };
  };
  return { fetch, sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const empty = () => new Response(null, { status: 204 });
const conflict = () =>
  json({ error: { code: 'conflict', message: 'The automation changed.' } }, 409);

/** The bridge over a connection whose invalidations and reconnects the test sends. */
function bridge() {
  const invalidate = new Set<(frame: InvalidateFrame) => void>();
  const connected = new Set<() => void>();
  const http = new AgentHttpClient({ baseUrl: BASE, relay: true });
  const connection = {
    options: () => ({ baseUrl: BASE, relay: true as const }),
    http: () => http,
    onInvalidate: (listener: (frame: InvalidateFrame) => void) => {
      invalidate.add(listener);
      return () => invalidate.delete(listener);
    },
    onConnected: (listener: () => void) => {
      connected.add(listener);
      return () => connected.delete(listener);
    },
  } as unknown as NativeConnection;
  const call = vi.fn(async () => ({}));
  const native = { call } as unknown as NativeBridge;
  const post = vi.fn();
  const messages = { post, listen: () => () => {} } as unknown as WindowMessages;
  return {
    automations: nativeAutomations(connection, native, messages),
    call,
    post,
    emit: (frame: InvalidateFrame) => invalidate.forEach((listener) => listener(frame)),
    reconnect: () => connected.forEach((listener) => listener()),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('automations client', () => {
  it('lists automations through the relay and checks the answer against the contract', async () => {
    const item = automationItem({ id: 'morning', name: 'Morning brief' });
    const { sent } = fakeRelay(json({ automations: [item], paused: false }));
    const { automations } = bridge();
    await expect(automations.list()).resolves.toEqual({ automations: [item], paused: false });
    expect(sent(0)).toMatchObject({
      url: `${BASE}/v1/automations`,
      method: 'GET',
      headers: { 'x-ai-relay': '1' },
    });
  });

  it('rejects an answer outside the contract', async () => {
    const item = automationItem({ id: 'morning', name: 'Morning brief' });
    fakeRelay(json({ automations: [{ ...item, status: { unread: -1, running: false } }] }));
    await expect(bridge().automations.list()).rejects.toThrow(/Invalid data/);
  });

  it('refuses a draft the contract rejects before sending it', async () => {
    const { fetch } = fakeRelay();
    const { trigger, action, policy, delivery } = automationItem({
      id: 'morning',
      name: '',
    }).automation;
    const draft = { name: '', enabled: true, trigger, action, policy, delivery };
    // The client checks while it builds the request, so the call itself throws.
    await expect(async () => bridge().automations.create(draft)).rejects.toThrow(
      /Invalid data: \/name/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves with the revision it edited and reports a conflict by its type', async () => {
    const item = automationItem({ id: 'morning', name: 'Morning brief', revision: 3 });
    const { sent } = fakeRelay(json(item), conflict());
    const { automations } = bridge();
    const { name, enabled, trigger, action, policy, delivery } = item.automation;
    const draft = { name, enabled, trigger, action, policy, delivery };
    await automations.update('morning', 3, draft);
    expect(sent(0)).toMatchObject({
      url: `${BASE}/v1/automations/morning`,
      method: 'PUT',
      body: { expectedRevision: 3, automation: draft },
    });
    await expect(automations.update('morning', 3, draft)).rejects.toBeInstanceOf(
      AutomationConflictError,
    );
  });

  it('runs, lists runs, deletes, previews, marks read and pauses on their routes', async () => {
    const run = {
      id: 'run-1',
      automationId: 'morning',
      source: 'manual',
      firedAt: 'now',
      outcome: 'running',
    };
    const { sent } = fakeRelay(
      json({ run }),
      conflict(),
      json({ runs: [run] }),
      empty(),
      json({ nextRuns: [], problem: 'tooFrequent' }),
      empty(),
      json({ paused: true }),
    );
    const { automations } = bridge();
    await expect(automations.run('morning')).resolves.toEqual(run);
    await expect(automations.run('morning')).rejects.toBeInstanceOf(AutomationConflictError);
    await expect(automations.runs('morning')).resolves.toEqual([run]);
    await expect(automations.remove('morning')).resolves.toBeUndefined();
    const trigger = {
      kind: 'schedule',
      schedule: { kind: 'cron', expression: '* * * * *' },
      timezone: 'UTC',
    } as const;
    await expect(automations.preview({ trigger, count: 3 })).resolves.toEqual({
      nextRuns: [],
      problem: 'tooFrequent',
    });
    await automations.markRead({ taskIds: ['task-1'] });
    await automations.setPaused(true);
    expect([0, 2, 3, 4, 5, 6].map((index) => [sent(index).method, sent(index).url])).toEqual([
      ['POST', `${BASE}/v1/automations/morning/run`],
      ['GET', `${BASE}/v1/automations/morning/runs?limit=100`],
      ['DELETE', `${BASE}/v1/automations/morning`],
      ['POST', `${BASE}/v1/automations/preview`],
      ['POST', `${BASE}/v1/automation-runs/read`],
      ['PATCH', `${BASE}/v1/automation-settings`],
    ]);
    expect(sent(5).body).toEqual({ taskIds: ['task-1'] });
    expect(sent(6).body).toEqual({ paused: true });
  });

  it('names a refusal the service words by code, and leaves other refusals as they are', async () => {
    const { trigger, action, policy, delivery } = automationItem({
      id: 'once',
      name: 'Once',
    }).automation;
    const draft = { name: 'Once', enabled: true, trigger, action, policy, delivery };
    const refused = (message: string) => json({ error: { code: 'bad_request', message } }, 400);
    fakeRelay(
      refused('Invalid automation (inPast): The one-time run lies in the past.'),
      refused('Invalid automation (somethingNew): A code this page does not know.'),
      refused('Invalid automation: at most 100 automations can be saved.'),
    );
    const { automations } = bridge();
    await expect(automations.setEnabled('once', true)).rejects.toMatchObject({
      constructor: AutomationProblemError,
      problem: 'inPast',
    });
    const unknown = automations.create(draft);
    await expect(unknown).rejects.not.toBeInstanceOf(AutomationProblemError);
    await expect(automations.create(draft)).rejects.toThrow('at most 100 automations');
  });

  it('asks the service whether a run’s task still exists', async () => {
    const { sent } = fakeRelay(
      json({ error: { code: 'not_found', message: 'Task task-1 was not found.' } }, 404),
      json({ error: { code: 'internal', message: 'Down.' } }, 500),
    );
    const { automations } = bridge();
    await expect(automations.taskExists('task-1')).resolves.toBe(false);
    expect(sent(0)).toMatchObject({ url: `${BASE}/v1/tasks/task-1/summary`, method: 'GET' });
    await expect(automations.taskExists('task-1')).rejects.toThrow('Down.');
  });

  it('reports automation changes and reconnects, not other invalidations', () => {
    const { automations, emit, reconnect } = bridge();
    const listener = vi.fn();
    const stop = automations.onChange(listener);
    emit({ type: 'invalidate', scope: 'apps' });
    emit({ type: 'invalidate', scope: 'automations' });
    reconnect();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    emit({ type: 'invalidate', scope: 'automations' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('shows a task in the panel through the window message the panel follows', async () => {
    const { automations, call, post } = bridge();
    await automations.showTask('task-1');
    expect(post).toHaveBeenCalledWith({ type: 'openTask', taskId: 'task-1' });
    expect(call).toHaveBeenCalledWith('window.show', {});
  });
});

describe('task.open', () => {
  it('holds a request that arrives before the panel subscribes, then delivers it once', () => {
    let deliver: (payload: { taskId: string }) => void = () => {};
    const native = {
      on: (_event: string, listener: (payload: { taskId: string }) => void) => {
        deliver = listener;
        return () => {};
      },
    } as unknown as NativeBridge;
    const subscribe = nativeTaskOpen(native);
    deliver({ taskId: 'early' });
    const first = vi.fn();
    const stop = subscribe(first);
    expect(first).toHaveBeenCalledWith('early');
    deliver({ taskId: 'later' });
    expect(first).toHaveBeenLastCalledWith('later');
    stop();
    const second = vi.fn();
    subscribe(second);
    expect(second).not.toHaveBeenCalled();
  });
});
