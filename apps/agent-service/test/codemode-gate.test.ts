import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemMessage,
} from '@earendil-works/pi-ai';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { ServiceBlock } from '@ai/agent-contracts';
import { codemodeExtension } from '../dist/codemode/extension.js';
import { serviceTools } from '../dist/tool-proxies.js';
import { fromServiceBranch, projectServiceBlocks } from '../dist/transcript.js';
import { answerConfirm } from './mcp-kit.ts';
import { startTestService } from './service-harness.ts';

/**
 * A codemode script's tool calls go through the same approval as the model's own: each nested
 * call raises its own confirm under its `<codemode id>/<n>` id, a decline refuses it (the script
 * sees the decline as a rejected call), and the transcript shows each call as a row with its
 * recorded outcome.
 */

/** The codemode row of a settled session's transcript. */
function codemodeBlock(manager: SessionManager, runId = randomUUID()) {
  return projectServiceBlocks({
    branch: fromServiceBranch(manager.getBranch()),
    firstRunId: runId,
    live: false,
  }).find(
    (item): item is Extract<ServiceBlock, { kind: 'tool' }> =>
      item.kind === 'tool' && item.name === 'codemode',
  );
}

let harness: Awaited<ReturnType<typeof startTestService>>;
let scratch: string;
before(async () => {
  harness = await startTestService();
  scratch = await mkdtemp(path.join(tmpdir(), 'codemode-gate-'));
});
after(async () => {
  await harness.stop();
  await rm(scratch, { recursive: true, force: true });
});

const SCRIPT = [
  'try {',
  "  await tools.write({ path: 'declined.txt', content: 'never' });",
  '} catch (error) {',
  "  text('write refused: ' + error.message);",
  '}',
  "const shell = await tools.bash({ command: 'echo approved-run' });",
  'return shell.output;',
].join('\n');

/**
 * A parent-like session on the faux model: the service's file and shell tools plus codemode.
 * Sessions opened with the same `taskId` share the task's resources.
 */
async function openSession(script: string, taskId: string = randomUUID()) {
  const { paths } = harness.config;
  const runId = randomUUID();
  const cwd = path.join(paths.tasksDir, taskId, 'output');
  await mkdir(cwd, { recursive: true });
  const manager = SessionManager.inMemory(cwd);
  const faux = fauxProvider();
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('codemode', { code: script }, { id: 'call-1' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('done'),
  ]);
  const models = await ModelRuntime.create({
    authPath: path.join(scratch, 'auth.json'),
    modelsPath: null,
    modelsStorePath: path.join(scratch, 'models-cache.json'),
    refreshOnCreate: false,
  });
  models.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } });
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
    audit: () => undefined,
    log: harness.service.log,
    setStatus: () => undefined,
    skillDirs: () => [],
    taskResources: harness.service.resources.forTask(taskId),
  };
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: scratch,
    settingsManager,
    noSkills: true,
    extensionFactories: [
      serviceTools(host),
      codemodeExtension({
        taskId,
        resources: harness.service.resources,
        resourcesDir: paths.resourcesDir,
        log: harness.service.log,
      }),
    ],
  });
  await loader.reload();
  const tools = ['codemode', 'read', 'write', 'bash'];
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

  return { session, manager, cwd, runId };
}

