import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEmail, processNotifications } from './notifications.mjs';

const start = Date.parse('2026-10-14T14:00:00Z');
const report = (event, extra = {}) => ({
  event,
  checkedAt: new Date(start).toISOString(),
  ...extra,
});
const healthy = report('within_limits');
const paused = report('paused', { reasons: ['class_b_limit'], usage: { classB: 9000000 } });

function fixture() {
  const data = new Map();
  const state = { attempts: [], sent: [], logs: [], failures: 0, writes: 0 };
  const storage = {
    async get(key) {
      return structuredClone(data.get(key));
    },
    async put(key, value) {
      state.writes++;
      data.set(key, structuredClone(value));
    },
  };
  const env = {
    CF_ACCOUNT_ID: 'test-account',
    TARGETS: [
      { bucket: 'atd-assets', domain: 'assets.atd.best' },
      { bucket: 'atd-releases', domain: 'downloads.atd.best' },
    ],
    MODE: 'enforce',
    NOTIFY_FROM: 'alerts@atd.best',
    NOTIFY_TO: 'owner@example.test',
    GUARD_EMAIL: {
      async send(message) {
        const id = message.headers['X-R2-Guard-Notification-ID'];
        const stored = data.get('notifications');
        assert.ok(Object.values(stored.outbox).some((n) => n.id === id && n.attempts > 0));
        state.attempts.push(message);
        if (state.failures-- > 0) throw new Error('Temporary email delivery error');
        state.sent.push(message);
        return { messageId: `test-${state.sent.length}` };
      },
    },
  };
  return {
    state,
    env,
    storage,
    saved: () => structuredClone(data.get('notifications')),
    run: (result, now = start) =>
      processNotifications(storage, env, result, { now, log: (entry) => state.logs.push(entry) }),
  };
}

test('includes all configured domains and buckets in setup and pause emails', async () => {
  const f = fixture();
  await f.run(healthy);
  assert.equal(f.state.sent.length, 1);
  assert.equal(f.state.sent[0].subject, '[atd.best] 邮件通知配置验证');
  assert.match(f.state.sent[0].text, /assets\.atd\.best、downloads\.atd\.best/);
  assert.match(f.state.sent[0].text, /atd-assets、atd-releases/);
  assert.match(f.state.sent[0].text, /atd-r2-budget-guard/);

  await f.run(paused, start + 60000);
  await f.run(report('remains_paused'), start + 120000);
  assert.equal(f.state.sent.length, 2);
  assert.equal(f.state.sent[1].subject, '[atd.best] R2 资源已暂停');
});

test('deduplicates pause reconfirmations and cancels stale readiness notices', async () => {
  const f = fixture();
  await f.run(paused);
  await f.run(report('recovery_ready'));
  const sentBefore = f.state.sent.length;
  await f.run(report('pause_reconfirmed'));
  assert.equal(f.state.sent.length, sentBefore);
  assert.equal(f.saved().phase, 'recovery_ready');

  f.state.failures = 1;
  await f.run(report('paused_check_failed'));
  assert.ok(f.saved().outbox.recovery_not_ready);
  await f.run(report('recovery_ready'), start + 15 * 60000);
  assert.equal(f.saved().outbox.recovery_not_ready, undefined);
});

test('observe mode never sends and buildEmail produces plain text only', async () => {
  const f = fixture();
  f.env.MODE = 'observe';
  await f.run(paused);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.sent.length, 0);
  const message = buildEmail(f.env, {
    id: 'msg-1',
    kind: 'monitor_degraded',
    attempts: 0,
    nextAttemptAt: start,
    report: report('monitor_degraded', { graceUntil: '2026-10-14T14:03:00Z' }),
  });
  assert.equal(message.html, undefined);
  assert.equal(message.from.email, 'alerts@atd.best');
});
