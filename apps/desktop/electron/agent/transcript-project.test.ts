import { describe, expect, it } from 'vitest';
import type { ServiceBlock } from '@ai/agent-contracts';
import { applyTranscriptPatch } from './transcript-schema';
import { mapBlock } from './service-map';
import type { Block, BlockOf } from './transcript-schema';

const RUN_ID = 'run1';
const USER_TS = 1000;
const ASSISTANT_TS = 2000;
const ABORTED_TS = 3000;
const EDIT_CALL = 'call-edit';
const ASK_CALL = 'call-ask';

function byId<K extends Block['kind']>(blocks: Block[], id: string, kind: K): BlockOf<K> {
  const block = blocks.find((item) => item.id === id);
  expect(block?.kind).toBe(kind);
  return block as BlockOf<K>;
}

const settledServiceBlocks: ServiceBlock[] = [
  {
    kind: 'user',
    id: `u:${USER_TS}:0`,
    runId: RUN_ID,
    timestamp: USER_TS,
    endedAt: USER_TS,
    text: 'Hello',
    prompt: true,
  },
  {
    kind: 'assistant',
    id: `a:${ASSISTANT_TS}:0`,
    runId: RUN_ID,
    timestamp: ASSISTANT_TS,
    endedAt: ASSISTANT_TS,
    text: 'I will look that up.',
    streaming: false,
    stopReason: 'stop',
    error: '',
  },
  {
    kind: 'thinking',
    id: `t:${ASSISTANT_TS}:1`,
    runId: RUN_ID,
    timestamp: ASSISTANT_TS,
    endedAt: ASSISTANT_TS,
    text: 'Need the file and a choice.',
    streaming: false,
    redacted: false,
  },
  {
    kind: 'tool',
    id: `tool:${EDIT_CALL}`,
    runId: RUN_ID,
    timestamp: ASSISTANT_TS,
    endedAt: 2100,
    callId: EDIT_CALL,
    name: 'edit',
    args: { path: 'note.txt' },
    status: 'declined',
    output: 'The user declined this action.',
    partial: '',
    permission: { scope: { tool: 'edit', location: 'inside' }, outcome: 'declined' },
  },
  {
    kind: 'question',
    id: `q:${ASK_CALL}`,
    runId: RUN_ID,
    timestamp: ASSISTANT_TS,
    endedAt: 2200,
    callId: ASK_CALL,
    title: 'Which option?',
    options: ['Option A', 'Option B'],
    status: 'completed',
    answer: 'Option A',
    skipped: false,
  },
  {
    kind: 'assistant',
    id: `a:${ABORTED_TS}:0`,
    runId: RUN_ID,
    timestamp: ABORTED_TS,
    endedAt: ABORTED_TS,
    text: 'Stopped there.',
    streaming: false,
    stopReason: 'aborted',
    error: '',
  },
];

const liveServiceBlocks: ServiceBlock[] = [
  ...settledServiceBlocks.slice(0, -1),
  {
    kind: 'assistant',
    id: `a:${ABORTED_TS}:0`,
    runId: RUN_ID,
    timestamp: ABORTED_TS,
    endedAt: ABORTED_TS,
    text: 'Stopped there.',
    streaming: true,
    stopReason: null,
    error: '',
  },
];

function project(blocks: ServiceBlock[] = settledServiceBlocks) {
  return blocks.map(mapBlock);
}

