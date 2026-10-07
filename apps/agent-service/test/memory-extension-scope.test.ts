import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Api, AssistantMessage, Context, Model, UserMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, SessionEntry, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { memoryExtension } from '../dist/harness/memory-extension.js';
import type { Logger } from '../dist/logging.js';
import { MemoryAuthority } from '../dist/memory/engine.js';
import { NO_RUN_MATERIAL } from '../dist/pi-session.js';
import { task } from './fixtures.ts';

/**
 * The scope a root session's memory tools and learner share (harness/memory-extension.ts): the
 * run the session last served, and memory off once its task is deleted. The extension runs over a
 * fake pi and a fake model, on the real memory store in a temporary agent dir.
 */

type Handler = (event: unknown, ctx: unknown) => unknown;
type Options = { maxTokens?: number; sessionId?: string; signal?: AbortSignal };

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test',
  api: 'openai-completions',
  provider: 'test',
  baseUrl: 'http://127.0.0.1:9',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 32_000,
};
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const LEARNED = JSON.stringify({
  operations: [
    {
      op: 'create',
      type: 'memory',
      description: 'Indents YAML with two spaces',
      body: 'Indent YAML files with two spaces.',
    },
  ],
});

function reply(text: string, stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: 0,
  };
}

let ids = 0;

/** A root session built for run-1 of task-1, with memory on, and what the test drives it with. */
async function memorySession() {
  const agentDir = await mkdtemp(path.join(tmpdir(), 'memory-scope-'));
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, ToolDefinition>();
  const on = (name: string, handler: Handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    return () => undefined;
  };
  const registerTool = (tool: ToolDefinition) => void tools.set(tool.name, tool);
  const pi: ExtensionAPI = new Proxy(Object.create(null), {
    get: (_target, key) => (key === 'on' ? on : key === 'registerTool' ? registerTool : () => {}),
  });
  const state = { runId: 'run-1', deleted: false };
  const branch: SessionEntry[] = [];
  const calls: (Options | undefined)[] = [];
  const committed: Record<string, unknown>[] = [];
  let held = Promise.resolve();
  const models = {
    completeSimple: async (_model: Model<Api>, _context: Context, options?: Options) => {
      calls.push(options);
      // Like a provider's, a held reply ends as soon as its review is aborted.
      const { signal } = options ?? {};
      await Promise.race([
        held,
        new Promise((resolve) => signal?.addEventListener('abort', resolve)),
      ]);
      return signal?.aborted ? reply('', 'aborted') : reply(LEARNED, 'stop');
    },
  };
  const log: Logger = {
    debug: () => {},
    info: (message, fields) => {
      if (message === 'A memory review committed.') committed.push(fields ?? {});
    },
    warn: () => {},
    error: () => {},
  };
  const [fixture] = task('completed').runs;
  assert.ok(fixture);
  const factory = await memoryExtension({
    run: { ...fixture, id: 'run-1', snapshot: { ...fixture.snapshot, memory: true } },
    source: () => ({ models, model, branch: () => branch }),
    runner: {
      taskId: 'task-1',
      currentRunId: () => state.runId,
      currentMaterial: () => NO_RUN_MATERIAL,
      deleted: () => state.deleted,
      ctx: { paths: { agentDir }, log },
    },
  });
  assert.ok(factory, 'memory is on');
  await factory(pi);
  // The same authority the extension opened; the events only apply to a new one.
  const memory = await MemoryAuthority.authorityFor(agentDir, {
    notify: () => {},
    changed: () => {},
  });
  const ctx = { sessionManager: { getBranch: () => branch } };
  const emit = async (name: string, event: object = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  return {
    state,
    calls,
    committed,
    emit,
    units: () => memory.units(),
    /** Holds the model's replies until the returned function releases them. */
    hold: () => {
      let release: () => void = () => {};
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    say: async (text: string) => {
      const message: UserMessage = { role: 'user', content: text, timestamp: 0 };
      branch.push({
        id: `e${(ids += 1)}`,
        parentId: null,
        timestamp: '',
        type: 'message',
        message,
      });
      await emit('message_end', { message });
    },
    /** memory_add as the model would call it during the current run. */
    add: async (description: string, body: string) => {
      const tool = tools.get('memory_add');
      assert.ok(tool, 'memory_add is registered');
      const params = { type: 'memory', description, body };
      await tool.execute(`call-${(ids += 1)}`, params, undefined, undefined, Object.create(null));
    },
    close: async () => {
      memory.close();
      await rm(agentDir, { recursive: true, force: true });
    },
  };
}

/** Lets background reviews run until `done` holds, for up to two seconds. */
async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(done(), 'the condition never held');
}

test('a tool call records its run, and a later shutdown review the run its session served', async () => {
  const s = await memorySession();
  try {
    // Run 2 reuses the session: its agent loop starts there, so its tool call records run 2.
    s.state.runId = 'run-2';
    await s.emit('agent_start');
    await s.say('Indent YAML with two spaces.');
    await s.say('Keep that in every repository.');
    await s.add('Prefers tabs in code', 'Indent code with tabs.');
    // Run 3 needs another session (a binding change), so this one closes without serving it.
    s.state.runId = 'run-3';
    await s.emit('session_shutdown', { reason: 'new' });
    const units = await s.units();
    const runOf = (trigger: string) =>
      units.find((unit) => unit.origin?.trigger === trigger)?.origin?.runId;
    assert.equal(units.length, 2);
    assert.equal(runOf('memory_add'), 'run-2');
    assert.equal(runOf('shutdown'), 'run-2');
  } finally {
    await s.close();
  }
});

test("a deleted task's session aborts its running review at once and starts no other", async () => {
  const s = await memorySession();
  try {
    await s.say('Use tabs in this repository.');
    await s.say('And two-space YAML.');
    const release = s.hold();
    await s.emit('agent_settled');
    await until(() => s.calls.length === 1);
    // Enough new messages that a closing session would otherwise review them once more.
    await s.say('Wrap lines at 100 characters.');
    await s.say('Sort the imports.');
    s.state.deleted = true;
    const before = Date.now();
    await s.emit('session_shutdown', { reason: 'quit' });
    assert.ok(Date.now() - before < 1000, 'no capped wait');
    assert.equal(s.calls[0]?.signal?.aborted, true);
    assert.equal(s.calls.length, 1, 'no shutdown review');
    release();
    assert.deepEqual(await s.units(), []);
  } finally {
    await s.close();
  }
});

test("a review that outlives its task's deletion commits nothing", async () => {
  const s = await memorySession();
  try {
    await s.say('Use tabs in this repository.');
    await s.say('And two-space YAML.');
    const release = s.hold();
    await s.emit('agent_settled');
    await until(() => s.calls.length === 1);
    s.state.deleted = true;
    release();
    await until(() => s.committed.length === 1);
    assert.deepEqual(
      { applied: s.committed[0]?.applied, proposed: s.committed[0]?.proposed },
      { applied: 0, proposed: 0 },
    );
    assert.deepEqual(await s.units(), []);
  } finally {
    await s.close();
  }
});
