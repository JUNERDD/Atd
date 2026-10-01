import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskStatusCounts } from '../dist/task-status.js';
import { inputRequest, task } from './fixtures.ts';

test('attention wins over running and each root task counts once', () => {
  const pending = task('running');
  const counts = taskStatusCounts({
    tasks: [
      task('running'),
      task('queued'),
      task('awaiting_confirmation'),
      pending,
      task('completed'),
      task(undefined),
    ],
    pendingConfirms: [inputRequest(pending)],
  });
  assert.deepEqual(counts, { running: 2, attention: 2 });
});

test('stopping runs count as running; finished runs count as nothing', () => {
  assert.deepEqual(taskStatusCounts({ tasks: [task('stopping')], pendingConfirms: [] }), {
    running: 1,
    attention: 0,
  });
  assert.deepEqual(
    taskStatusCounts({ tasks: [task('failed'), task('awaiting_input')], pendingConfirms: [] }),
    { running: 0, attention: 1 },
  );
});

test('only root tasks count; a subagent request counts toward its root', () => {
  const root = task('running');
  const child = task('awaiting_input', { rootTaskId: root.id });
  assert.deepEqual(taskStatusCounts({ tasks: [root, child], pendingConfirms: [] }), {
    running: 1,
    attention: 0,
  });
  assert.deepEqual(
    taskStatusCounts({ tasks: [root, child], pendingConfirms: [inputRequest(child)] }),
    { running: 0, attention: 1 },
  );
});
