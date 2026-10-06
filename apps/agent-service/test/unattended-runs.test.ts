import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { SessionManager, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PermissionTier, RunTrigger } from '@atd/agent-contracts';
import { registerMcpCatalogTools } from '../dist/configure-mcp-tool.js';
import { registerDesktopTool } from '../dist/desktop-tool.js';
import { askUserExtension } from '../dist/harness/ask-user.js';
import type { ReviewRequest } from '../dist/harness/auto-review.js';
import { createGate, type GateHost } from '../dist/harness/gate.js';
import { McpApprovalBroker } from '../dist/mcp/approval.js';
import { McpError } from '../dist/mcp/errors.js';
import { mcpPreapproval } from '../dist/pi-session-mcp.js';
import {
  isUnattendedRun,
  UNATTENDED_ANSWER,
  UNATTENDED_DECLINED,
  UNATTENDED_DESKTOP,
  UNATTENDED_MCP_CONFIG,
} from '../dist/unattended.js';
import { task } from './fixtures.ts';
import { piStandIn } from './mcp-kit.ts';
import { startTestService } from './service-harness.ts';

/**
 * Unattended runs (unattended.ts): a run an automation started raises no confirm and no question.
 * The gate declines what the tier would ask, `ask_user` answers that nobody is there, the desktop
 * and `configure_mcp` tools refuse, and a guarded MCP call is refused. Each writes one audit line
 * with `decision: 'unattended'`, which the automation engine counts.
 */

let harness: Awaited<ReturnType<typeof startTestService>>;
before(async () => {
  harness = await startTestService();
});
after(() => harness.stop());

const TRIGGER: RunTrigger = {
  kind: 'automation',
  automationId: 'morning-digest',
  automationRunId: 'fire-1',
  source: 'schedule',
  firedAt: '2026-10-06T08:00:00.000Z',
};

type Audit = Record<string, unknown>;

/** A registered tool as these tests call it. */
interface RegisteredTool {
  name: string;
  execute(id: string, args: unknown): Promise<unknown>;
}

/** A pi stand-in that keeps the tools registered on it. */
function capture() {
  const tools = new Map<string, RegisteredTool>();
  const pi = piStandIn<ExtensionAPI>({
    registerTool: (tool: RegisteredTool) => void tools.set(tool.name, tool),
  });
  const tool = (name: string) => {
    const found = tools.get(name);
    assert.ok(found, `${name} is registered`);
    return found;
  };
  return { pi, tool };
}

/** A task in the service ledger whose running run an automation started, or a person when null. */
async function runningTask(trigger: RunTrigger | null) {
  const fixture = task('running');
  const [run] = fixture.runs;
  assert.ok(run);
  if (trigger) run.snapshot.trigger = trigger;
  await harness.service.ledger.change((data) => {
    data.tasks.unshift(fixture);
  });
  return { taskId: fixture.id, runId: run.id };
}

const unattended = (audits: Audit[]) => audits.filter((entry) => entry.decision === 'unattended');

