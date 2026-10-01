import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CredentialTransactions,
  LateWritebackProhibited,
  TxnAborted,
  TxnRevoked,
} from '../dist/mcp/transactions.js';
import { deferred } from './mcp-kit.ts';

/**
 * The lock around a credential identity's token operations: one at a time in call order, a
 * cancellable queue, and a revoke that refuses everything started before it.
 */

test('operations of one identity run one at a time in call order; others do not wait', async () => {
  const txns = new CredentialTransactions();
  const order: string[] = [];
  const gate = deferred();
  const first = txns.runTokenOp('a', async () => {
    order.push('first:start');
    await gate.promise;
    order.push('first:end');
    return 1;
  });
  const second = txns.runTokenOp('a', async () => (order.push('second'), 2));
  const other = txns.runTokenOp('b', async () => (order.push('other'), 3));
  assert.equal(await other, 3);
  assert.deepEqual(order, ['first:start', 'other']);
  assert.deepEqual([txns.isLocked('a'), txns.queuedCount('a')], [true, 1]);

  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first:start', 'other', 'first:end', 'second']);
  assert.deepEqual([txns.isLocked('a'), txns.queuedCount('a')], [false, 0]);
});

test('an operation that fails still releases the lock', async () => {
  const txns = new CredentialTransactions();
  const failing = txns.runTokenOp('a', async () => {
    throw new Error('boom');
  });
  const next = txns.runTokenOp('a', async () => 'next');
  await assert.rejects(failing, /boom/);
  assert.equal(await next, 'next');
  assert.equal(txns.isLocked('a'), false);
});

/** What `promise` settles with, or 'pending' if it has not settled after `ms`. */
const settlesWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<'pending'>((resolve) => setTimeout(resolve, ms, 'pending'))]);

test('a running operation sees its caller leave; one that was aborted before it began never runs', async () => {
  const txns = new CredentialTransactions();
  const early = txns.runTokenOp('a', async () => 'never', {
    kind: 'read',
    signal: AbortSignal.abort(),
  });
  await assert.rejects(early, TxnAborted);

  const leaving = new AbortController();
  const running = txns.runTokenOp(
    'a',
    ({ signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    { kind: 'exchange', signal: leaving.signal },
  );
  leaving.abort(new Error('the caller left'));
  await assert.rejects(running, /the caller left/);
  assert.equal(txns.isLocked('a'), false);
});

// Regression: the abort listener once searched the queue for an object the queue did not hold, so
// a queued operation whose caller left settled only when the lock freed.
test('a queued operation is rejected and dropped as soon as its caller leaves', async () => {
  const txns = new CredentialTransactions();
  const gate = deferred();
  const active = txns.runTokenOp('a', () => gate.promise);
  try {
    const cancel = new AbortController();
    const queued = txns.runTokenOp('a', async () => 'never', {
      kind: 'read',
      signal: cancel.signal,
    });
    const outcome = queued.then(
      () => 'ran',
      (error: unknown) => error,
    );
    assert.equal(txns.queuedCount('a'), 1);
    cancel.abort();
    assert.ok(
      (await settlesWithin(outcome, 200)) instanceof TxnAborted,
      'rejected while the lock is still held',
    );
    assert.equal(txns.queuedCount('a'), 0);
  } finally {
    gate.resolve();
    await active;
  }
});

test('a revoke refuses the queue, aborts the running operation and starts a new generation', async () => {
  const txns = new CredentialTransactions();
  const running = txns.runTokenOp(
    'a',
    ({ signal, generation }) =>
      new Promise<{ generation: number; reason: unknown }>((resolve) =>
        signal.addEventListener('abort', () => resolve({ generation, reason: signal.reason })),
      ),
  );
  const queued = txns.runTokenOp('a', async () => 'never');
  assert.equal(txns.generation('a'), 0);

  txns.revoke('a');
  await assert.rejects(queued, TxnRevoked);
  const seen = await running;
  assert.equal(seen.generation, 0);
  assert.ok(seen.reason instanceof TxnRevoked);
  assert.equal(txns.generation('a'), 1);
  const after = await txns.runTokenOp('a', async ({ generation }) => generation);
  assert.equal(after, 1, 'the next operation starts fresh, under the new generation');
});

test('a commit is refused once the credential changed after its operation began', async () => {
  const txns = new CredentialTransactions();
  const written: string[] = [];
  const generation = txns.generation('a');
  await txns.commitChecked('a', generation, async () => void written.push('kept'));
  txns.revoke('a');
  const late = txns.commitChecked('a', generation, async () => void written.push('late'));
  await assert.rejects(late, LateWritebackProhibited);
  assert.deepEqual(written, ['kept'], 'the late write never ran');
  await txns.commitChecked('a', txns.generation('a'), async () => void written.push('again'));
  assert.deepEqual(written, ['kept', 'again']);
});