describe('mapBlock + applyTranscriptPatch', () => {
  it('maps identity, order, status, permission and answers from service blocks', () => {
    const blocks = project();
    expect(blocks.map((block) => [block.kind, block.id, block.runId])).toEqual([
      ['user', `u:${USER_TS}:0`, RUN_ID],
      ['assistant', `a:${ASSISTANT_TS}:0`, RUN_ID],
      ['thinking', `t:${ASSISTANT_TS}:1`, RUN_ID],
      ['tool', `tool:${EDIT_CALL}`, RUN_ID],
      ['question', `q:${ASK_CALL}`, RUN_ID],
      ['assistant', `a:${ABORTED_TS}:0`, RUN_ID],
    ]);
    expect(byId(blocks, `u:${USER_TS}:0`, 'user')).toMatchObject({ text: 'Hello', prompt: true });
    const assistant = byId(blocks, `a:${ASSISTANT_TS}:0`, 'assistant');
    expect(assistant).toMatchObject({
      text: 'I will look that up.',
      streaming: false,
      stopReason: 'stop',
      error: '',
    });
    expect(byId(blocks, `t:${ASSISTANT_TS}:1`, 'thinking')).toMatchObject({
      text: 'Need the file and a choice.',
      streaming: false,
      redacted: false,
    });
    expect(byId(blocks, `tool:${EDIT_CALL}`, 'tool')).toMatchObject({
      name: 'edit',
      status: 'declined',
      output: 'The user declined this action.',
      partial: '',
      details: { diff: '', truncated: false, fullOutputPath: '' },
      permission: { scope: { tool: 'edit', location: 'inside' }, outcome: 'declined' },
    });
    expect(byId(blocks, `q:${ASK_CALL}`, 'question')).toMatchObject({
      title: 'Which option?',
      options: ['Option A', 'Option B'],
      status: 'completed',
      answer: 'Option A',
      skipped: false,
    });
    expect(byId(blocks, `a:${ABORTED_TS}:0`, 'assistant')).toMatchObject({
      text: 'Stopped there.',
      streaming: false,
      stopReason: 'aborted',
    });
  });

  it('keeps settled blocks identical between a live partial and a cold settled message', () => {
    const cold = project(settledServiceBlocks);
    const live = project(liveServiceBlocks);
    const settledCold = cold.filter((block) => block.timestamp !== ABORTED_TS);
    const settledLive = live.filter((block) => block.timestamp !== ABORTED_TS);
    expect(settledLive).toEqual(settledCold);
    expect(byId(live, `a:${ABORTED_TS}:0`, 'assistant')).toMatchObject({
      id: `a:${ABORTED_TS}:0`,
      text: 'Stopped there.',
      streaming: true,
      stopReason: null,
    });
    expect(byId(cold, `a:${ABORTED_TS}:0`, 'assistant').streaming).toBe(false);
  });

  it('maps interrupted tools and questions when the service marks them so', () => {
    const hanging: ServiceBlock[] = [
      {
        kind: 'user',
        id: `u:${USER_TS}:0`,
        runId: RUN_ID,
        timestamp: USER_TS,
        endedAt: USER_TS,
        text: 'Hang',
      },
      {
        kind: 'tool',
        id: `tool:${EDIT_CALL}`,
        runId: RUN_ID,
        timestamp: ASSISTANT_TS,
        endedAt: ASSISTANT_TS,
        callId: EDIT_CALL,
        name: 'edit',
        args: {},
        status: 'interrupted',
        output: '',
        partial: '',
        permission: { scope: { tool: 'edit', location: 'inside' }, outcome: null },
      },
      {
        kind: 'question',
        id: `q:${ASK_CALL}`,
        runId: RUN_ID,
        timestamp: ASSISTANT_TS,
        endedAt: ASSISTANT_TS,
        callId: ASK_CALL,
        title: 'Which option?',
        options: ['Option A'],
        status: 'interrupted',
        answer: null,
        skipped: false,
      },
    ];
    const live: ServiceBlock[] = hanging.map((block) =>
      block.kind === 'tool' || block.kind === 'question'
        ? { ...block, status: 'running' as const }
        : block,
    );
    expect(byId(project(hanging), `tool:${EDIT_CALL}`, 'tool').status).toBe('interrupted');
    expect(byId(project(live), `tool:${EDIT_CALL}`, 'tool').status).toBe('running');
    expect(byId(project(hanging), `q:${ASK_CALL}`, 'question').status).toBe('interrupted');
  });

  it('joins mapped user text and clears tool partials once a result arrives', () => {
    const blocks = project([
      {
        kind: 'user',
        id: `u:${USER_TS}:0`,
        runId: RUN_ID,
        timestamp: USER_TS,
        endedAt: USER_TS,
        text: 'Hi there',
      },
      {
        kind: 'tool',
        id: `tool:${EDIT_CALL}`,
        runId: RUN_ID,
        timestamp: ASSISTANT_TS,
        endedAt: ASSISTANT_TS,
        callId: EDIT_CALL,
        name: 'edit',
        args: {},
        status: 'running',
        output: '',
        partial: 'patching…',
        permission: null,
      },
      {
        kind: 'question',
        id: `q:${ASK_CALL}`,
        runId: RUN_ID,
        timestamp: ASSISTANT_TS,
        endedAt: ASSISTANT_TS,
        callId: ASK_CALL,
        title: 'Which option?',
        options: [],
        status: 'completed',
        answer: 'picked',
        skipped: false,
      },
    ]);
    expect(byId(blocks, `u:${USER_TS}:0`, 'user').text).toBe('Hi there');
    expect(byId(blocks, `tool:${EDIT_CALL}`, 'tool').partial).toBe('patching…');
    expect(byId(blocks, `q:${ASK_CALL}`, 'question').status).toBe('completed');
  });

  it('maps compaction summaries into system info blocks', () => {
    const blocks = project([
      {
        kind: 'system',
        id: 's:50:0',
        runId: RUN_ID,
        timestamp: 50,
        endedAt: 50,
        level: 'info',
        text: 'Earlier turns were folded.',
      },
      {
        kind: 'system',
        id: 's:60:0',
        runId: RUN_ID,
        timestamp: 60,
        endedAt: 60,
        level: 'info',
        text: 'Also folded.',
      },
    ]);
    expect(blocks).toEqual([
      {
        kind: 'system',
        id: 's:50:0',
        runId: RUN_ID,
        timestamp: 50,
        endedAt: 50,
        level: 'info',
        text: 'Earlier turns were folded.',
      },
      {
        kind: 'system',
        id: 's:60:0',
        runId: RUN_ID,
        timestamp: 60,
        endedAt: 60,
        level: 'info',
        text: 'Also folded.',
      },
    ]);
  });

  it('reproduces the next document when applyTranscriptPatch consumes a mapped diff', () => {
    const previous = project(liveServiceBlocks.filter((block) => block.timestamp !== ABORTED_TS));
    const next = project(settledServiceBlocks);
    const prior = new Map(previous.map((block) => [block.id, block]));
    const nextIds = new Set(next.map((block) => block.id));
    const blocks = next.filter(
      (block) => JSON.stringify(prior.get(block.id)) !== JSON.stringify(block),
    );
    const removed = previous.filter((block) => !nextIds.has(block.id)).map((block) => block.id);
    expect(
      applyTranscriptPatch(
        { revision: 0, blocks: previous },
        {
          taskId: 'task1',
          revision: 1,
          snapshot: false,
          blocks,
          removed,
        },
      ),
    ).toEqual({ revision: 1, blocks: next });
  });
});
