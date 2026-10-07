import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
import { serviceTools } from '../dist/tool-proxies.js';
import { readUnattendedAudit } from '../dist/unattended.js';
import { startTestService } from './service-harness.ts';

/**
 * An unattended run records each file its write and edit tools changed (`decision: 'wrote'`), by
 * the real path the file has once written, NFC-normalized, so a folder automation can skip its
 * own run's output. A run a person started records none, and neither does a refused write.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
let scratch: string;
before(async () => {
  harness = await startTestService();
  scratch = await mkdtemp(path.join(tmpdir(), 'unattended-writes-'));
});
after(async () => {
  await harness.stop();
  await rm(scratch, { recursive: true, force: true });
});

type ToolArgs = Parameters<typeof fauxToolCall>[1];

/** One prompt of a task whose current run makes `calls` on the faux model; answers its audit. */
async function runWith(unattended: boolean, calls: Array<[string, ToolArgs]>) {
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
    // Writes run unasked, so only the run's kind decides whether they are recorded.
    tier: 'always' as const,
    grants: new Set<string>(),
    review: async () => ({ decision: 'allow' as const, reason: '' }),
    unattended: () => unattended,
    sessions: manager,
    confirms: harness.service.confirms,
    capabilities: harness.service.capabilities,
    audit: (entry: Record<string, unknown>) => audits.push(entry),
    log: harness.service.log,
    setStatus: () => undefined,
    skillDirs: () => [],
    taskResources: harness.service.resources.forTask(taskId),
    folders: () => [],
  };
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: scratch,
    settingsManager,
    noSkills: true,
    extensionFactories: [serviceTools(host)],
  });
  await loader.reload();
  const tools = ['read', 'write', 'edit'];
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
  await session.prompt('Use the tools.');
  session.dispose();
  return { audits, cwd: await realpath(cwd) };
}

test('an unattended run records the real, NFC path of every file it wrote', async () => {
  // A decomposed name (e + combining acute) is recorded composed, as folder scans key files.
  const decomposed = 'café.md';
  const { audits, cwd } = await runWith(true, [
    ['write', { path: decomposed, content: 'first' }],
    ['edit', { path: decomposed, edits: [{ oldText: 'first', newText: 'second' }] }],
    ['write', { path: 'nested/report.md', content: 'report' }],
    ['edit', { path: 'missing.md', edits: [{ oldText: 'a', newText: 'b' }] }],
    ['write', { path: '/etc/outside.md', content: 'refused' }],
  ]);
  const wrote = audits.filter((entry) => entry.decision === 'wrote');
  assert.deepEqual(
    wrote.map(({ tool, path: file, toolCallId }) => [tool, file, toolCallId]),
    [
      ['write', path.join(cwd, 'café.md'), 'call-0'],
      ['edit', path.join(cwd, 'café.md'), 'call-1'],
      ['write', path.join(cwd, 'nested', 'report.md'), 'call-2'],
    ],
    'failed and refused writes record nothing',
  );
  assert.equal(path.join(cwd, 'café.md').normalize('NFC'), path.join(cwd, 'café.md'));
});

test('a run a person started records no writes', async () => {
  const { audits } = await runWith(false, [['write', { path: 'notes.md', content: 'mine' }]]);
  assert.equal(audits.filter((entry) => entry.decision === 'wrote').length, 0);
});

test('the engine reads declines and absolute written paths from the audit', async () => {
  const runId = randomUUID();
  const { auditDir } = harness.config.paths;
  await mkdir(auditDir, { recursive: true });
  const lines = [
    { decision: 'unattended', kind: 'confirm', title: 'bash: rm -rf build' },
    { decision: 'wrote', tool: 'write', path: '/Users/me/Inbox/out.md' },
    { decision: 'wrote', tool: 'edit', path: 'relative.md' },
    { decision: 'tier', tool: 'write:inside' },
    { decision: 'unattended', kind: 'question', title: 'Which format?' },
  ];
  const text = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n{"decision":"wro`;
  await writeFile(path.join(auditDir, `${runId}.jsonl`), text);
  assert.deepEqual(await readUnattendedAudit(auditDir, runId), {
    declined: 2,
    wrote: ['/Users/me/Inbox/out.md'],
  });
  assert.deepEqual(await readUnattendedAudit(auditDir, randomUUID()), { declined: 0, wrote: [] });
});
