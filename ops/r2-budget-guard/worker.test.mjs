import assert from 'node:assert/strict';
import test from 'node:test';
import { billingPeriod, countOperations, PauseFailedError, runGuard } from './worker.mjs';

const now = new Date('2026-10-14T12:00:00Z');
const env = {
  CF_ACCOUNT_ID: 'test-account',
  CF_API_TOKEN: 'test-secret',
  TARGETS: [
    { bucket: 'atd-assets', domain: 'assets.atd.test' },
    { bucket: 'atd-releases', domain: 'downloads.atd.test' },
  ],
  CLASS_A_LIMIT: 900000,
  CLASS_B_LIMIT: 9000000,
  STORAGE_BYTES_LIMIT: 9000000000,
  MODE: 'enforce',
};
const subscription = {
  id: 'r2-subscription',
  rate_plan: { id: 'r2_paid' },
  state: 'Paid',
  current_period_start: '2026-10-14T00:00:00Z',
  current_period_end: '2026-11-14T00:00:00Z',
};
const row = (actionType, requests) => ({ dimensions: { actionType }, sum: { requests } });
const later = (minutes) => ({ now: new Date(+now + minutes * 60000) });

function fixture(overrides = {}) {
  const state = {
    domains: {
      'atd-assets': { custom: true, managed: false },
      'atd-releases': { custom: true, managed: false },
    },
    rows: [row('GetObject', 100), row('PutObject', 44)],
    recentRows: [],
    subscriptions: [subscription],
    buckets: [{ name: 'atd-assets' }, { name: 'atd-releases' }],
    pages: [{ result: [{ size: 1000000 }] }],
    calls: [],
    logs: [],
    failures: new Set(),
    monitorState: {},
    waits: [],
    now,
    ...overrides,
  };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? 'GET';
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'manual');
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.calls.push({ path: url.pathname, method, body });
    const intercepted = await state.intercept?.(url, method);
    if (intercepted !== undefined) return intercepted;
    if (url.pathname.endsWith('/graphql')) {
      return Response.json({
        data: {
          viewer: {
            accounts: [{ r2OperationsAdaptiveGroups: state.rows, recent: state.recentRows }],
          },
        },
      });
    }
    const domainMatch = url.pathname.match(
      /\/r2\/buckets\/([^/]+)\/domains\/(custom\/[^/]+|managed)$/,
    );
    if (domainMatch) {
      const bucket = decodeURIComponent(domainMatch[1]);
      const kind = domainMatch[2] === 'managed' ? 'managed' : 'custom';
      if (method === 'PUT') {
        assert.deepEqual(body, { enabled: false });
        if (state.failures.has(`${bucket}:${kind}`))
          return Response.json({ success: false }, { status: 503 });
        state.domains[bucket][kind] = false;
      }
      return Response.json({ success: true, result: { enabled: state.domains[bucket][kind] } });
    }
    if (url.pathname.endsWith('/subscriptions')) {
      return Response.json({ success: true, result: state.subscriptions });
    }
    if (url.pathname.includes('/subscriptions/')) {
      return Response.json({
        success: true,
        result: state.detailSubscription ?? subscription,
      });
    }
    if (url.pathname.endsWith('/buckets')) {
      return Response.json({ success: true, result: { buckets: state.buckets } });
    }
    if (url.pathname.endsWith('/objects')) {
      const index = Number(url.searchParams.get('cursor') ?? '0');
      return Response.json({
        success: true,
        ...state.pages[index],
        result: state.pages[index].result.map((entry) => ({ storage_class: 'Standard', ...entry })),
      });
    }
    throw new Error(`Unexpected mock request: ${url.pathname}`);
  };
  return {
    state,
    run: (settings = {}, checkStorage = true, options = {}) => {
      state.now = options.now ?? now;
      return runGuard(
        { ...env, ...settings },
        {
          fetcher,
          now,
          checkStorage,
          log: (entry) => state.logs.push(entry),
          wait: async (ms) => {
            state.waits.push(ms);
          },
          monitorState: state.monitorState,
          ...options,
        },
      );
    },
  };
}

test('counts operations and validates billing periods', () => {
  assert.deepEqual(
    countOperations([row('DeleteObject', 99), row('GetObject', 10), row('UnknownOp', 2)]),
    { classA: 2, classB: 10 },
  );
  assert.deepEqual(billingPeriod([subscription], now), {
    start: '2026-10-14T00:00:00.000Z',
    end: '2026-11-14T00:00:00.000Z',
  });
});

test('disables all four public endpoints across both buckets on threshold breach', async () => {
  const f = fixture({ rows: [row('GetObject', 9000000)] });
  const result = await f.run();
  assert.equal(result.event, 'paused');
  assert.deepEqual(result.reasons, ['class_b_limit']);
  assert.deepEqual(f.state.domains, {
    'atd-assets': { custom: false, managed: false },
    'atd-releases': { custom: false, managed: false },
  });

  const reopened = fixture();
  reopened.state.domains['atd-assets'].managed = true;
  const closed = await reopened.run();
  assert.equal(closed.event, 'paused');
  assert.deepEqual(closed.reasons, ['public_entry_reopened']);
  assert.deepEqual(reopened.state.domains, {
    'atd-assets': { custom: false, managed: false },
    'atd-releases': { custom: false, managed: false },
  });
});

