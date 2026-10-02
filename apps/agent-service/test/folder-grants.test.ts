import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { FolderRef } from '@atd/agent-contracts';
import { createLogger } from '../dist/logging.js';
import { formatFolders, runFolders } from '../dist/folders/material.js';
import { folderOverview, OVERVIEW_ENTRIES } from '../dist/folders/overview.js';
import { FolderStore } from '../dist/folders/store.js';

/**
 * Task grants as runs see them: a run reads its task's grants once at its start, so a revoke
 * reaches the next run; grants never cross tasks; the first run after a grant introduces the
 * folder with a bounded overview, later runs only list it.
 */

let scratch: string;
let dataDir: string;
before(async () => {
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'folder-grants-')));
  dataDir = path.join(scratch, 'data');
  await mkdir(dataDir);
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function folders(store: FolderStore, ...names: string[]): Promise<FolderRef[]> {
  const paths = names.map((name) => path.join(scratch, name));
  for (const folder of paths) await mkdir(folder, { recursive: true });
  const { registered, failures } = await store.register(paths);
  assert.deepEqual(failures, []);
  return registered.map((item) => item.folder);
}

const ids = (refs: readonly { folder: FolderRef }[]) => refs.map((item) => item.folder.id);

test('a revoke reaches the next run; grants stay with their task', async () => {
  const store = await FolderStore.load(dataDir);
  const [one, two] = await folders(store, 'one', 'two');
  assert.ok(one && two);
  await store.grant('task-a', [one.id, two.id, one.id]);
  const first = await store.startRun('task-a');
  assert.deepEqual(ids(first), [one.id, two.id]);
  assert.deepEqual(
    first.map((item) => item.introduce),
    [true, true],
    'the first run introduces both',
  );
  const second = await store.startRun('task-a');
  assert.deepEqual(
    second.map((item) => item.introduce),
    [false, false],
    'later runs only list them',
  );

  assert.deepEqual(await store.revoke('task-a', one.id), [two]);
  assert.deepEqual(ids(await store.startRun('task-a')), [two.id], 'the next run lost it');
  assert.deepEqual(first.length, 2, 'a started run keeps what it started with');
  await assert.rejects(store.revoke('task-a', one.id), /was not found/);

  assert.deepEqual(store.list('task-b'), [], 'no grant crosses tasks');
  assert.deepEqual(await store.startRun('task-b'), []);

  await store.grant('task-a', [two.id]);
  const regranted = await store.startRun('task-a');
  assert.equal(regranted[0]?.introduce, true, 'granting again introduces again');

  await store.copy('task-a', 'task-fork');
  assert.deepEqual(store.list('task-fork'), [two], 'a fork carries the grants');
  await store.forget('task-a');
  assert.deepEqual(store.list('task-a'), []);
  const reloaded = await FolderStore.load(dataDir);
  assert.deepEqual(reloaded.list('task-fork'), [two], 'grants persist in the data dir');
  assert.deepEqual(reloaded.list('task-a'), []);
});

test('unknown ids and folders that moved or became links are refused', async () => {
  const store = await FolderStore.load(dataDir);
  assert.throws(() => store.resolve(['missing-id']), /was not registered/);
  await assert.rejects(store.grant('task-c', ['missing-id']), TypeError);

  const [moved, linked] = await folders(store, 'moved', 'linked');
  assert.ok(moved && linked);
  await store.grant('task-c', [moved.id, linked.id]);
  await rename(moved.path, `${moved.path}-elsewhere`);
  await rm(linked.path, { recursive: true });
  const target = path.join(scratch, 'link-target');
  await mkdir(target);
  await symlink(target, linked.path);
  assert.deepEqual(await store.startRun('task-c'), [], 'neither reaches a run');
  await assert.rejects(store.grant('task-d', [linked.id]), /no longer available/);
});

test('the overview is bounded, skips hidden, dependency and ignored entries', async () => {
  const root = path.join(scratch, 'project');
  const files: Array<[string, string]> = [
    ['README.md', ''],
    ['.env', 'secret'],
    ['.gitignore', '*.log\n/tmp/\nsecret/\n!keep.log\n'],
    ['app.log', ''],
    ['keep.log', ''],
    ['tmp/cache.txt', ''],
    ['nested/tmp/kept.txt', ''],
    ['secret/key.pem', ''],
    ['node_modules/pkg/index.js', ''],
    ['dist/bundle.js', ''],
    ['src/a/b/c/deep.ts', ''],
  ];
  for (const [file, content] of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  const overview = await folderOverview(root);
  assert.equal(
    overview,
    ['keep.log', 'nested/', '  tmp/', '    kept.txt', 'README.md', 'src/', '  a/', '    b/'].join(
      '\n',
    ),
  );

  const wide = path.join(scratch, 'wide');
  await mkdir(wide);
  for (let index = 0; index < OVERVIEW_ENTRIES + 5; index += 1)
    await writeFile(path.join(wide, `file-${String(index).padStart(3, '0')}.txt`), '');
  const truncated = (await folderOverview(wide)).split('\n');
  assert.equal(truncated.length, OVERVIEW_ENTRIES + 1);
  assert.match(truncated.at(-1) ?? '', /Truncated after 200 entries/);
});

test('the first run after a grant gets the overview; every run lists the folder', async () => {
  const store = await FolderStore.load(dataDir);
  const [listed] = await folders(store, 'material');
  assert.ok(listed);
  await writeFile(path.join(listed.path, 'plan.md'), '');
  await store.grant('task-e', [listed.id]);
  const log = createLogger('info');
  const first = await runFolders(store, 'task-e', log);
  const text = formatFolders(first);
  assert.match(text, /read-only access/);
  assert.ok(text.includes(`- material: ${listed.path}`));
  assert.ok(text.includes(`<folder_overview name="material" path="${listed.path}">`));
  assert.match(text, /plan\.md/);
  const later = formatFolders(await runFolders(store, 'task-e', log));
  assert.ok(later.includes(`- material: ${listed.path}`));
  assert.doesNotMatch(later, /folder_overview/);
  assert.equal(formatFolders([]), '');
});
