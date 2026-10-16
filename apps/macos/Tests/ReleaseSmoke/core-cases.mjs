import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ANSWER, FILE_CONTENT, MODEL_ID, providerRequest } from './model-fixture.mjs';
import { openEvents, until } from './service-client.mjs';

export const CORE_CASES = [
  'unauthenticated requests are rejected',
  'settings validation and Chinese preference',
  'provider credential write/read and model verification',
  'streamed task and duplicate submission',
  'multi-turn context and task rename',
  'file write/read tool round trip',
  'cancel a live stream',
  'upstream failure and a successful retry',
  'settings, provider, transcript survive app restart',
  'saved credential runs another turn after restart',
  'task and provider removal',
];

function submission(connectionId, text, taskId, tools = []) {
  return {
    operationId: randomUUID(),
    ...(taskId ? { taskId } : {}),
    model: { connectionId, modelId: MODEL_ID },
    tools,
    memory: false,
    thinkingLevel: 'off',
    input: {
      text,
      source: 'manual',
      capturedAt: new Date().toISOString(),
      selection: '',
      clipboard: '',
      files: [],
      arguments: {},
      chips: [],
      folders: [],
    },
  };
}

async function finished(api, accepted, expected = 'completed') {
  const task = await until(
    `run ${accepted.runId} reaches ${expected}`,
    async () => {
      const { task } = await api.request(`/v1/tasks/${accepted.taskId}`);
      const run = task.runs.find((item) => item.id === accepted.runId);
      assert.ok(run, 'Accepted run must exist');
      return ['completed', 'failed', 'stopped', 'cancelled', 'interrupted', 'unknown'].includes(
        run.status,
      )
        ? task
        : null;
    },
    45000,
  );
  assert.equal(task.runs.find((run) => run.id === accepted.runId).status, expected);
  return (await api.request(`/v1/tasks/${accepted.taskId}/snapshot`)).snapshot;
}

function assertAnswer(snapshot) {
  const block = snapshot.blocks.filter((item) => item.kind === 'assistant').at(-1);
  assert.ok(block, 'An assistant transcript block must exist');
  assert.equal(block.text, ANSWER);
  assert.equal(block.streaming, false);
  assert.equal(block.stopReason, 'stop');
}

