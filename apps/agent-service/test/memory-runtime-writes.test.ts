import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { MEMORY_READ_TOOLS, MEMORY_WRITE_TOOLS } from '@atd/agent-contracts';
import { memoryTools, type MemoryToolHost } from '../dist/memory/tools.js';
import { FakeStore, openSession, rootScope, unit } from './memory-runtime-kit.ts';

/**
 * The memory write tools (memory/tools.ts) on real sessions: each write reaches the store under
 * the scope of the run making it, results say what was saved, and refused writes name their
 * reason without reaching the store.
 */

let scratch: string;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'memory-runtime-writes-'));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function toolSession(host: MemoryToolHost) {
  return openSession(scratch, [memoryTools(host)], [...MEMORY_READ_TOOLS, ...MEMORY_WRITE_TOOLS]);
}

const NEW_MEMORY = { type: 'user', description: 'Speaks Chinese.', body: 'Prefers Chinese.' };

const SUGGESTED =
  'Including it in every task needs the user: a suggestion now waits for them in Settings → Memory.';

test("writes reach the store under the current run's scope and report what was saved", async () => {
  const store = new FakeStore([unit('prefers-pnpm')]);
  let runId = 'run-1';
  const { session, prompt } = await toolSession({
    store,
    scope: () => rootScope(runId),
    readOnly: false,
  });
  const tabs = {
    type: 'memory',
    description: 'Indents with tabs.',
    body: 'Use tabs.',
    name: 'tabs',
  };
  const [added, replaced, empty, missing, invalid] = await prompt([
    ['memory_add', tabs],
    ['memory_replace', { name: 'prefers-pnpm', body: 'Use pnpm 12.', activation: 'core' }],
    ['memory_replace', { name: 'prefers-pnpm' }],
    ['memory_replace', { name: 'never-saved', body: 'Anything.' }],
    ['memory_add', { ...tabs, name: 'Not A Slug' }],
  ]);
  assert.equal(
    added?.text,
    'Saved memory "tabs" (type memory, listed in the memory index from the next message on).',
  );
  assert.deepEqual(added?.details, { id: store.units[1]?.id, name: 'tabs' });
  assert.equal(
    replaced?.text,
    `Updated memory "prefers-pnpm" (type memory, listed in the memory index from the next message on). ${SUGGESTED}`,
  );
  assert.equal(empty?.isError, true);
  assert.match(
    empty?.text ?? '',
    /Give a new description, body or activation; no memory was changed\./,
  );
  assert.equal(missing?.isError, true);
  assert.match(missing?.text ?? '', /No memory named "never-saved" is available\./);
  assert.equal(invalid?.isError, true, "the contract's name rule refuses it before the store");

  runId = 'run-2';
  const [removed] = await prompt([['memory_remove', { name: 'tabs' }]]);
  session.dispose();
  assert.equal(removed?.text, 'Forgot memory "tabs".');
  assert.deepEqual(store.calls, [
    ['add', tabs, rootScope('run-1')],
    ['replace', 'prefers-pnpm', { body: 'Use pnpm 12.', activation: 'core' }, rootScope('run-1')],
    ['remove', 'tabs', rootScope('run-2')],
  ]);
});

test('a request for always-on waits for the user, who alone takes a memory out of it', async () => {
  const store = new FakeStore([unit('profile', { type: 'user', activation: 'core' })]);
  const { session, prompt } = await toolSession({
    store,
    scope: () => rootScope('run-1'),
    readOnly: false,
  });
  const [added, demoted, edited] = await prompt([
    ['memory_add', { ...NEW_MEMORY, activation: 'core' }],
    ['memory_replace', { name: 'profile', activation: 'search' }],
    ['memory_replace', { name: 'profile', description: 'Who the user is.', activation: 'index' }],
  ]);
  session.dispose();
  assert.equal(
    added?.text,
    `Saved memory "memory-1" (type user, listed in the memory index from the next message on). ${SUGGESTED}`,
  );
  const kept =
    'Only the user takes a memory out of every task, in Settings → Memory; it stays always included.';
  assert.equal(demoted?.isError, true);
  assert.equal(demoted?.text, `${kept} No memory was changed.`);
  assert.equal(
    edited?.text,
    `Updated memory "profile" (type user, in every task from the next message on). ${kept}`,
  );
  assert.equal(store.units[0]?.activation, 'core');
  assert.equal(store.calls.length, 2, 'the refused call never reaches the store');
});

test('paused learning refuses writes and says why; reads go on; memory off refuses both', async () => {
  const store = new FakeStore([unit('prefers-pnpm')]);
  store.paused = true;
  let runMemory = true;
  const { session, prompt } = await toolSession({
    store,
    scope: () => rootScope('run-1', runMemory),
    readOnly: false,
  });
  const [add, remove, read] = await prompt([
    ['memory_add', NEW_MEMORY],
    ['memory_remove', { name: 'prefers-pnpm' }],
    ['memory_read', { name: 'prefers-pnpm' }],
  ]);
  for (const refused of [add, remove]) {
    assert.equal(refused?.isError, true);
    assert.match(
      refused?.text ?? '',
      /Memory learning is paused in Settings → Memory, so no memory was changed\. Tell the user/,
    );
  }
  assert.equal(read?.isError, false);

  runMemory = false;
  const outcomes = await prompt([
    ['memory_read', { name: 'prefers-pnpm' }],
    ['memory_search', { query: 'pnpm' }],
    ['memory_add', NEW_MEMORY],
  ]);
  session.dispose();
  for (const outcome of outcomes) {
    assert.equal(outcome.isError, true);
    assert.match(outcome.text, /Memory is off for this message\./);
  }
  assert.deepEqual(store.calls, []);
  assert.equal(store.units.length, 1);
});
