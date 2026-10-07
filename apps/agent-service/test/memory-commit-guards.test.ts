import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LearnerOp } from '../dist/memory/engine-types.js';
import { openMemory, rootScope, unitInput } from './memory-store-kit.ts';

/**
 * What a learner commit may not do: replace a body its review never saw, or give two suggestions
 * one name. And a unit's switch or review flag leaves the suggestions about it acceptable.
 */

type Kit = Awaited<ReturnType<typeof openMemory>>;

/** A commit whose review saw the whole bodies of the units named in `shown`. */
const commit = (kit: Kit, ops: LearnerOp[], shown: string[] = []) =>
  kit.memory.commitLearned(
    ops,
    rootScope(),
    kit.memory.currentPolicyVersion(),
    'idle',
    new Set(shown),
  );

test('a commit replaces only the bodies its review saw', async () => {
  const kit = await openMemory();
  try {
    const { unit: style } = await kit.memory.create(
      unitInput(
        'How to reply',
        'Chinese for chat; English for code comments; keep it short.',
        'memory',
        {
          name: 'reply-style',
        },
      ),
    );
    await kit.memory.create(unitInput('Name', 'Called Sam.', 'user', { name: 'name' }));
    const result = await commit(kit, [
      // The review listed reply-style by name and description only.
      {
        op: 'create',
        name: 'reply-style',
        description: 'Reply language',
        type: 'memory',
        body: 'Reply in Chinese.',
      },
      { op: 'update', name: 'name', body: 'Called Alex.' },
      { op: 'create', description: 'Prefers tabs', type: 'memory', body: 'Indent with tabs.' },
      { op: 'update', name: 'prefers-tabs', body: 'Indent with tabs, width 4.' },
    ]);
    assert.deepEqual(result.skipped, ['update "name": its body was not shown to the review']);
    assert.equal(result.applied, 2);
    const units = await kit.memory.units();
    const kept = units.find((unit) => unit.id === style.id);
    assert.deepEqual([kept?.description, kept?.body], ['Reply language', style.body]);
    assert.equal(units.find((unit) => unit.name === 'name')?.body, 'Called Sam.');
    assert.equal(
      units.find((unit) => unit.name === 'prefers-tabs')?.body,
      'Indent with tabs, width 4.',
      'a unit the commit itself created counts as seen',
    );

    const seen = await commit(
      kit,
      [{ op: 'update', name: 'name', body: 'Called Alex.' }],
      ['name'],
    );
    assert.equal(seen.applied, 1);
  } finally {
    await kit.close();
  }
});

test('suggestions without a name never share one', async () => {
  const kit = await openMemory();
  try {
    await kit.memory.setSettings({ askFirst: true });
    await commit(kit, [
      { op: 'create', description: '用户偏好简短回答', type: 'memory', body: '回答尽量简短。' },
      { op: 'create', description: '用户习惯中文注释', type: 'memory', body: '代码注释用中文。' },
    ]);
    await commit(kit, [
      { op: 'create', description: '用户住在上海', type: 'memory', body: '用户在上海工作。' },
    ]);
    const pending = async () =>
      (await kit.memory.state()).proposals.map((item) => [item.name, item.body]);
    assert.deepEqual(await pending(), [
      ['memory-1', '回答尽量简短。'],
      ['memory-2', '代码注释用中文。'],
      ['memory-3', '用户在上海工作。'],
    ]);
    // A name the learner gives identifies the memory: the newer suggestion replaces the older.
    await commit(kit, [
      {
        op: 'create',
        name: 'memory-2',
        description: '中文注释',
        type: 'memory',
        body: '注释用中文。',
      },
    ]);
    assert.deepEqual(await pending(), [
      ['memory-1', '回答尽量简短。'],
      ['memory-3', '用户在上海工作。'],
      ['memory-2', '注释用中文。'],
    ]);
  } finally {
    await kit.close();
  }
});

test('a switch or review change leaves the suggestions about a unit acceptable', async () => {
  const kit = await openMemory();
  try {
    const create: LearnerOp = {
      op: 'create',
      name: 'reply-language',
      description: 'Reply language',
      type: 'user',
      body: 'Reply in Chinese.',
    };
    await commit(kit, [create]);
    const [learned] = await kit.memory.units();
    assert.ok(learned && !learned.reviewed);
    await commit(kit, [{ op: 'propose_core', name: 'reply-language', reason: 'Every task.' }]);

    const version = kit.memory.currentPolicyVersion();
    await kit.memory.markReviewed(learned.id);
    assert.equal(kit.memory.currentPolicyVersion(), version, 'the review flag is no policy change');
    await kit.memory.setEnabled(learned.id, false);
    await kit.memory.setEnabled(learned.id, true);
    const { units, proposals } = await kit.memory.state();
    assert.equal(proposals[0]?.revision, units[0]?.revision);
    await kit.memory.acceptProposal(proposals[0]?.id ?? '');
    assert.equal((await kit.memory.units())[0]?.activation, 'core');
  } finally {
    await kit.close();
  }
});
