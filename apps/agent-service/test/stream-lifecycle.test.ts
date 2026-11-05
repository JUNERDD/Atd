import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { CapabilityRequestSchema, parse } from '@atd/agent-contracts';
import { EventLog } from '../dist/event-log.js';
import { Ledger } from '../dist/ledger.js';
import { ProgressBoard } from '../dist/computer/progress.js';
import { startTestService } from './service-harness.ts';
import { openStream } from './stream-client.ts';

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('The stream did not finish disconnecting.');
    await delay(5);
  }
}

test('stopping a server releases its event, ledger and progress subscriptions', async (t) => {
  const observed = { events: 0, ledger: 0, progress: 0 };
  // These originals are deliberately invoked with the concrete instance through .call below.
  // oxlint-disable typescript/unbound-method
  const publish = EventLog.prototype.onPublish;
  const changed = Ledger.prototype.onChanged;
  const progress = ProgressBoard.prototype.onProgress;
  // oxlint-enable typescript/unbound-method
  t.mock.method(
    EventLog.prototype,
    'onPublish',
    function (this: EventLog, listener: Parameters<EventLog['onPublish']>[0]) {
      return publish.call(this, (event) => {
        observed.events += 1;
        listener(event);
      });
    },
  );
  t.mock.method(Ledger.prototype, 'onChanged', function (this: Ledger, listener: () => void) {
    return changed.call(this, () => {
      observed.ledger += 1;
      listener();
    });
  });
  t.mock.method(
    ProgressBoard.prototype,
    'onProgress',
    function (this: ProgressBoard, listener: Parameters<ProgressBoard['onProgress']>[0]) {
      return progress.call(this, (frame) => {
        observed.progress += 1;
        listener(frame);
      });
    },
  );
  const harness = await startTestService();
  t.after(() => harness.stop());
  const stream = await openStream(harness.baseUrl, harness.config.token);
  stream.send({ type: 'subscribe', epoch: harness.config.epoch, seq: 0, status: true });
  await stream.next('status');
  stream.close();
  await harness.service.stop();
  observed.events = observed.ledger = observed.progress = 0;
  // The service handle remains reachable to its embedding host. Its stopped HTTP server must
  // release observers even when that host retains the ledger and event log for diagnostics.
  harness.service.events.publish({
    taskId: 'closed-task',
    runId: null,
    executionId: 'closed-execution',
    type: 'capability.resolved',
    data: { requestId: 'closed-request', ok: false, error: 'probe' },
  });
  await harness.service.ledger.change(() => {});
  harness.service.computer.coordinator.progress.accept(
    {
      taskId: 'closed-task',
      runId: 'closed-run',
      actionId: 'closed-action',
      operationId: 'closed-operation',
      hostGeneration: 1,
      seq: 1,
      phase: 'cleared',
      validUntil: new Date(Date.now() + 1000).toISOString(),
      geometry: { kind: 'unavailable' },
    },
    1,
  );
  assert.deepEqual(observed, { events: 0, ledger: 0, progress: 0 });
});

test('capability round trips and reconnects release abort listeners and expiry timers', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const registry = harness.service.capabilities;
  const unregister = t.mock.method(registry, 'unregister');
  const scheduled = t.mock.method(globalThis, 'setTimeout');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const controllers: AbortController[] = [];
  t.after(() => controllers.forEach((controller) => controller.abort()));
  const clients = new Set<string>();
  for (let cycle = 0; cycle < 8; cycle += 1) {
    const stream = await openStream(harness.baseUrl, harness.config.token);
    stream.send({ type: 'capability.register', capabilities: ['clipboard.read'] });
    const registered = await stream.next('capability.registered');
    assert.equal(typeof registered.clientId, 'string');
    clients.add(String(registered.clientId));
    const controller = new AbortController();
    controllers.push(controller);
    const result = registry.request(
      {
        capability: 'clipboard.read',
        input: {},
        taskId: 'test-task',
        runId: `run-${cycle}`,
        executionId: `execution-${cycle}`,
      },
      controller.signal,
    );
    const request = parse(
      CapabilityRequestSchema,
      (await stream.next('capability.request')).request,
    );
    stream.send({
      type: 'capability.result',
      result: { requestId: request.id, revision: request.revision, ok: true, value: 'fixture' },
    });
    assert.equal(await result, 'fixture');
    assert.equal((await stream.next('capability.ack')).ok, true);
    assert.deepEqual(registry.pending(), []);
    stream.close();
    await until(() => unregister.mock.calls.length === cycle + 1);
    await assert.rejects(
      registry.request({
        capability: 'clipboard.read',
        input: {},
        taskId: 'test-task',
        runId: 'disconnected-run',
        executionId: 'disconnected-execution',
      }),
      { name: 'DesktopUnavailable' },
    );
  }
  assert.equal(clients.size, 8, 'every reconnect acquired a fresh registration');
  const expiry = scheduled.mock.calls.filter((call) => call.arguments[1] === 600000);
  assert.equal(expiry.length, 8);
  const releasedTimers = new Set(cleared.mock.calls.map((call) => call.arguments[0]));
  const retained = {
    abortListeners: controllers.reduce(
      (count, controller) => count + getEventListeners(controller.signal, 'abort').length,
      0,
    ),
    expiryTimers: expiry.filter((call) => !releasedTimers.has(call.result)).length,
  };
  assert.deepEqual(retained, { abortListeners: 0, expiryTimers: 0 });
});

