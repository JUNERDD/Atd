import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai';
import type { Logger } from '../dist/logging.js';
import { consolidate } from '../dist/memory/consolidation/job.js';
import type { ConsolidationRequest } from '../dist/memory/consolidation/types.js';
import { openMemory, rootScope, unitInput } from './memory-store-kit.ts';

/**
 * The memory consolidation job over a real memory authority and a fake model: its gates, how its
 * operations land (direct rewrites with history, suggestions for removals and for the person's own
 * memories), the fingerprint that spares a model call, and abort.
 */

type Kit = Awaited<ReturnType<typeof openMemory>>;

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

function reply(text: string, stopReason: AssistantMessage['stopReason'] = 'stop') {
  const message: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
  return message;
}

const quiet: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * A consolidation over `kit` whose model answers `answer` (an object is sent as JSON); `during`
 * runs while the model works, `unavailable` makes no model available.
 */
function job(
  kit: Kit,
  answer: unknown,
  options: { during?: (signal: AbortSignal) => Promise<void>; unavailable?: boolean } = {},
) {
  const calls: Context[] = [];
  const models = {
    completeSimple: async (
      _model: Model<Api>,
      context: Context,
      settings?: { signal?: AbortSignal },
    ) => {
      calls.push(context);
      await options.during?.(settings?.signal ?? new AbortController().signal);
      if (settings?.signal?.aborted) return reply('', 'aborted');
      return reply(typeof answer === 'string' ? answer : JSON.stringify(answer));
    },
  };
  const deps = {
    agentDir: kit.agentDir,
    authority: async () => kit.memory,
    openModel: async () => (options.unavailable ? { unavailable: 'No model.' } : { models, model }),
    log: quiet,
  };
  const run = (signal = new AbortController().signal) => {
    const request: ConsolidationRequest = {
      signal,
      automationId: 'auto-1',
      automationRunId: 'r-1',
    };
    return consolidate(deps, request);
  };
  return { run, calls };
}

/** Two learned memories (via a learner commit) and one the person wrote. */
async function seed(kit: Kit) {
  const learned = await kit.memory.commitLearned(
    [
      {
        op: 'create',
        name: 'reply-language',
        description: 'Reply language',
        type: 'memory',
        body: 'Reply in Chinese.',
      },
      {
        op: 'create',
        name: 'chat-language',
        description: 'Chat language',
        type: 'memory',
        body: 'Chat in Chinese.',
      },
    ],
    rootScope(),
    kit.memory.currentPolicyVersion(),
    'idle',
    new Set(),
  );
  assert.equal(learned.applied, 2);
  const { unit: own } = await kit.memory.create(
    unitInput('Editor', 'Uses Vim.', 'memory', { name: 'editor' }),
  );
  return own;
}

const unitNamed = async (kit: Kit, name: string) =>
  (await kit.memory.units()).find((unit) => unit.name === name);

test('paused learning and too little memory end without a model call', async () => {
  const kit = await openMemory();
  try {
    const { run, calls } = job(kit, { summary: '', operations: [] });
    await kit.memory.create(unitInput('Editor', 'Uses Vim.', 'memory', { name: 'editor' }));
    await kit.memory.create(
      unitInput('Name', 'Called Sam.', 'user', { name: 'name', activation: 'core' }),
    );
    assert.deepEqual(await run(), { outcome: 'nothingNew' }, 'a core unit is never a target');
    await kit.memory.setSettings({ paused: true });
    await kit.memory.create(unitInput('Shell', 'Uses zsh.', 'memory', { name: 'shell' }));
    assert.deepEqual(await run(), { outcome: 'skipped', reason: 'memoryPaused' });
    assert.equal(calls.length, 0);
  } finally {
    await kit.close();
  }
});