test('the gate declines at once what it would ask, without a confirm', async () => {
  const run = await runningTask(TRIGGER);
  const audits: Audit[] = [];
  const sessions = SessionManager.inMemory();
  const reviews: ReviewRequest[] = [];
  let verdict: 'allow' | 'ask' = 'ask';
  const gate = (tier: PermissionTier, ids = run) => {
    const host: GateHost = {
      taskId: ids.taskId,
      runId: () => ids.runId,
      executionId: () => `root:${ids.runId}`,
      tier,
      grants: new Set<string>(),
      sessions,
      confirms: harness.service.confirms,
      review: async (request) => {
        reviews.push(request);
        return { decision: verdict, reason: 'Checked.' };
      },
      unattended: () => isUnattendedRun(harness.service.ledger, ids.taskId, ids.runId),
      audit: (entry) => void audits.push(entry),
      setStatus: () => undefined,
    };
    return createGate(host);
  };
  const call = (toolCallId: string) => ({
    toolCallId,
    scope: { tool: 'bash' as const },
    title: 'bash: rm -rf build',
    detail: 'rm -rf build',
  });

  await assert.rejects(gate('manual')(call('call-1')), { message: UNATTENDED_DECLINED });
  assert.deepEqual(harness.service.confirms.pending(), [], 'nothing was asked');
  assert.deepEqual(unattended(audits), [
    {
      taskId: run.taskId,
      runId: run.runId,
      executionId: `root:${run.runId}`,
      tool: 'bash',
      toolCallId: 'call-1',
      kind: 'confirm',
      title: 'bash: rm -rf build',
      decision: 'unattended',
    },
  ]);
  const recorded = sessions
    .getEntries()
    .flatMap((entry) => (entry.type === 'custom' ? [entry.data] : []));
  assert.deepEqual(
    recorded.map((data) => (data as { outcome?: unknown }).outcome),
    ['declined'],
    'the transcript shows the call as declined',
  );

  // Under `auto` the review still runs, told that the run is unattended: a flagged call is
  // declined, an allowed one runs. `askAlways` skips the tier, so even `always` declines it.
  await assert.rejects(gate('auto')(call('call-2')), { message: UNATTENDED_DECLINED });
  verdict = 'allow';
  assert.equal(await gate('auto')(call('call-3')), 'reviewed');
  assert.deepEqual(
    reviews.map((request) => request.unattended),
    [true, true],
  );
  await assert.rejects(gate('always')({ ...call('call-4'), askAlways: true }), {
    message: UNATTENDED_DECLINED,
  });
  assert.equal(unattended(audits).length, 3);
  assert.deepEqual(harness.service.confirms.pending(), []);

  // A person's run of the same kind still asks.
  const attended = await runningTask(null);
  const asking = gate('manual', attended)(call('call-5'));
  for (let tries = 0; harness.service.confirms.pending().length === 0; tries += 1) {
    assert.ok(tries < 200, 'the confirm was raised');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const [raised] = harness.service.confirms.pending();
  assert.ok(raised);
  await harness.service.confirms.reply(raised.id, raised.revision, { decision: 'declined' });
  await assert.rejects(asking, { message: 'The user declined this action.' });
  assert.equal(unattended(audits).length, 3);
});

test('ask_user answers at once that nobody is available, and records no answer', async () => {
  const run = await runningTask(TRIGGER);
  const audits: Audit[] = [];
  const sessions = SessionManager.inMemory();
  const { pi, tool } = capture();
  await askUserExtension({
    sessions,
    reproject: () => undefined,
    runner: {
      taskId: run.taskId,
      currentRunId: () => run.runId,
      executionId: () => `root:${run.runId}`,
      audit: (entry) => void audits.push(entry),
      setStatus: () => assert.fail('an unattended question never waits'),
      ctx: { ledger: harness.service.ledger, confirms: harness.service.confirms },
    },
  })(pi);

  const result = await tool('ask_user').execute('call-1', { question: 'Which format?' });
  assert.deepEqual(result, { content: [{ type: 'text', text: UNATTENDED_ANSWER }], details: {} });
  assert.deepEqual(harness.service.confirms.pending(), []);
  assert.deepEqual(unattended(audits), [
    {
      taskId: run.taskId,
      runId: run.runId,
      tool: 'ask_user',
      kind: 'question',
      title: 'Which format?',
      decision: 'unattended',
    },
  ]);
  const questions = sessions
    .getEntries()
    .flatMap((entry) =>
      entry.type === 'custom' && entry.customType === 'app-question' ? [entry.data] : [],
    );
  assert.deepEqual(
    questions.map((data) => (data as { answer?: unknown }).answer),
    [null],
    'the transcript shows the question unanswered',
  );
});

test('the desktop and configure_mcp tools refuse in an unattended run', async () => {
  const audits: Audit[] = [];
  const { pi, tool } = capture();
  const host = {
    taskId: 'task-1',
    runId: () => 'run-1',
    executionId: () => 'root:run-1',
    capabilities: harness.service.capabilities,
    unattended: () => true,
    audit: (entry: Audit) => void audits.push(entry),
    dataDir: harness.config.paths.root,
    upsertMcp: async () => assert.fail('nothing is saved'),
  };
  registerDesktopTool(pi, host);
  registerMcpCatalogTools(pi, host);

  const desktop = await tool('desktop').execute('call-1', {
    capability: 'clipboard.write',
    input: { text: 'overwritten' },
  });
  assert.deepEqual(desktop, {
    content: [{ type: 'text', text: UNATTENDED_DESKTOP }],
    details: {},
    isError: true,
  });
  const draft = { serverId: 'github', transport: 'stdio', command: 'npx', auth: { type: 'none' } };
  await assert.rejects(tool('configure_mcp').execute('call-2', draft), {
    message: UNATTENDED_MCP_CONFIG,
  });
  assert.deepEqual(
    unattended(audits).map(({ kind, title }) => [kind, title]),
    [
      ['desktop', 'desktop:clipboard.write'],
      ['mcpConfig', 'Configure MCP server github'],
    ],
  );
});

test("a guarded MCP call of an unattended run is refused, counted in the run's audit", async () => {
  const run = await runningTask(TRIGGER);
  const person = await runningTask(null);
  const lines: Audit[] = [];
  const reviews: ReviewRequest[] = [];
  const preapprove = (tier: PermissionTier, ids = run) =>
    mcpPreapproval(
      {
        taskId: ids.taskId,
        ctx: { ledger: harness.service.ledger },
        review: async (request) => {
          reviews.push(request);
          return { decision: 'ask', reason: 'Deletes a repository.' };
        },
        audit: (entry) => void lines.push(entry),
      },
      { runId: () => ids.runId, executionId: () => `root:${ids.runId}`, tier },
    )({ toolCallId: 'call-1', serverId: 'srv', tool: 'delete_repo', args: {} });
  assert.deepEqual(await preapprove('manual'), { allowed: false, unattended: true });
  assert.deepEqual(await preapprove('auto'), { allowed: false, unattended: true });
  assert.deepEqual(await preapprove('always'), { allowed: true });
  assert.deepEqual(await preapprove('manual', person), { allowed: false });
  assert.deepEqual(
    reviews.map((request) => request.unattended),
    [true],
  );
  assert.deepEqual(
    unattended(lines).map(({ runId, kind, title }) => [runId, kind, title]),
    [
      [run.runId, 'confirm', 'MCP srv / delete_repo'],
      [run.runId, 'confirm', 'MCP srv / delete_repo'],
    ],
  );

  const audits: Audit[] = [];
  const broker = new McpApprovalBroker(
    harness.service.confirms,
    (entry) => void audits.push(entry),
    harness.service.log,
  );
  await assert.rejects(
    broker.decide({
      taskId: 'task-1',
      runId: 'run-1',
      executionId: 'root:run-1',
      toolCallId: 'call-1',
      serverId: 'srv',
      connectionId: 'connection-1',
      toolName: 'delete_repo',
      origin: 'facade',
      args: {},
      unattended: true,
    }),
    (error: unknown) =>
      error instanceof McpError &&
      error.code === 'forbidden' &&
      /Nobody is present to approve MCP tool delete_repo on srv/.test(error.message) &&
      // The proxy would report a "declined" call as the person's own decision.
      !/declined/i.test(error.message),
  );
  assert.deepEqual(harness.service.confirms.pending(), []);
  // The authority's shared audit records a plain deny; the run's audit counted the refusal above.
  assert.deepEqual(
    audits.map(({ decision, reason }) => [decision, reason]),
    [['deny', 'unattended']],
  );
});
