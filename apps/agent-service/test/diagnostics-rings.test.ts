import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BoundedLogRing,
  SERVICE_LOG_LINE_MAX_BYTES,
  SERVICE_LOG_RING_MAX_BYTES,
} from '../dist/diagnostics/log-ring.js';
import {
  recordRunPrepDegradation,
  resetRunPrepDecisionRing,
  RUN_PREP_RING_CAPACITY,
  RunPrepDecisionRing,
} from '../dist/diagnostics/run-prep-ring.js';
import { createLogger, getServiceLogRing, resetServiceLogRing } from '../dist/logging.js';
import { timePreparation, withRunPreparation } from '../dist/run-preparation-timing.js';

test('BoundedLogRing enforces 500-entry limit and tracks droppedEntries', () => {
  const ring = new BoundedLogRing();
  for (let i = 0; i < 505; i += 1) {
    ring.push(JSON.stringify({ ts: '2026-11-18T00:00:00.000Z', level: 'info', i }), {
      trustedJson: true,
    });
  }
  const snap = ring.snapshot();
  assert.equal(snap.maxBytes, SERVICE_LOG_RING_MAX_BYTES);
  assert.equal(snap.totalCapturedEntries, 505);
  assert.equal(snap.droppedEntries, 5);
  assert.equal(snap.lines.length, 500);
  assert.equal(JSON.parse(snap.lines[0]!).i, 5);
  assert.equal(JSON.parse(snap.lines[499]!).i, 504);
  assert.ok(snap.byteLength <= SERVICE_LOG_RING_MAX_BYTES);
});

test('BoundedLogRing enforces 512 KiB byte limit with large lines', () => {
  const ring = new BoundedLogRing();
  const payload = 'x'.repeat(3500);
  for (let i = 0; i < 200; i += 1) {
    ring.push(JSON.stringify({ ts: '2026-11-18T00:00:00.000Z', level: 'info', i, payload }), {
      trustedJson: true,
    });
  }
  const snap = ring.snapshot();
  assert.ok(snap.lines.length < 200);
  assert.ok(snap.droppedEntries > 0);
  assert.ok(snap.byteLength <= SERVICE_LOG_RING_MAX_BYTES);
  const measured = snap.lines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8'), 0);
  assert.equal(snap.byteLength, measured);
});

test('BoundedLogRing truncates overlong multibyte UTF-8 lines into valid flat JSON without U+FFFD', () => {
  const ring = new BoundedLogRing();
  const longText = '你好世界🚀'.repeat(4000);
  const hugeJson = JSON.stringify({
    ts: '2026-11-18T00:00:00.000Z',
    level: 'warn',
    msg: longText,
  });
  const stored = ring.push(hugeJson, {
    ts: '2026-11-18T00:00:00.000Z',
    level: 'warn',
    trustedJson: true,
  });

  assert.ok(Buffer.byteLength(stored, 'utf8') <= SERVICE_LOG_LINE_MAX_BYTES);
  assert.ok(!stored.includes('\uFFFD'), 'scalar-safe truncation must not split UTF-8 sequences');
  const parsed = JSON.parse(stored) as {
    ts: string;
    level: string;
    truncated: boolean;
    originalBytes: number;
    preview: string;
  };
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.level, 'warn');
  assert.ok(parsed.originalBytes > SERVICE_LOG_LINE_MAX_BYTES);
  assert.ok(parsed.preview.endsWith('…[truncated:4KiB]'));
});

test('BoundedLogRing handles heavy JSON escaping and wraps non-JSON/broken lines into valid JSON', () => {
  const ring = new BoundedLogRing();
  const escapedPayload = '"\\\n\u0000'.repeat(2000);
  const storedEscaped = ring.push(escapedPayload, {
    ts: '2026-11-18T00:00:00.000Z',
    level: 'error',
  });
  assert.ok(Buffer.byteLength(storedEscaped, 'utf8') <= SERVICE_LOG_LINE_MAX_BYTES);
  assert.equal(JSON.parse(storedEscaped).truncated, true);

  const plainLine = ring.push('plain stderr line without json', {
    ts: '2026-11-18T00:00:00.000Z',
    level: 'error',
  });
  assert.deepEqual(JSON.parse(plainLine), {
    ts: '2026-11-18T00:00:00.000Z',
    level: 'error',
    truncated: false,
    originalBytes: Buffer.byteLength('plain stderr line without json', 'utf8'),
    preview: 'plain stderr line without json',
  });

  const brokenJson = ring.push('{"unclosed": true', {
    ts: '2026-11-18T00:00:00.000Z',
    level: 'warn',
  });
  assert.equal(JSON.parse(brokenJson).preview, '{"unclosed": true');
});

test('createLogger wires into BoundedLogRing and respects log level', () => {
  const customRing = new BoundedLogRing();
  const log = createLogger('info', customRing);
  log.debug('ignored debug');
  log.info('service started', { epoch: 2 });
  log.warn('minor warning');
  const snap = customRing.snapshot();
  assert.equal(snap.lines.length, 2);
  assert.equal(JSON.parse(snap.lines[0]!).msg, 'service started');
  assert.equal(JSON.parse(snap.lines[1]!).level, 'warn');

  const shared = resetServiceLogRing();
  const defaultLog = createLogger('info');
  defaultLog.info('shared ring capture');
  assert.equal(getServiceLogRing().snapshot().lines.length, shared.snapshot().lines.length);
  assert.equal(shared.snapshot().lines.length, 1);
  resetServiceLogRing();
});

test('RunPrepDecisionRing bounds entries and bytes and captures degradation + timing hooks', async () => {
  const ring = new RunPrepDecisionRing(RUN_PREP_RING_CAPACITY, 32_768);
  for (let i = 0; i < 40; i += 1) {
    ring.record({
      runId: `run-${i}-abcdefghijkl`,
      phase: 'freeze_plugins',
      durationMs: 12,
      outcome: 'degraded',
      reasonCode: 'plugins_degraded',
    });
  }
  const snap = ring.snapshot();
  assert.equal(snap.capacity, 32);
  assert.equal(snap.droppedCount, 8);
  assert.equal(snap.entries.length, 32);
  assert.equal(snap.entries[0]!.seq, 9);
  assert.equal(snap.entries[0]!.runIdPrefix, 'run-8-ab');
  assert.ok(Buffer.byteLength(JSON.stringify(snap), 'utf8') <= 32_768);

  const byteBounded = new RunPrepDecisionRing(32, 600);
  for (let i = 0; i < 10; i += 1) {
    byteBounded.record({
      runId: `run-${i}`,
      phase: 'session_settled',
      durationMs: 1500,
      outcome: 'completed',
      reasonCode: 'session_slot_settle_slow',
    });
  }
  assert.ok(byteBounded.snapshot().entries.length < 10);
  assert.ok(byteBounded.snapshot().droppedCount > 0);

  const globalRing = resetRunPrepDecisionRing();
  recordRunPrepDegradation('abcdef123456', 'freeze_memory', 'memory_degraded');
  await withRunPreparation(
    'task-1',
    'abcdef123456',
    () => undefined,
    async () => {
      await timePreparation('fast_step', async () => 'ok');
      await assert.rejects(
        timePreparation('failing_step', async () => {
          throw new Error('boom');
        }),
      );
    },
  );
  const entries = globalRing.snapshot().entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.reasonCode, 'memory_degraded');
  assert.equal(entries[1]!.phase, 'failing_step');
  assert.equal(entries[1]!.outcome, 'error');
  resetRunPrepDecisionRing();
});
