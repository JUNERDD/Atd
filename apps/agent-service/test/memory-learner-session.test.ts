import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Api, AssistantMessage, Context, Model, UserMessage } from '@earendil-works/pi-ai';
import type { ExtensionAPI, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { Logger } from '../dist/logging.js';
import type { LearnerOp, MemoryRunScope, MemoryRuntimeStore } from '../dist/memory/engine-types.js';
import { memoryLearner } from '../dist/memory/learner/index.js';
import { LEARNER_SYSTEM_PROMPT } from '../dist/memory/learner/prompts.js';

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
const CREATE = {
  op: 'create',
  type: 'memory',
  description: 'Writes reports in Chinese',
  body: 'Write reports in Simplified Chinese.',
};

function reply(
  text: string,
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
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
const base = () => ({
  id: `e${(ids += 1)}`,
  parentId: null,
  timestamp: '2026-10-04T00:00:00.000Z',
});

/** A held model reply the test releases, to observe a review while it waits on the model. */
function hold() {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { released, release };
}

/** One root session with the learner installed over fakes: pi, the store and the run's model. */
function session(overrides: { learn?: boolean; store?: MemoryRuntimeStore } = {}) {
  const handlers = new Map<string, Handler[]>();
  const on = (name: string, handler: Handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    return () => undefined;
  };
  const pi: ExtensionAPI = new Proxy(Object.create(null), {
    get: (_target, key) => (key === 'on' ? on : () => undefined),
  });
  const branch: SessionEntry[] = [];
  const ctx = { sessionManager: { getBranch: () => branch } };
  const calls: { context: Context; options: Options | undefined }[] = [];
  const holds: ReturnType<typeof hold>[] = [];
  const warnings: string[] = [];
  const state = {
    learn: overrides.learn ?? true,
    version: 41,
    answer: JSON.stringify({ operations: [CREATE] }),
    committing: 0,
    mostCommitting: 0,
  };
  const commits: {
    ops: readonly LearnerOp[];
    scope: MemoryRunScope;
    version: number;
    trigger: string;
  }[] = [];
  const unused = () => Promise.reject(new Error('not used by learners'));
  const store: MemoryRuntimeStore = overrides.store ?? {
    canRead: () => true,
    canLearn: (scope) => state.learn && scope.runMemory && scope.executionId.startsWith('root:'),
    currentPolicyVersion: () => state.version,
    enabledUnits: async () => [],
    search: async () => [],
    readByName: async () => null,
    addFromTool: unused,
    replaceFromTool: unused,
    removeFromTool: unused,
    commitLearned: async (ops, scope, version, trigger) => {
      state.committing += 1;
      state.mostCommitting = Math.max(state.mostCommitting, state.committing);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.committing -= 1;
      commits.push({ ops, scope, version, trigger });
      return { applied: ops.length, proposed: 0, skipped: [] };
    },
  };
  const models = {
    completeSimple: async (_model: Model<Api>, context: Context, options?: Options) => {
      calls.push({ context, options });
      await holds[calls.length - 1]?.released;
      return state.answer === 'ERROR' ? reply('', 'error') : reply(state.answer);
    },
  };
  const scope = { runMemory: true, executionId: 'root:run-1', taskId: 'task-1', runId: 'run-1' };
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message) => void warnings.push(message),
    error: () => {},
  };
  void memoryLearner({
    store,
    scope: () => scope,
    source: () => ({ models, model, branch: () => branch }),
    log,
  })(pi);
  const emit = async (name: string, event: object = {}) => {
    for (const handler of handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx);
  };
  return {
    store,
    branch,
    calls,
    commits,
    state,
    warnings,
    emit,
    /** Holds the model's next reply until the test releases it. */
    holdNext: () => {
      const held = hold();
      holds[calls.length] = held;
      return held;
    },
    invocation: (source: 'user' | 'command') =>
      branch.push({
        ...base(),
        type: 'custom',
        customType: 'app-invocation',
        data: { runId: 'r', source },
      }),
    say: async (text: string) => {
      const message: UserMessage = { role: 'user', content: text, timestamp: 0 };
      branch.push({ ...base(), type: 'message', message });
      await emit('message_end', { message });
    },
    turn: async (text: string, toolCalls = 0) => {
      const message = reply(text);
      for (let index = 0; index < toolCalls; index += 1)
        message.content.unshift({ type: 'toolCall', id: `t${index}`, name: 'read', arguments: {} });
      branch.push({ ...base(), type: 'message', message });
      await emit('turn_end', { message, toolResults: [] });
    },
  };
}

/** The prompt a review sent: one user message with text content. */
function promptOf(call: { context: Context } | undefined): string {
  const message = call?.context.messages[0];
  assert.ok(message?.role === 'user' && typeof message.content === 'string', 'one text prompt');
  return message.content;
}

/** Lets background reviews run until `done` holds, for up to two seconds. */
async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(done(), 'the condition never held');
}