/** API-level assertions against the service launched by the actual app, not UI assertions. */
export async function beforeRestart(api, fixture, check, state) {
  await check(CORE_CASES[0], async () => {
    await api.request('/v1/settings', 'GET', undefined, 401, false);
  });
  await check(CORE_CASES[1], async () => {
    await api.request('/v1/settings', 'PATCH', { language: 'invalid' }, 400);
    const saved = await api.request('/v1/settings', 'PATCH', {
      language: 'zh-CN',
      commandTyping: false,
    });
    assert.equal(saved.settings.language, 'zh-CN');
    assert.equal(saved.settings.commandTyping, false);
    assert.equal((await api.request('/v1/settings')).revision, saved.revision);
  });
  await check(CORE_CASES[2], async () => {
    const created = await api.request('/v1/providers', 'POST', providerRequest(fixture.baseUrl));
    state.connectionId = created.connection.connectionId;
    assert.equal(created.readable, true);
    assert.equal(created.connection.connected, true);
    assert.equal(created.connection.hasCredential, true);
    const health = await api.request(`/v1/providers/${state.connectionId}/status`);
    assert.equal(health.keyring.available, true);
    await api.request(`/v1/providers/${state.connectionId}/verify`, 'POST', { modelId: MODEL_ID });
    assert.ok(fixture.calls.length > 0, 'Model verification must reach the loopback fixture');
  });

  let events;
  try {
    await check(CORE_CASES[3], async () => {
      events = await openEvents(api.endpoint);
      await events.waitFor((frame) => frame.type === 'status');
      const body = submission(state.connectionId, 'Smoke first turn: 中文输入');
      const accepted = await api.request('/v1/tasks', 'POST', body);
      state.taskId = accepted.taskId;
      const duplicate = await api.request('/v1/tasks', 'POST', body);
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.runId, accepted.runId);
      assert.equal(duplicate.taskId, accepted.taskId);
      assertAnswer(await finished(api, accepted));
      await events.waitFor(
        (frame) =>
          frame.type === 'event' &&
          frame.event.runId === accepted.runId &&
          frame.event.type === 'transcript.patch',
      );
      assert.ok(fixture.calls.some((call) => call.streaming));
    });
    await check(CORE_CASES[4], async () => {
      const accepted = await api.request(
        '/v1/tasks',
        'POST',
        submission(state.connectionId, 'Smoke follow-up', state.taskId),
      );
      assertAnswer(await finished(api, accepted));
      const messages = fixture.calls.at(-1).messages;
      assert.ok(JSON.stringify(messages).includes('Smoke first turn: 中文输入'));
      assert.ok(
        messages.some(
          (message) =>
            message.role === 'assistant' && JSON.stringify(message.content).includes(ANSWER),
        ),
      );
      await api.request(`/v1/tasks/${state.taskId}`, 'PATCH', { title: 'Intel 持久化测试' });
    });
    await check(CORE_CASES[5], async () => {
      fixture.setMode('file');
      const accepted = await api.request(
        '/v1/tasks',
        'POST',
        submission(
          state.connectionId,
          'Write release-smoke.txt in this task folder, then read it back.',
          undefined,
          ['read', 'write'],
        ),
      );
      state.otherTasks.push(accepted.taskId);
      const snapshot = await finished(api, accepted);
      assertAnswer(snapshot);
      const tools = snapshot.blocks.filter((block) => block.kind === 'tool');
      assert.deepEqual(
        tools.map((tool) => [tool.name, tool.status]),
        [
          ['write', 'completed'],
          ['read', 'completed'],
        ],
      );
      assert.ok(tools[1].output.includes(FILE_CONTENT));
    });
    await check(CORE_CASES[6], async () => {
      fixture.setMode('hold');
      const accepted = await api.request(
        '/v1/tasks',
        'POST',
        submission(state.connectionId, 'Smoke cancellation'),
      );
      state.otherTasks.push(accepted.taskId);
      await until('upstream stream is held open', () => fixture.pendingCount > 0);
      await events.waitFor(
        (frame) =>
          frame.type === 'event' &&
          frame.event.runId === accepted.runId &&
          frame.event.type === 'transcript.patch',
      );
      await api.request(`/v1/tasks/${accepted.taskId}/runs/${accepted.runId}/cancel`, 'POST');
      await finished(api, accepted, 'stopped');
      await until('cancel closes upstream HTTP stream', () => fixture.pendingCount === 0);
    });
    await check(CORE_CASES[7], async () => {
      fixture.setMode('reject');
      const failed = await api.request(
        '/v1/tasks',
        'POST',
        submission(state.connectionId, 'Smoke error'),
      );
      state.otherTasks.push(failed.taskId);
      await finished(api, failed, 'failed');
      fixture.setMode('complete');
      const retried = await api.request(
        '/v1/tasks',
        'POST',
        submission(state.connectionId, 'Smoke retry', failed.taskId),
      );
      assert.notEqual(retried.runId, failed.runId);
      assertAnswer(await finished(api, retried));
    });
    state.streamEvents = events.frames.filter((frame) => frame.type === 'event').length;
  } finally {
    events?.close();
    fixture.setMode('complete');
  }
}

export async function afterRestart(api, fixture, check, state) {
  await check(CORE_CASES[8], async () => {
    const { settings } = await api.request('/v1/settings');
    assert.equal(settings.language, 'zh-CN');
    assert.equal(settings.commandTyping, false);
    const { connection } = await api.request(`/v1/providers/${state.connectionId}`);
    assert.equal(connection.connected, true);
    assert.equal(connection.hasCredential, true);
    assert.equal(connection.baseUrl, fixture.baseUrl);
    const { snapshot } = await api.request(`/v1/tasks/${state.taskId}/snapshot`);
    assert.equal(snapshot.task.title, 'Intel 持久化测试');
    assert.equal(snapshot.task.runs.length, 2);
    assertAnswer(snapshot);
  });
  await check(CORE_CASES[9], async () => {
    const accepted = await api.request(
      '/v1/tasks',
      'POST',
      submission(state.connectionId, 'Smoke after restart', state.taskId),
    );
    assertAnswer(await finished(api, accepted));
  });
  await check(CORE_CASES[10], async () => {
    for (const id of [state.taskId, ...state.otherTasks]) {
      assert.equal((await api.request(`/v1/tasks/${id}`, 'DELETE')).deleted, true);
      await api.request(`/v1/tasks/${id}`, 'GET', undefined, 404);
    }
    await removeProvider(api, state);
  });
}

export async function removeProvider(api, state) {
  if (!state.connectionId) return;
  const { connection } = await api.request(`/v1/providers/${state.connectionId}`);
  const removed = await api.request(
    `/v1/providers/${state.connectionId}?expectedRevision=${connection.revision}`,
    'DELETE',
  );
  assert.equal(removed.removed, true);
  assert.equal(removed.warning, undefined, 'Credential cleanup must succeed');
  state.connectionId = undefined;
}
