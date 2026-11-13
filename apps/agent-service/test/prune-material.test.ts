import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProjectedSessionEntry } from '@earendil-works/pi-coding-agent';
import {
  CLEARED_FILE_TEXT,
  CLEARED_TOOL_OUTPUT,
  prunableContext,
} from '../dist/compaction/prune.js';
import { RUN_MATERIAL_TYPE } from '../dist/prompt-context.js';

function materialEntry(id: string, content: string): ProjectedSessionEntry {
  return {
    sourceEntry: {
      type: 'custom_message',
      id,
      parentId: null,
      timestamp: '2026-11-13T05:00:00.000Z',
      customType: RUN_MATERIAL_TYPE,
      content,
      display: false,
    },
    messages: [
      {
        role: 'custom',
        customType: RUN_MATERIAL_TYPE,
        content,
        display: false,
        timestamp: 0,
      },
    ],
  } as unknown as ProjectedSessionEntry;
}

function toolResultEntry(id: string, text: string): ProjectedSessionEntry {
  return {
    sourceEntry: {
      type: 'message',
      id,
      parentId: null,
      timestamp: '2026-11-13T05:01:00.000Z',
      message: {
        role: 'toolResult',
        toolCallId: `call-${id}`,
        toolName: 'read',
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: 0,
      },
    },
    messages: [
      {
        role: 'toolResult',
        toolCallId: `call-${id}`,
        toolName: 'read',
        content: [{ type: 'text', text }],
        isError: false,
        timestamp: 0,
      },
    ],
  } as unknown as ProjectedSessionEntry;
}

test('prunableContext clears pathed file-material (with or without extraction note) and keeps headers', () => {
  const bigBody = 'A'.repeat(100_000);
  const pathed = [
    '<run_material>',
    'File: report.pdf',
    'Read-only resource: /tmp/resources/res-1',
    'Extracted files: /tmp/extractions/ext-1',
    '<file-material>',
    bigBody,
    '</file-material>',
    '',
    'File: notes.txt',
    'Read-only resource: /tmp/resources/res-2',
    '<file-material>',
    bigBody,
    '</file-material>',
    '</run_material>',
  ].join('\n');
  const recentGuard = toolResultEntry('recent', 'R'.repeat(165_000));

  const edits = prunableContext([materialEntry('old-pathed', pathed), recentGuard], {
    material: true,
  });
  assert.equal(edits.length, 1);
  assert.equal(edits[0]?.targetId, 'old-pathed');
  const content = edits[0]?.replacement?.content;
  assert.equal(typeof content, 'string');
  const replaced = typeof content === 'string' ? content : '';
  assert.ok(replaced.includes('Read-only resource: /tmp/resources/res-1'));
  assert.ok(replaced.includes('Extracted files: /tmp/extractions/ext-1'));
  assert.ok(replaced.includes('Read-only resource: /tmp/resources/res-2'));
  assert.ok(replaced.includes(CLEARED_FILE_TEXT));
  assert.equal(replaced.includes(bigBody), false);
});

test('prunableContext leaves pathless lite/tool-less run material whole and out of KEEP_RECENT_TOKENS', () => {
  const oldTool = toolResultEntry('old-tool', 'T'.repeat(120_000));
  // 180k chars (~45k tokens): if counted as clearable, this pathless material would fill the 40k
  // KEEP_RECENT_TOKENS window on its own and cause `midTool` (just before it) to be cleared!
  const pathless = [
    '<run_material>',
    'File: Screenshot context.md',
    '<file-material>',
    'P'.repeat(180_000),
    '</file-material>',
    '</run_material>',
  ].join('\n');
  // 164k chars (~41k tokens): occupies KEEP_RECENT_TOKENS only when `pathless` is ignored (null).
  const midTool = toolResultEntry('mid-tool', 'M'.repeat(164_000));

  const edits = prunableContext([oldTool, midTool, materialEntry('lite-mat', pathless)], {
    material: true,
  });
  assert.deepEqual(
    edits.map((edit) => edit.targetId),
    ['old-tool'],
    'pathless material stays untouched and does not consume KEEP_RECENT_TOKENS ahead of mid-tool',
  );
  assert.deepEqual(edits[0]?.replacement?.content, [{ type: 'text', text: CLEARED_TOOL_OUTPUT }]);
});
