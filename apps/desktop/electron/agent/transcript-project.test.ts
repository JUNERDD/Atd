import { describe, expect, it } from 'vitest';
import { applyTranscriptPatch } from './transcript-schema';
import { diffBlocks, projectBlocks } from './transcript';
import {
  ABORTED_TS,
  ASK_CALL,
  ASSISTANT_TS,
  EDIT_CALL,
  RUN_ID,
  USER_TS,
  abortedAssistant,
  livePrefix,
  settledBranch,
  toolResult,
  userMessage,
  workingAssistant,
} from './transcript-project.fixtures';
import type { Block, BlockOf } from './transcript-schema';

function byId<K extends Block['kind']>(blocks: Block[], id: string, kind: K): BlockOf<K> {
  const block = blocks.find((item) => item.id === id);
  expect(block?.kind).toBe(kind);
  return block as BlockOf<K>;
}

function project(
  branch = settledBranch(),
  live = false,
  partial?: Parameters<typeof projectBlocks>[0]['partial'],
) {
  return projectBlocks({
    branch,
    partial,
    defaultRunId: 'fallback',
    live,
  });
}

describe('projectBlocks', () => {
  it('projects identity, order, status, permission and answers from a Pi branch', () => {
    const blocks = project();
    expect(blocks.map((block) => [block.kind, block.id, block.runId])).toEqual([
      ['user', `u:${USER_TS}:0`, RUN_ID],
      ['assistant', `a:${ASSISTANT_TS}:0`, RUN_ID],
      ['thinking', `t:${ASSISTANT_TS}:1`, RUN_ID],
      ['tool', `tool:${EDIT_CALL}`, RUN_ID],
      ['question', `q:${ASK_CALL}`, RUN_ID],
      ['assistant', `a:${ABORTED_TS}:0`, RUN_ID],
    ]);
    expect(byId(blocks, `u:${USER_TS}:0`, 'user').text).toBe('Hello');
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
      details: { diff: '--- a/note.txt\n+++ b/note.txt\n', truncated: true, fullOutputPath: '' },
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
    const cold = project(settledBranch(), false);
    const live = project(livePrefix(), true, abortedAssistant());
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

  it('marks a tool without a result as interrupted when the session is not live', () => {
    const hanging = workingAssistant();
    const branch = [
      {
        type: 'custom' as const,
        customType: 'app-invocation',
        data: { runId: RUN_ID, source: 'user' },
      },
      { type: 'message' as const, message: userMessage('Hang') },
      { type: 'message' as const, message: hanging },
    ];
    const cold = project(branch, false);
    const live = project(branch, true);
    expect(byId(cold, `tool:${EDIT_CALL}`, 'tool').status).toBe('interrupted');
    expect(byId(live, `tool:${EDIT_CALL}`, 'tool').status).toBe('running');
    expect(byId(cold, `q:${ASK_CALL}`, 'question').status).toBe('interrupted');
  });

  it('joins user text parts and surfaces live tool partials until a result arrives', () => {
    const blocks = projectBlocks({
      branch: [
        {
          type: 'message',
          message: userMessage([
            { type: 'text', text: 'Hi ' },
            { type: 'text', text: 'there' },
          ]),
        },
        { type: 'message', message: workingAssistant() },
        {
          type: 'message',
          message: toolResult(ASK_CALL, 'ask_user', {
            content: [{ type: 'text', text: 'picked' }],
          }),
        },
      ],
      defaultRunId: RUN_ID,
      live: true,
      partials: new Map([
        [EDIT_CALL, 'patching…'],
        [ASK_CALL, 'stale'],
      ]),
    });
    expect(byId(blocks, `u:${USER_TS}:0`, 'user').text).toBe('Hi there');
    expect(byId(blocks, `tool:${EDIT_CALL}`, 'tool').partial).toBe('patching…');
    expect(byId(blocks, `q:${ASK_CALL}`, 'question').status).toBe('completed');
  });

  it('turns compaction summaries into system info blocks and skips hidden custom messages', () => {
    const blocks = projectBlocks({
      branch: [
        { type: 'custom_message', customType: 'app-material', content: 'secret', display: false },
        { type: 'compaction', summary: 'Earlier turns were folded.', timestamp: 50 },
        {
          type: 'message',
          message: {
            role: 'compactionSummary',
            summary: 'Also folded.',
            tokensBefore: 12,
            timestamp: 60,
          },
        },
      ],
      defaultRunId: RUN_ID,
      live: false,
    });
    expect(blocks).toEqual([
      {
        kind: 'system',
        id: 's:50:0',
        runId: RUN_ID,
        timestamp: 50,
        level: 'info',
        text: 'Earlier turns were folded.',
      },
      {
        kind: 'system',
        id: 's:60:0',
        runId: RUN_ID,
        timestamp: 60,
        level: 'info',
        text: 'Also folded.',
      },
    ]);
  });

  it('reproduces the next document when applyTranscriptPatch consumes the projection diff', () => {
    const previous = project(livePrefix(), false);
    const next = project(settledBranch(), false);
    const { blocks, removed } = diffBlocks(previous, next);
    expect(removed).toEqual([]);
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
