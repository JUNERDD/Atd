import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_OPS, parseLearnerReply, replyChannel } from '../dist/memory/learner/ops.js';
import { LEARNER_SYSTEM_PROMPT } from '../dist/memory/learner/prompts.js';

const create = {
  op: 'create',
  type: 'memory',
  description: 'Uses pnpm for every JavaScript project',
  body: 'Run pnpm, never npm or yarn.',
};
const update = { op: 'update', name: 'package-manager', body: 'Use pnpm 12.' };
const answer = (operations: unknown[]) => JSON.stringify({ operations });
const text = (reply: string) => parseLearnerReply({ text: reply, source: 'text' });
const thinking = (reply: string) => parseLearnerReply({ text: reply, source: 'thinking' });

test('a bare JSON answer parses into operations', () => {
  assert.deepEqual(text(answer([create])), { ops: [create], dropped: [] });
  assert.deepEqual(text('{"operations":[]}'), { ops: [], dropped: [] });
});

test('a fenced answer inside prose parses', () => {
  const reply = `Here is what to remember:\n\`\`\`json\n${answer([create])}\n\`\`\`\nThat is all.`;
  assert.deepEqual(text(reply)?.ops, [create]);
});

test('an inline answer inside prose parses', () => {
  assert.deepEqual(text(`Sure. ${answer([update])} Done.`)?.ops, [update]);
});

test('the trailing answer wins over a restated schema and a stray object', () => {
  const reply = [
    'The schema is {"operations": [ /* objects */ ]} and a log line said {"level":"info"}.',
    `Final answer: ${answer([create])}`,
  ].join('\n');
  assert.deepEqual(text(reply)?.ops, [create]);
});

test('a reply without an operations payload is null', () => {
  assert.equal(text('Nothing worth remembering here.'), null);
  assert.equal(text('{"result":"none"}'), null);
  assert.equal(text('{"operations": "none"}'), null);
  assert.equal(text('{ broken json'), null);
  assert.equal(text('   '), null);
});

test('a trailing payload in reasoning keeps every operation', () => {
  const reply = `Let me think. Restating: {"operations": [ /* objects */ ]}\n${answer([create, update])}`;
  assert.deepEqual(thinking(reply)?.ops, [create, update]);
});

test('a draft payload in reasoning keeps only its creates', () => {
  const reply = `Draft: ${answer([create, update])}\nOn reflection the update is wrong, so the final answer follows.`;
  const parsed = thinking(reply);
  assert.deepEqual(parsed?.ops, [create]);
  assert.deepEqual(parsed?.dropped, ['update package-manager: drafted in reasoning']);
  assert.equal(thinking('I am not sure what to save.'), null);
});

test('the answer channel wins; reasoning is the fallback, redacted reasoning carries nothing', () => {
  const content = [
    { type: 'thinking' as const, thinking: 'drafting' },
    { type: 'text' as const, text: answer([]) },
  ];
  assert.deepEqual(replyChannel(content), { text: answer([]), source: 'text' });
  assert.deepEqual(replyChannel([{ type: 'thinking', thinking: answer([create]) }]), {
    text: answer([create]),
    source: 'thinking',
  });
  assert.deepEqual(replyChannel([{ type: 'thinking', thinking: 'x', redacted: true }]), {
    text: '',
    source: 'thinking',
  });
});

test('invalid operations are dropped with their reasons, valid ones kept', () => {
  const parsed = text(
    answer([
      create,
      { op: 'create', type: 'memory', description: 'No body' },
      { op: 'update', name: 'Has Spaces', body: 'x' },
      { op: 'update', name: 'package-manager' },
      { op: 'remove', name: 'package-manager' },
      { op: 'forget', name: 'x' },
    ]),
  );
  assert.deepEqual(parsed?.ops, [create]);
  assert.equal(parsed?.dropped.length, 5);
  assert.equal(parsed?.dropped[0], 'operation 2: create must have required properties body');
  assert.match(parsed?.dropped[1] ?? '', /^operation 3: update\/name /);
  assert.equal(parsed?.dropped[2], 'operation 4: update changes nothing');
  assert.equal(parsed?.dropped[3], 'operation 5: remove must have required properties reason');
  assert.equal(parsed?.dropped[4], 'operation 6: unknown op "forget"');
  assert.deepEqual(text(answer(['not an object', null]))?.dropped, [
    'operation 1: not an object',
    'operation 2: not an object',
  ]);
});

test('fields are normalized: names lowercased, descriptions on one line, extras ignored', () => {
  const parsed = text(
    answer([
      {
        op: 'create',
        name: '  Reply-Language ',
        type: 'user',
        category: 'preference',
        description: 'Replies\n  in Chinese',
        body: '  Answer in Simplified Chinese.  ',
        reason: 'not a create field',
      },
      { op: 'create', type: 'failure', category: 'correction', description: 'd', body: 'b' },
      {
        op: 'propose_skill',
        name: 'release-app',
        description: 'd',
        body: '## When to use',
        reason: 'r',
      },
    ]),
  );
  assert.deepEqual(parsed?.ops, [
    {
      op: 'create',
      name: 'reply-language',
      type: 'user',
      description: 'Replies in Chinese',
      body: 'Answer in Simplified Chinese.',
    },
    { op: 'create', type: 'failure', category: 'correction', description: 'd', body: 'b' },
    {
      op: 'propose_skill',
      name: 'release-app',
      description: 'd',
      body: '## When to use',
      reason: 'r',
    },
  ]);
});

test('a description over 300 characters or a body over 20,000 is dropped', () => {
  const parsed = text(
    answer([
      { ...create, description: 'x'.repeat(301) },
      { ...create, body: 'x'.repeat(20001) },
    ]),
  );
  assert.deepEqual(parsed?.ops, []);
  assert.equal(parsed?.dropped.length, 2);
});

test('operations beyond the per-review limit are dropped', () => {
  const parsed = text(answer(Array.from({ length: MAX_OPS + 2 }, () => create)));
  assert.equal(parsed?.ops.length, MAX_OPS);
  assert.deepEqual(parsed?.dropped, [
    `operation ${MAX_OPS + 1}: over the limit of ${MAX_OPS} per review`,
    `operation ${MAX_OPS + 2}: over the limit of ${MAX_OPS} per review`,
  ]);
});

test('the system prompt holds no operation a model restating it could commit', () => {
  for (const source of ['text', 'thinking'] as const)
    assert.deepEqual(parseLearnerReply({ text: LEARNER_SYSTEM_PROMPT, source })?.ops ?? [], []);
});
