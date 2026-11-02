import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommandCreateSchema, parse } from '@atd/agent-contracts';
import { CommandStore } from '../dist/commands/store.js';

test('adjustment suggestions are canonical on create, update and reload', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'command-adjustments-'));
  try {
    const store = await CommandStore.load(dir);
    const created = await store.create({
      name: 'Review fixture',
      instructions: 'Polish {{input}}',
      input: {
        source: 'selection',
        required: true,
        selection: true,
        clipboard: false,
        files: false,
      },
      adjustments: [' Shorter ', '', 'More natural', 'Shorter', '  '],
      output: { action: 'replaceSelection', review: true },
    });
    assert.deepEqual(created.adjustments, ['Shorter', 'More natural']);
    const saved = await store.update(
      created.id,
      {
        ...created,
        adjustments: [' Formal ', 'Formal', 'Keep names'],
      },
      created.revision,
    );
    assert.deepEqual(saved.adjustments, ['Formal', 'Keep names']);
    const reloaded = (await CommandStore.load(dir)).get(created.id);
    assert.deepEqual(reloaded.adjustments, saved.adjustments);
    assert.deepEqual(reloaded.output, { action: 'replaceSelection', review: true });
    assert.equal(reloaded.revision, created.revision + 1);
    const empty = await store.update(
      saved.id,
      {
        ...saved,
        adjustments: ['  '],
      },
      saved.revision,
    );
    assert.deepEqual(empty.adjustments, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('legacy commands omit suggestions, while oversized suggestion lists are rejected at the boundary', () => {
  assert.equal(
    CommandStore.compose({ name: 'Legacy', instructions: 'Do {{input}}' }).adjustments,
    undefined,
  );
  for (const adjustments of [
    Array.from({ length: 9 }, (_, i) => `Suggestion ${i}`),
    ['x'.repeat(41)],
  ]) {
    assert.throws(() =>
      parse(CommandCreateSchema, { name: 'Invalid', instructions: 'Do {{input}}', adjustments }),
    );
  }
});