test('cancelled capability requests release the same listener and timeout resources', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const scheduled = t.mock.method(globalThis, 'setTimeout');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await openStream(harness.baseUrl, harness.config.token);
  t.after(() => stream.close());
  stream.send({ type: 'capability.register', capabilities: ['clipboard.read'] });
  await stream.next('capability.registered');
  const registry = harness.service.capabilities;
  const result = registry.request(
    {
      capability: 'clipboard.read',
      input: {},
      taskId: 'cancel-task',
      runId: 'cancel-run',
      executionId: 'cancel-execution',
    },
    controller.signal,
  );
  const rejected = assert.rejects(result, /Cancelled fixture/);
  await stream.next('capability.request');
  await registry.cancelRun('cancel-task', 'cancel-run', 'Cancelled fixture');
  await rejected;
  assert.deepEqual(registry.pending(), []);
  const expiry = scheduled.mock.calls.find((call) => call.arguments[1] === 600000);
  assert.ok(expiry);
  assert.deepEqual(
    {
      abortListeners: getEventListeners(controller.signal, 'abort').length,
      timerCleared: cleared.mock.calls.some((call) => call.arguments[0] === expiry.result),
    },
    { abortListeners: 0, timerCleared: true },
  );
});

test('abort releases its listener and timer while run cancellation withdraws the persisted request', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const scheduled = t.mock.method(globalThis, 'setTimeout');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const controller = new AbortController();
  const stream = await openStream(harness.baseUrl, harness.config.token);
  t.after(() => stream.close());
  stream.send({ type: 'capability.register', capabilities: ['clipboard.read'] });
  await stream.next('capability.registered');
  const registry = harness.service.capabilities;
  const result = registry.request(
    {
      capability: 'clipboard.read',
      input: {},
      taskId: 'abort-task',
      runId: 'abort-run',
      executionId: 'abort-execution',
    },
    controller.signal,
  );
  const rejected = assert.rejects(result, /Task stopped/);
  await stream.next('capability.request');
  controller.abort();
  await rejected;
  const expiry = scheduled.mock.calls.find((call) => call.arguments[1] === 600000);
  assert.ok(expiry);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.ok(cleared.mock.calls.some((call) => call.arguments[0] === expiry.result));
  await registry.cancelRun('abort-task', 'abort-run', 'Task stopped.');
  assert.deepEqual(registry.pending(), []);
});

test('expiry releases the abort listener after the timed out request settles', async (t) => {
  const harness = await startTestService();
  t.after(() => {
    t.mock.timers.reset();
    return harness.stop();
  });
  const stream = await openStream(harness.baseUrl, harness.config.token);
  t.after(() => stream.close());
  stream.send({ type: 'capability.register', capabilities: ['clipboard.read'] });
  await stream.next('capability.registered');
  const controller = new AbortController();
  t.after(() => controller.abort());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const registry = harness.service.capabilities;
  const result = registry.request(
    {
      capability: 'clipboard.read',
      input: {},
      taskId: 'expired-task',
      runId: 'expired-run',
      executionId: 'expired-execution',
    },
    controller.signal,
  );
  const rejected = assert.rejects(result, /request expired/);
  await stream.next('capability.request');
  t.mock.timers.tick(600000);
  await rejected;
  t.mock.timers.reset();
  assert.deepEqual(registry.pending(), []);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('service stop settles pending capabilities and releases their timers and signal listeners', async (t) => {
  const harness = await startTestService();
  t.after(() => harness.stop());
  const scheduled = t.mock.method(globalThis, 'setTimeout');
  const cleared = t.mock.method(globalThis, 'clearTimeout');
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await openStream(harness.baseUrl, harness.config.token);
  t.after(() => stream.close());
  stream.send({ type: 'capability.register', capabilities: ['clipboard.read'] });
  await stream.next('capability.registered');
  const registry = harness.service.capabilities;
  const draft = {
    capability: 'clipboard.read' as const,
    input: {},
    taskId: 'stopped-task',
    runId: 'stopped-run',
    executionId: 'stopped-execution',
  };
  const result = registry.request(draft, controller.signal);
  const rejected = assert.rejects(result, /service stopped/);
  await stream.next('capability.request');
  await harness.service.stop();
  await rejected;
  const expiry = scheduled.mock.calls.find((call) => call.arguments[1] === 600000);
  assert.ok(expiry);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.ok(cleared.mock.calls.some((call) => call.arguments[0] === expiry.result));
  await assert.rejects(registry.request(draft), { name: 'DesktopUnavailable' });
  // Requests remain persisted for recovery, preserving the service's restart contract.
  assert.equal(registry.pending().length, 1);
});