test('a merge rewrites learned memory directly and suggests removals and edits of own memory', async () => {
  const kit = await openMemory();
  try {
    const own = await seed(kit);
    const before = await unitNamed(kit, 'reply-language');
    const changes = kit.changes();
    const { run, calls } = job(kit, {
      summary: '合并了两条语言偏好。',
      operations: [
        { op: 'update', name: 'reply-language', body: 'Reply and chat in Chinese.' },
        { op: 'remove', name: 'chat-language', reason: 'reply-language covers it.' },
        { op: 'update', name: 'editor', body: 'Uses Vim with vim-surround.' },
        { op: 'create', type: 'memory', description: 'New', body: 'Not allowed.' },
      ],
    });
    const result = await run();
    assert.deepEqual(result, {
      outcome: 'delivered',
      summary: '合并了两条语言偏好。',
      applied: 1,
      proposed: 2,
    });
    assert.equal(calls.length, 1);
    const prompt = calls[0]?.messages[0];
    assert.equal(prompt?.role, 'user');
    assert.match(
      typeof prompt.content === 'string' ? prompt.content : '',
      /source="learned" reviewed="false"/,
    );

    const merged = await unitNamed(kit, 'reply-language');
    assert.equal(merged?.body, 'Reply and chat in Chinese.');
    assert.deepEqual([merged?.source, merged?.reviewed], ['learned', false]);
    assert.deepEqual(merged?.origin, before?.origin, 'the origin stays the learner task');
    const history = await readdir(path.join(kit.root, 'history', merged?.id ?? ''));
    assert.equal(history.length, 1, 'the replaced version is kept');

    assert.equal((await unitNamed(kit, 'editor'))?.body, own.body, 'the person’s edit wins');
    assert.equal((await unitNamed(kit, 'chat-language'))?.enabled, true, 'removal waits');
    const { proposals } = await kit.memory.state();
    assert.deepEqual(
      proposals.map((item) => [item.kind, item.name, item.origin]),
      [
        ['remove', 'chat-language', null],
        ['update', 'editor', null],
      ],
    );
    assert.equal(proposals[1]?.body, 'Uses Vim with vim-surround.');
    assert.ok(kit.changes() > changes, 'listeners hear about the change');
  } finally {
    await kit.close();
  }
});

test('unchanged memory is not consolidated twice, but a content change is', async () => {
  const kit = await openMemory();
  try {
    await seed(kit);
    const { run, calls } = job(kit, { summary: '', operations: [] });
    assert.deepEqual(await run(), { outcome: 'nothingNew' });
    assert.deepEqual(await run(), { outcome: 'nothingNew' });
    assert.equal(calls.length, 1, 'a reply with nothing to do is remembered');
    const learned = await unitNamed(kit, 'reply-language');
    await kit.memory.markReviewed(learned?.id ?? '');
    await run();
    assert.equal(calls.length, 1, 'the review flag is no content change');
    await kit.memory.create(unitInput('Shell', 'Uses zsh.', 'memory', { name: 'shell' }));
    await run();
    assert.equal(calls.length, 2);
  } finally {
    await kit.close();
  }
});

test('a write during the model call makes the commit refuse', async () => {
  const kit = await openMemory();
  try {
    await seed(kit);
    const { run } = job(
      kit,
      { summary: 'x', operations: [{ op: 'update', name: 'reply-language', body: 'Changed.' }] },
      {
        during: async () => {
          await kit.memory.create(unitInput('Shell', 'Uses zsh.', 'memory', { name: 'shell' }));
        },
      },
    );
    const result = await run();
    assert.equal(result.outcome, 'failed');
    assert.equal((await unitNamed(kit, 'reply-language'))?.body, 'Reply in Chinese.');
  } finally {
    await kit.close();
  }
});

test('failures resolve as failed, and an abort rejects without writing', async () => {
  const kit = await openMemory();
  try {
    await seed(kit);
    const unavailable = await job(kit, '', { unavailable: true }).run();
    assert.deepEqual(unavailable, {
      outcome: 'failed',
      reason: 'modelUnavailable',
      detail: 'No model.',
    });
    const prose = await job(kit, 'Nothing to change here.').run();
    assert.equal(prose.outcome === 'failed' && prose.reason, 'runFailed');
    const unknownName = await job(kit, {
      summary: 'x',
      operations: [{ op: 'remove', name: 'missing', reason: 'gone' }],
    }).run();
    assert.equal(unknownName.outcome, 'failed', 'only operations that cannot apply');

    const controller = new AbortController();
    const aborting = job(
      kit,
      { summary: 'x', operations: [{ op: 'remove', name: 'chat-language', reason: 'dup' }] },
      { during: async () => controller.abort(new Error('stopped')) },
    );
    await assert.rejects(aborting.run(controller.signal), /stopped/);
    assert.equal((await kit.memory.state()).proposals.length, 0);
  } finally {
    await kit.close();
  }
});