test('a correction is reviewed on the run model and commits with the version read at its start', async () => {
  const s = session();
  await s.say('Write the weekly report.');
  await s.turn('Here is the report in English.');
  const held = s.holdNext();
  await s.say('不对，报告要用中文写');
  await s.turn('好的，我改成中文。');
  await until(() => s.calls.length === 1);
  s.state.version = 42;
  held.release();
  await until(() => s.commits.length === 1);
  const [commit] = s.commits;
  assert.equal(commit?.version, 41);
  assert.equal(commit?.trigger, 'correction');
  assert.deepEqual(commit?.ops, [CREATE]);
  assert.deepEqual(commit?.scope, {
    runMemory: true,
    executionId: 'root:run-1',
    taskId: 'task-1',
    runId: 'run-1',
  });
  const call = s.calls[0];
  assert.equal(call?.context.systemPrompt, LEARNER_SYSTEM_PROMPT);
  const prompt = promptOf(call);
  assert.match(prompt, /^Today is \d{4}-\d{2}-\d{2}\./);
  assert.match(prompt, /<correction>\n不对，报告要用中文写\n<\/correction>/);
  assert.ok(prompt.includes('Write the weekly report.') && prompt.includes('好的，我改成中文。'));
  assert.match(call?.options?.sessionId ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(call?.options?.maxTokens, 4096);
  assert.ok(call?.options?.signal instanceof AbortSignal);
});

test('one review at a time: periodic triggers are dropped, a correction waits and runs next', async () => {
  const s = session();
  await s.say('Build the site.');
  await s.say('Use Astro for it.');
  const held = s.holdNext();
  for (let turn = 0; turn < 10; turn += 1) await s.turn('Working.');
  await until(() => s.calls.length === 1);
  for (let turn = 0; turn < 12; turn += 1) await s.turn('Still working.', 2);
  await s.emit('agent_settled');
  await s.say('No, use the existing layout.');
  await s.turn('Switching to the existing layout.');
  assert.equal(s.calls.length, 1);
  held.release();
  await until(() => s.commits.length === 2);
  assert.deepEqual(
    s.commits.map((commit) => commit.trigger),
    ['cadence', 'correction'],
  );
  assert.equal(s.calls.length, 2);
});

test('an idle session is reviewed once two user messages are new, and no sooner', async () => {
  const s = session();
  await s.say('Summarize the meeting notes.');
  await s.turn('Summary ready.');
  await s.emit('agent_settled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.calls.length, 0);
  await s.say('Keep summaries under five bullet points from now on.');
  await s.turn('Understood.');
  await s.emit('agent_settled');
  await until(() => s.commits.length === 1);
  assert.equal(s.commits[0]?.trigger, 'idle');
  await s.emit('agent_settled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.calls.length, 1);
});

test('command runs feed no trigger and no review', async () => {
  const s = session();
  s.invocation('command');
  await s.say('No, use the template exactly as written.');
  await s.turn('Applied the template.');
  await s.say('Second templated message.');
  await s.emit('agent_settled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.calls.length, 0);
  s.invocation('user');
  await s.say('Reply in English from now on.');
  await s.say('And keep answers short.');
  await s.emit('agent_settled');
  await until(() => s.commits.length === 1);
  const prompt = promptOf(s.calls[0]);
  assert.ok(prompt.includes('Reply in English from now on.'));
  assert.ok(!prompt.includes('template'));
});

test('nothing is reviewed while learning is paused', async () => {
  const s = session({ learn: false });
  await s.say('Stop! Remove that file.');
  await s.turn('Removed.');
  await s.say('Another message.');
  await s.emit('agent_settled');
  await s.emit('session_shutdown', { reason: 'quit' });
  assert.equal(s.calls.length, 0);
});

test('a failed model call is logged and commits nothing', async () => {
  const s = session();
  s.state.answer = 'ERROR';
  await s.say("Don't do that again.");
  await s.turn('Sorry.');
  await until(() => s.warnings.length === 1);
  assert.deepEqual(s.warnings, ['A memory review failed; the task is unaffected.']);
  assert.equal(s.commits.length, 0);
});

test('a closing session waits for its review; a compaction does not', async () => {
  const closing = session();
  await closing.say('Use tabs in this repository.');
  await closing.say('And two-space YAML.');
  await closing.emit('session_shutdown', { reason: 'quit' });
  assert.deepEqual(
    closing.commits.map((commit) => commit.trigger),
    ['shutdown'],
  );

  const compacting = session();
  await compacting.say('Prefer short commit messages.');
  const held = compacting.holdNext();
  await compacting.emit('session_before_compact', { reason: 'threshold' });
  await until(() => compacting.calls.length === 1);
  assert.equal(compacting.commits.length, 0);
  held.release();
  await until(() => compacting.commits.length === 1);
  assert.equal(compacting.commits[0]?.trigger, 'compaction');
});

test('commits from different sessions on one store apply one at a time', async () => {
  const first = session();
  const sessions = [first, session({ store: first.store })];
  for (const s of sessions) {
    await s.say('I said use pnpm.');
    await s.turn('Using pnpm.');
  }
  await Promise.all(sessions.map((s) => s.emit('session_shutdown', { reason: 'quit' })));
  assert.equal(first.commits.length, 2);
  assert.equal(first.state.mostCommitting, 1);
  assert.deepEqual(
    sessions.map((s) => s.calls.length),
    [1, 1],
  );
});
