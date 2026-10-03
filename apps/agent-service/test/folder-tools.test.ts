import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { PermissionRequest } from '@atd/agent-contracts';
import { createGate } from '../dist/harness/gate.js';
import { searchToolsExtension } from '../dist/harness/search-tools.js';
import { resolveRipgrep } from '../dist/harness/search/ripgrep.js';
import { NO_RUN_MATERIAL } from '../dist/pi-session.js';
import { serviceTools } from '../dist/tool-proxies.js';
import { startTestService } from './service-harness.ts';

/**
 * The read boundary of a granted folder: read, ls, find and grep reach it without approval, write
 * and edit never reach it, a link inside it that leads elsewhere stays outside, and only the
 * folders the current run started with count, so a revoke (or another task) sees none.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
let scratch: string;
let folder: string;
let outside: string;
before(async () => {
  harness = await startTestService();
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'folder-tools-')));
  folder = path.join(scratch, 'granted');
  outside = path.join(scratch, 'outside');
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(folder, 'notes.md'), 'granted notes');
  await writeFile(path.join(folder, 'src', 'a.ts'), 'export const needle = 1;\n');
  await writeFile(path.join(outside, 'secret.txt'), 'needle secret');
  await symlink(outside, path.join(folder, 'escape'));
  await symlink(path.join(outside, 'secret.txt'), path.join(folder, 'escape.txt'));
});
after(async () => {
  await harness.stop();
  await rm(scratch, { recursive: true, force: true });
});

type ToolArgs = Parameters<typeof fauxToolCall>[1];

interface ToolOutcome {
  isError: boolean;
  text: string;
}

/**
 * Runs one prompt of a task whose current run was granted `granted`, on the faux model calling
 * `calls` (`[name, args]`, ids `call-<index>`). Any confirmation raised is declined and reported.
 */