test('verifies ambiguous subscription list via cached subscription detail before failing closed', async () => {
  const f = fixture();
  assert.equal((await f.run()).event, 'within_limits');
  f.state.subscriptions = [];
  f.state.detailSubscription = subscription;
  const result = await f.run({}, false, later(15));
  assert.equal(result.event, 'within_limits');
  assert.ok(f.state.calls.some((call) => call.path.endsWith(`/subscriptions/${subscription.id}`)));
  f.state.detailSubscription = { ...subscription, state: 'Cancelled' };
  const inactive = await f.run({}, false, later(30));
  assert.equal(inactive.event, 'paused');
  assert.deepEqual(inactive.reasons, ['monitor_error']);
});

test('reconfirms an existing pause without resetting recovery count when domain GET fails', async () => {
  const f = fixture({
    domains: {
      'atd-assets': { custom: false, managed: false },
      'atd-releases': { custom: false, managed: false },
    },
  });
  assert.equal((await f.run()).event, 'paused_check_passed');
  assert.equal(f.state.monitorState.pausedCheck.successes, 1);

  f.state.intercept = (url, method) => {
    if (method === 'GET' && url.pathname.endsWith('/domains/custom/assets.atd.test')) {
      f.state.intercept = undefined;
      return Response.json({ success: false }, { status: 500 });
    }
  };
  let failedOnce = 0;
  f.state.intercept = (url, method) => {
    if (
      method === 'GET' &&
      url.pathname.endsWith('/domains/custom/assets.atd.test') &&
      failedOnce < 3
    ) {
      failedOnce++;
      return Response.json({ success: false }, { status: 500 });
    }
  };
  const reconfirmed = await f.run({}, false, later(1));
  assert.equal(reconfirmed.event, 'pause_reconfirmed');
  assert.equal(f.state.monitorState.pausedCheck.successes, 1);

  f.state.intercept = undefined;
  assert.equal((await f.run({}, false, later(5))).event, 'paused_check_passed');
  assert.equal(f.state.monitorState.pausedCheck.successes, 2);
});

test('treats domain GET failure after manual reopen as a genuine pause rather than reconfirm', async () => {
  const f = fixture({
    domains: {
      'atd-assets': { custom: false, managed: false },
      'atd-releases': { custom: false, managed: false },
    },
  });
  assert.equal((await f.run()).event, 'paused_check_passed');
  // Operator reopened one bucket while the other fails GET.
  f.state.domains['atd-assets'].custom = true;
  let blockReads = true;
  f.state.intercept = (url, method) => {
    if (
      blockReads &&
      method === 'GET' &&
      url.pathname.endsWith('/domains/custom/downloads.atd.test')
    ) {
      return Response.json({ success: false }, { status: 503 });
    }
    if (method === 'PUT') blockReads = false;
  };
  const result = await f.run({}, false, later(1));
  assert.equal(result.event, 'paused');
  assert.equal(f.state.monitorState.pausedCheck.successes, 0);
});

test('persists reconfirm pendingPause across PauseFailedError and completes on recovery', async () => {
  const f = fixture({
    domains: {
      'atd-assets': { custom: false, managed: false },
      'atd-releases': { custom: false, managed: false },
    },
  });
  assert.equal((await f.run()).event, 'paused_check_passed');
  f.state.intercept = (url) => {
    if (url.pathname.includes('/domains/'))
      return Response.json({ success: false }, { status: 503 });
  };
  await assert.rejects(f.run({}, false, later(1)), PauseFailedError);
  assert.equal(f.state.monitorState.pendingPause.reconfirm, true);

  f.state.intercept = undefined;
  const done = await f.run({}, false, later(2));
  assert.equal(done.event, 'pause_reconfirmed');
  assert.equal(f.state.monitorState.pendingPause, undefined);
  assert.equal(f.state.monitorState.pausedCheck.successes, 1);
});

test('confirms a single 403 once within retry budget and fails closed on repeated 403', async () => {
  const f = fixture();
  let denied = false;
  f.state.intercept = (url, method) => {
    if (method === 'GET' && url.pathname.endsWith('/domains/managed') && !denied) {
      denied = true;
      return Response.json(
        { success: false, errors: [{ code: 10000, message: 'sensitive text' }] },
        { status: 403, headers: { 'cf-mitigated': 'challenge' } },
      );
    }
  };
  assert.equal((await f.run()).event, 'within_limits');
  assert.equal(JSON.stringify(f.state.logs).includes('sensitive text'), false);

  f.state.intercept = (url, method) => {
    if (method === 'GET' && url.pathname.endsWith('/subscriptions')) {
      return Response.json({ success: false, errors: [{ code: 9109 }] }, { status: 403 });
    }
  };
  const failed = await f.run({}, false, later(15));
  assert.equal(failed.event, 'paused');
  assert.equal(failed.usage.request.kind, 'authorization_error');
  assert.equal(failed.usage.request.retryable, false);
  assert.deepEqual(failed.usage.request.response.errorCodes, [9109]);
});
