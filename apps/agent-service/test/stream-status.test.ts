import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { parse, StatusFrameSchema } from '@ai/agent-contracts';
import { inputRequest, task } from './fixtures.ts';
import { startTestService } from './service-harness.ts';
import { openStream, type Frame } from './stream-client.ts';

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

function statusFrames(frames: Frame[]) {
  return frames.filter((frame) => frame.type === 'status').map((f) => parse(StatusFrameSchema, f));
}

test('status frames: a baseline on subscribe, then only changed counts', async () => {
  const watcher = await openStream(harness.baseUrl, harness.config.token);
  const other = await openStream(harness.baseUrl, harness.config.token);
  const subscribe = { type: 'subscribe', epoch: harness.config.epoch, seq: 0, taskIds: [] };
  watcher.send({ ...subscribe, status: true });
  other.send(subscribe);
  assert.deepEqual(parse(StatusFrameSchema, await watcher.next('status')), {
    type: 'status',
    running: 0,
    attention: 0,
  });

  const running = task('running');
  await harness.service.ledger.change((data) => {
    data.tasks.unshift(running);
  });
  assert.deepEqual(await watcher.next('status'), { type: 'status', running: 1, attention: 0 });

  // A ledger change that moves no count sends nothing; the next counted change does.
  await harness.service.ledger.change((data) => {
    const entry = data.tasks.find((item) => item.id === running.id);
    if (entry) entry.title = 'Renamed fixture';
  });
  await harness.service.ledger.change((data) => {
    data.pendingConfirms.push(inputRequest(running));
  });
  assert.deepEqual(await watcher.next('status'), { type: 'status', running: 0, attention: 1 });
  await watcher.drain();
  assert.equal(statusFrames(watcher.frames).length, 3);

  // Each subscribe asking for status gets the current counts again.
  watcher.send({ ...subscribe, status: true });
  assert.deepEqual(await watcher.next('status'), { type: 'status', running: 0, attention: 1 });

  await other.drain();
  assert.deepEqual(statusFrames(other.frames), [], 'no status frames without status: true');
  watcher.close();
  other.close();
  await harness.service.ledger.change((data) => {
    data.tasks = data.tasks.filter((item) => item.id !== running.id);
    data.pendingConfirms = data.pendingConfirms.filter((item) => item.taskId !== running.id);
  });
});