async function runWith(granted: string[], calls: Array<[string, ToolArgs]>) {
  const { paths } = harness.config;
  const taskId = randomUUID();
  const runId = randomUUID();
  const cwd = path.join(paths.tasksDir, taskId, 'output');
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.inMemory(cwd);
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage(
      calls.map(([name, args], index) => fauxToolCall(name, args, { id: `call-${index}` })),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('done'),
  ]);
  const models = await ModelRuntime.create({
    authPath: path.join(scratch, 'auth.json'),
    modelsPath: null,
    modelsStorePath: path.join(scratch, 'models-cache.json'),
    refreshOnCreate: false,
  });
  models.registerNativeProvider(faux.provider);
  const audits: Array<Record<string, unknown>> = [];
  const host = {
    taskId,
    runId: () => runId,
    executionId: () => runId,
    cwd,
    dataDir: paths.root,
    tier: 'manual' as const,
    grants: new Set<string>(),
    review: async () => ({ decision: 'allow' as const, reason: '' }),
    sessions: manager,
    confirms: harness.service.confirms,
    capabilities: harness.service.capabilities,
    audit: (entry: Record<string, unknown>) => audits.push(entry),
    log: harness.service.log,
    setStatus: () => undefined,
    skillDirs: () => [],
    taskResources: harness.service.resources.forTask(taskId),
    folders: () => granted,
  };
  const material = {
    ...NO_RUN_MATERIAL,
    folders: granted.map((real) => ({ name: path.basename(real), path: real })),
  };
  const search = searchToolsExtension({
    cwd,
    gate: createGate(host),
    runner: {
      taskId,
      currentRunId: () => runId,
      currentMaterial: () => material,
      audit: host.audit,
      ctx: { paths: { root: paths.root } },
    },
  });
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: scratch,
    settingsManager,
    noSkills: true,
    extensionFactories: [serviceTools(host), search],
  });
  await loader.reload();
  const tools = ['read', 'write', 'edit', 'ls', 'find', 'grep'];
  const { session } = await createAgentSession({
    cwd,
    agentDir: scratch,
    modelRuntime: models,
    model: faux.getModel(),
    settingsManager,
    sessionManager: manager,
    resourceLoader: loader,
    tools,
  });
  session.setActiveToolsByName(tools);
  await session.bindExtensions({ mode: 'json' });

  const asked: PermissionRequest[] = [];
  let prompting = true;
  const decline = (async () => {
    while (prompting) {
      for (const request of harness.service.confirms.pending()) {
        asked.push(request);
        await harness.service.confirms.reply(request.id, request.revision, {
          decision: 'declined',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  })();
  await session.prompt('Use the tools.').finally(() => {
    prompting = false;
  });
  await decline;
  session.dispose();

  const outcomes = new Map<string, ToolOutcome>();
  for (const entry of manager.getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
    const text = entry.message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    outcomes.set(entry.message.toolCallId, { isError: entry.message.isError, text: text.join('') });
  }
  const outcome = (index: number): ToolOutcome => {
    const found = outcomes.get(`call-${index}`);
    assert.ok(found, `call-${index} has a result`);
    return found;
  };
  return { outcome, asked, audits, cwd };
}

test('read and ls reach a granted folder without approval; write and edit never do', async () => {
  const { outcome, asked, audits } = await runWith(
    [folder],
    [
      ['read', { path: path.join(folder, 'notes.md') }],
      ['ls', { path: folder }],
      ['write', { path: path.join(folder, 'new.txt'), content: 'never' }],
      [
        'edit',
        {
          path: path.join(folder, 'notes.md'),
          edits: [{ oldText: 'granted', newText: 'changed' }],
        },
      ],
      ['read', { path: path.join(folder, 'escape', 'secret.txt') }],
      ['read', { path: path.join(folder, 'escape.txt') }],
      ['ls', { path: path.join(folder, 'escape') }],
    ],
  );
  assert.deepEqual(asked, [], 'nothing asked for approval');
  assert.equal(outcome(0).isError, false);
  assert.match(outcome(0).text, /granted notes/);
  assert.equal(outcome(1).isError, false);
  assert.match(outcome(1).text, /notes\.md/);
  assert.match(outcome(1).text, /src\//);
  for (const index of [2, 3]) {
    assert.equal(outcome(index).isError, true, `call-${index} cannot change the folder`);
    assert.match(outcome(index).text, /blocked/);
  }
  assert.equal(await readFile(path.join(folder, 'notes.md'), 'utf8'), 'granted notes');
  for (const index of [4, 5, 6]) {
    assert.equal(outcome(index).isError, true, `call-${index} cannot follow a link out`);
    assert.doesNotMatch(outcome(index).text, /secret/);
  }
  const decisions = audits
    .filter((entry) => entry.decision === 'folder')
    .map((entry) => entry.tool);
  assert.deepEqual(decisions, ['read:folder', 'ls:folder']);
});

test('find and grep search a granted folder without following links out', async (t) => {
  if (
    !(await resolveRipgrep().then(
      () => true,
      () => false,
    ))
  )
    return t.skip('ripgrep is not on PATH');
  const { outcome, asked } = await runWith(
    [folder],
    [
      ['find', { pattern: '*.ts', path: folder }],
      ['grep', { pattern: 'needle', path: folder }],
      ['grep', { pattern: 'needle', path: path.join(folder, 'escape') }],
    ],
  );
  assert.deepEqual(asked, []);
  assert.equal(outcome(0).isError, false);
  assert.match(outcome(0).text, /src\/a\.ts/);
  assert.equal(outcome(1).isError, false);
  assert.match(outcome(1).text, /a\.ts/);
  assert.doesNotMatch(outcome(1).text, /secret/, 'grep does not follow a link out');
  assert.equal(outcome(2).isError, true);
});

test('a run without the grant (revoked, or another task) cannot read the folder', async () => {
  const other = path.join(scratch, 'other-task-folder');
  await mkdir(other);
  await writeFile(path.join(other, 'own.md'), 'own folder');
  const { outcome, asked } = await runWith(
    [other],
    [
      ['read', { path: path.join(folder, 'notes.md') }],
      ['ls', { path: folder }],
      ['read', { path: path.join(other, 'own.md') }],
    ],
  );
  assert.deepEqual(asked, [], 'refused before any approval');
  for (const index of [0, 1]) {
    assert.equal(outcome(index).isError, true, `call-${index} is outside this run's folders`);
    assert.match(outcome(index).text, /blocked/);
  }
  assert.equal(outcome(2).isError, false);
  assert.match(outcome(2).text, /own folder/);
});