test('nested write and bash calls ask like direct calls; a decline refuses the call', async () => {
  const { session, manager, cwd, runId } = await openSession(SCRIPT);
  const prompting = session.prompt('Write the file, then run the command.');
  const write = await answerConfirm(harness.service.confirms, 'declined');
  const bash = await answerConfirm(harness.service.confirms, 'once');
  await prompting;
  session.dispose();

  assert.equal(write.kind, 'confirmation');
  assert.equal(write.toolCallId, 'call-1/1');
  assert.deepEqual(write.kind === 'confirmation' && write.scope, {
    tool: 'write',
    location: 'inside',
  });
  assert.equal(bash.toolCallId, 'call-1/2');
  assert.deepEqual(bash.kind === 'confirmation' && bash.scope, { tool: 'bash' });
  await assert.rejects(access(path.join(cwd, 'declined.txt')), 'the declined write never ran');

  const block = codemodeBlock(manager, runId);
  assert.ok(block, 'the codemode call is a tool row');
  assert.equal(block.status, 'completed');
  assert.match(block.output, /write refused: The user declined this action\./);
  assert.match(block.output, /approved-run/);
  assert.equal(block.details?.type, 'codemode');
  const steps = block.details?.type === 'codemode' ? block.details.steps : [];
  assert.deepEqual(
    steps.map((step) => [step.id, step.name, step.status, step.permission?.outcome]),
    [
      ['call-1/1', 'write', 'declined', 'declined'],
      ['call-1/2', 'bash', 'completed', 'once'],
    ],
  );
  assert.deepEqual(steps[0]?.args, { path: 'declined.txt', content: 'never' });
  assert.match(steps[1]?.output ?? '', /approved-run/);

  // Mode `on` keeps the tools declared and appends how a script calls them; the context
  // breakdown estimates the declarations as sent, so it counts that note.
  const declared = getCurrentSystemMessage(manager.buildSessionContext().messages)?.toolsAdded;
  const writeTool = declared?.find((tool) => tool.name === 'write');
  assert.match(writeTool?.description ?? '', /Codemode: `tools\.write\(args\)`/);
});

test('output over the script budget is kept in the task resources, not the temp dir', async () => {
  const script = '// @options: {"max_output_tokens": 20}\nreturn "x".repeat(400);';
  const { session, manager } = await openSession(script);
  await session.prompt('Print a lot.');
  session.dispose();
  const output = codemodeBlock(manager)?.output ?? '';
  const kept = /\[Full output: (\S+) \(read with offset\/limit\)\]/.exec(output)?.[1] ?? '';
  assert.equal(path.dirname(kept), harness.config.paths.resourcesDir);
  assert.equal(await readFile(kept, 'utf8'), 'x'.repeat(400));
  assert.doesNotMatch(output, /pi-codemode-/, 'no temp path reaches the model or the client');
});

test("reading the task's spilled output needs no approval; another task's resource still asks", async () => {
  const taskId = randomUUID();
  const spill = await openSession(
    '// @options: {"max_output_tokens": 20}\nreturn "x".repeat(400);',
    taskId,
  );
  await spill.session.prompt('Print a lot.');
  spill.session.dispose();
  const output = codemodeBlock(spill.manager)?.output ?? '';
  const kept = /\[Full output: (\S+) \(read with offset\/limit\)\]/.exec(output)?.[1] ?? '';
  assert.ok(kept, 'the output was spilled into the resources');
  const other = await harness.service.resources.save({
    name: 'other.txt',
    mime: 'text/plain',
    bytes: new TextEncoder().encode('secret of another task'),
    taskId: randomUUID(),
  });
  const script = [
    `const own = await tools.read({ path: ${JSON.stringify(kept)} });`,
    "text('own read: ' + JSON.stringify(own).includes('x'.repeat(400)));",
    'try {',
    `  await tools.read({ path: ${JSON.stringify(path.join(harness.config.paths.resourcesDir, other.id))} });`,
    '} catch (error) {',
    "  text('other refused: ' + error.message);",
    '}',
  ].join('\n');
  const { session, manager } = await openSession(script, taskId);
  const prompting = session.prompt('Read both files.');
  const asked = await answerConfirm(harness.service.confirms, 'declined');
  await prompting;
  session.dispose();

  assert.equal(asked.toolCallId, 'call-1/2', "only the other task's resource asks");
  assert.deepEqual(asked.kind === 'confirmation' && asked.scope, {
    tool: 'read',
    location: 'outside',
  });
  const read = codemodeBlock(manager)?.output ?? '';
  assert.match(read, /own read: true/);
  assert.match(read, /other refused: The user declined this action\./);
  assert.equal(harness.service.confirms.pending().length, 0);
});
