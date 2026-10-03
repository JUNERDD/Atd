import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Type } from 'typebox';
import {
  AgentTaskSchema,
  ErrorEnvelopeSchema,
  FolderRegisterResponseSchema,
  isActiveStatus,
  parse,
  SubmitTaskResponseSchema,
  TaskFoldersResponseSchema,
} from '@atd/agent-contracts';
import { startTestService } from './service-harness.ts';

/**
 * Folder registration and task grants over HTTP: only real, readable directories other than the
 * disk root, the home folder itself and the service's own data become folder refs; a submit
 * grants refs by id and refuses unknown ones; the page lists and revokes a task's grants, and a
 * deleted task leaves none behind.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
let scratch: string;
before(async () => {
  harness = await startTestService();
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'folders-register-')));
});
after(async () => {
  await harness.stop();
  await rm(scratch, { recursive: true, force: true });
});

async function register(paths: string[]) {
  const response = await harness.call('/v1/folders/register', {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });
  return { status: response.status, body: await response.json() };
}

async function registered(paths: string[]) {
  const { status, body } = await register(paths);
  assert.equal(status, 200);
  return parse(FolderRegisterResponseSchema, body);
}

test('registering refuses the root, the home folder, the data dir, files and missing paths', async () => {
  const project = path.join(scratch, 'project');
  await mkdir(project);
  const file = path.join(scratch, 'notes.txt');
  await writeFile(file, 'text');
  const dataDir = harness.config.paths.root;
  await mkdir(path.join(dataDir, 'tasks'), { recursive: true });
  const dataLink = path.join(scratch, 'data-link');
  await symlink(dataDir, dataLink);
  const requested = [
    '/',
    homedir(),
    dataDir,
    path.join(dataDir, 'tasks'),
    dataLink,
    file,
    path.join(scratch, 'missing'),
    project,
  ];
  const response = await registered(requested);
  assert.deepEqual(
    response.failures.map((failure) => [failure.path, failure.reason]),
    [
      ['/', 'forbidden'],
      [homedir(), 'forbidden'],
      [dataDir, 'forbidden'],
      [path.join(dataDir, 'tasks'), 'forbidden'],
      [dataLink, 'forbidden'],
      [file, 'notDirectory'],
      [path.join(scratch, 'missing'), 'unreadable'],
    ],
    'every refused path, in request order',
  );
  for (const failure of response.failures)
    assert.ok(!failure.message.includes(scratch), `${failure.message} names only a basename`);
  assert.equal(response.registered.length, 1);
  assert.deepEqual(response.registered[0]?.path, project);
  assert.equal(response.registered[0]?.folder.name, 'project');
  assert.equal(response.registered[0]?.folder.path, project);
});

test('a relative path is a bad request', async () => {
  const { status, body } = await register(['relative/folder']);
  assert.equal(status, 400);
  assert.equal(parse(ErrorEnvelopeSchema, body).error.code, 'bad_request');
});

test('the same realpath keeps its folder id, through a link or a later registration', async () => {
  const docs = path.join(scratch, 'docs');
  await mkdir(docs);
  const link = path.join(scratch, 'docs-link');
  await symlink(docs, link);
  const first = await registered([docs, link]);
  const again = await registered([`${docs}/`]);
  const ids = [...first.registered, ...again.registered].map((item) => item.folder.id);
  assert.equal(new Set(ids).size, 1, 'one id for one realpath');
  assert.equal(first.registered[1]?.folder.path, docs, 'the link registers its target');
});

/** A provider connection, so a submit can freeze a model; the run itself fails without a key. */
async function connect(): Promise<void> {
  const response = await harness.call('/v1/providers', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      name: 'Folder fixture',
      baseUrl: '',
      authType: 'api_key',
      defaultModel: 'gpt-4.1',
      options: {},
      customModels: [],
      credential: null,
    }),
  });
  assert.equal(response.status, 200, await response.clone().text());
}

async function submit(folders: string[], taskId?: string) {
  const response = await harness.call('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      operationId: randomUUID(),
      ...(taskId ? { taskId } : {}),
      input: {
        text: 'Summarize the folder.',
        source: 'manual',
        capturedAt: new Date().toISOString(),
        selection: '',
        clipboard: '',
        files: [],
        arguments: {},
        folders,
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

async function taskFolders(taskId: string, method = 'GET', folderId?: string) {
  const suffix = folderId ? `/${folderId}` : '';
  return harness.call(`/v1/tasks/${taskId}/folders${suffix}`, { method });
}

/** Waits for the task's runs to end (they fail without a provider key). */
async function settled(taskId: string): Promise<void> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const response = await harness.call(`/v1/tasks/${taskId}`);
    const { task } = parse(Type.Object({ task: AgentTaskSchema }), await response.json());
    if (!task.runs.some((run) => isActiveStatus(run.status))) return;
    assert.ok(Date.now() < deadline, 'the run did not end within 10 s');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('a submit grants its folders by id; the page lists and revokes them', async () => {
  await connect();
  const first = path.join(scratch, 'granted-a');
  const second = path.join(scratch, 'granted-b');
  await mkdir(first);
  await mkdir(second);
  const refs = (await registered([first, second])).registered.map((item) => item.folder);
  const [a, b] = refs.map((folder) => folder.id);
  assert.ok(a && b);

  const unknown = await submit([a, randomUUID()]);
  assert.equal(unknown.status, 400, 'an unknown folder id refuses the submit');
  assert.match(parse(ErrorEnvelopeSchema, unknown.body).error.message, /was not registered/);

  const accepted = await submit([a, a, b]);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const { taskId } = parse(SubmitTaskResponseSchema, accepted.body);
  const listed = parse(TaskFoldersResponseSchema, await (await taskFolders(taskId)).json());
  assert.deepEqual(listed.folders, refs, 'deduplicated, in grant order');

  const revoked = await taskFolders(taskId, 'DELETE', a);
  assert.equal(revoked.status, 200);
  const remaining = parse(TaskFoldersResponseSchema, await revoked.json()).folders;
  assert.deepEqual(
    remaining.map((folder) => folder.id),
    [b],
  );
  assert.equal((await taskFolders(taskId, 'DELETE', a)).status, 404, 'no longer granted');
  assert.equal((await taskFolders(randomUUID())).status, 404, 'unknown task');
  const other = parse(SubmitTaskResponseSchema, (await submit([])).body).taskId;
  const isolated = parse(TaskFoldersResponseSchema, await (await taskFolders(other)).json());
  assert.deepEqual(isolated.folders, [], "another task has none of this task's grants");

  await settled(taskId);
  assert.equal((await harness.call(`/v1/tasks/${taskId}`, { method: 'DELETE' })).status, 200);
  const stored = parse(
    Type.Object({ grants: Type.Record(Type.String(), Type.Unknown()) }),
    JSON.parse(await readFile(path.join(harness.config.paths.root, 'folders.json'), 'utf8')),
  );
  assert.ok(!(taskId in stored.grants), 'a deleted task leaves no grants');
  await settled(other);
});
