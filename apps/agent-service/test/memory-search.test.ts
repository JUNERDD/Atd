import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { searchTerms } from '../dist/memory/fts-query.js';
import { MemoryIndex } from '../dist/memory/index-db.js';
import { openMemory, unitInput } from './memory-store-kit.ts';

/** Full-text search over the enabled units: FTS5 trigram, the LIKE path, and index healing. */

async function seeded() {
  const kit = await openMemory();
  const add = (description: string, body: string, name: string, type = 'memory' as const) =>
    kit.memory.create(unitInput(description, body, type, { name }));
  await add('Release checklist', 'Tag the build, then publish the notes.', 'deploy-steps');
  await add('How deploys reach production', 'Ask before shipping.', 'shipping');
  await add('Package manager', 'Always use pnpm; the deploy script calls it too.', 'tooling');
  await add('回答语言', '始终用中文回答，代码注释保持英文。', 'answer-language');
  return kit;
}

const names = (hits: { unit: { name: string } }[]) => hits.map((hit) => hit.unit.name);

test('the runtime has FTS5 with the trigram tokenizer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'memory-index-'));
  try {
    const index = MemoryIndex.open(path.join(dir, 'index.db'), (message) => assert.fail(message));
    assert.equal(index.fts, true);
    index.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('matches rank a name above a description above a body', async () => {
  const kit = await seeded();
  try {
    const hits = await kit.memory.search('deploy', { limit: 10 });
    assert.deepEqual(names(hits), ['deploy-steps', 'shipping', 'tooling']);
    assert.match(hits[2]?.snippet ?? '', /deploy script/);
    assert.deepEqual(names(await kit.memory.search('deploy', { limit: 2 })), [
      'deploy-steps',
      'shipping',
    ]);
    assert.deepEqual(names(await kit.memory.search('deploy', { type: 'user', limit: 10 })), []);
  } finally {
    await kit.close();
  }
});

test('a two-character Chinese term still matches, through LIKE', async () => {
  const kit = await seeded();
  try {
    const hits = await kit.memory.search('中文', { limit: 5 });
    assert.deepEqual(names(hits), ['answer-language']);
    assert.match(hits[0]?.snippet ?? '', /中文/);
    assert.deepEqual(names(await kit.memory.search('中文回答', { limit: 5 })), ['answer-language']);
    assert.deepEqual(names(await kit.memory.search('回答 pnpm', { limit: 5 })).sort(), [
      'answer-language',
      'tooling',
    ]);
  } finally {
    await kit.close();
  }
});

test('all terms win over any term, and filler words are ignored', async () => {
  const kit = await seeded();
  try {
    assert.deepEqual(names(await kit.memory.search('pnpm deploy', { limit: 5 })), ['tooling']);
    assert.deepEqual(names(await kit.memory.search('pnpm zebra', { limit: 5 })), ['tooling']);
    assert.deepEqual(names(await kit.memory.search('what is the release?', { limit: 5 })), [
      'deploy-steps',
    ]);
    assert.deepEqual(await kit.memory.search('  ', { limit: 5 }), []);
    assert.deepEqual(searchTerms('the "release notes" AND pnpm, or 中文!'), [
      'release notes',
      'pnpm',
      '中文',
    ]);
  } finally {
    await kit.close();
  }
});

test('search follows edits, renames and deletes', async () => {
  const kit = await seeded();
  try {
    const tooling = (await kit.memory.units()).find((unit) => unit.name === 'tooling');
    assert.ok(tooling);
    const edit = { id: tooling.id, revision: tooling.revision, body: 'Use bun now.' };
    const { unit: edited } = await kit.memory.save(edit);
    assert.deepEqual(names(await kit.memory.search('pnpm', { limit: 5 })), []);
    assert.deepEqual(names(await kit.memory.search('bun', { limit: 5 })), ['tooling']);
    await kit.memory.save({ id: tooling.id, revision: edited.revision, name: 'runtime-choice' });
    assert.deepEqual(names(await kit.memory.search('runtime', { limit: 5 })), ['runtime-choice']);
    await kit.memory.delete(tooling.id);
    assert.deepEqual(names(await kit.memory.search('bun', { limit: 5 })), []);
  } finally {
    await kit.close();
  }
});

test('a corrupt index is rebuilt from the unit files', async () => {
  const kit = await seeded();
  try {
    assert.equal((await kit.memory.search('release', { limit: 5 })).length, 1);
    kit.memory.close();
    await writeFile(path.join(kit.root, 'index.db'), 'this is not a database');
    await kit.reopen();
    assert.deepEqual(names(await kit.memory.search('release', { limit: 5 })), ['deploy-steps']);
    assert.ok(kit.notices.some((notice) => /rebuilt from the memory files/.test(notice)));
  } finally {
    await kit.close();
  }
});
