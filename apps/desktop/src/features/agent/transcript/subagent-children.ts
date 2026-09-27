import type { SubagentChildSummary, SubagentDetails } from '@ai/agent-contracts';
import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import type { Block, BlockOf } from '../../../../electron/agent/transcript-schema';

/**
 * The parent transcript is the only source of subagent children: every launching `subagent`
 * call carries its children's summaries in `details.data` (see `SubagentDetailsSchema`). These
 * helpers read that summary for cards, the drill-in header, and request attribution.
 */

/** Longest task excerpt shown beside the agent name in a child's label. */
const TASK_SUMMARY_CHARS = 60;

export type SubagentChildIndex = {
  /** By `<toolCallId>:<seq>`: the child transcript key the drill-in view subscribes to. */
  byKey: ReadonlyMap<string, SubagentChildSummary>;
  /** By `child:<parentRunId>:<n>`: what approvals and questions raised by a child carry. */
  byExecution: ReadonlyMap<string, SubagentChildSummary>;
};

export const EMPTY_CHILD_INDEX: SubagentChildIndex = { byKey: new Map(), byExecution: new Map() };

/** Child summaries of a launching `subagent` call; management calls (`action`) carry none. */
export function subagentDetailsOf(block: BlockOf<'tool'>): SubagentDetails | null {
  const data = block.details.data;
  return block.name === 'subagent' && data?.type === 'subagent' ? data : null;
}

export function indexSubagentChildren(blocks: readonly Block[]): SubagentChildIndex {
  const byKey = new Map<string, SubagentChildSummary>();
  const byExecution = new Map<string, SubagentChildSummary>();
  for (const block of blocks) {
    if (block.kind !== 'tool') continue;
    for (const child of subagentDetailsOf(block)?.children ?? []) {
      byKey.set(child.key, child);
      byExecution.set(child.executionId, child);
    }
  }
  return { byKey, byExecution };
}

/** Flat summaries of primitives: the same fields with the same values. */
function sameSummary(a: SubagentChildSummary, b: SubagentChildSummary): boolean {
  const keys = Object.keys(a) as (keyof SubagentChildSummary)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/**
 * Whether two indexes describe the same children. Every patch re-indexes the task's blocks, and
 * an equal index keeps the context value (and every card reading it) unchanged.
 */
export function sameChildIndex(a: SubagentChildIndex, b: SubagentChildIndex): boolean {
  if (a.byKey.size !== b.byKey.size || a.byExecution.size !== b.byExecution.size) return false;
  for (const [key, child] of a.byKey) {
    const other = b.byKey.get(key);
    if (!other || (other !== child && !sameSummary(child, other))) return false;
  }
  for (const [executionId, child] of a.byExecution) {
    if (b.byExecution.get(executionId)?.key !== child.key) return false;
  }
  return true;
}

/** What each child waits on, by execution id; the head request of a child wins. */
export type PendingByExecution = ReadonlyMap<string, PermissionRequest['kind']>;

export function pendingExecutions(requests: readonly PermissionRequest[]): PendingByExecution {
  const pending = new Map<string, PermissionRequest['kind']>();
  for (const request of requests) {
    if (request.executionId && !pending.has(request.executionId))
      pending.set(request.executionId, request.kind);
  }
  return pending;
}

/** "agent · first line of the task", clamped, naming a child in the subagent list. */
export function subtaskLabel(child: SubagentChildSummary): string {
  const line = child.task.split('\n', 1)[0]?.trim() ?? '';
  if (!line) return child.agent;
  const summary =
    line.length > TASK_SUMMARY_CHARS ? `${line.slice(0, TASK_SUMMARY_CHARS - 1).trimEnd()}…` : line;
  return `${child.agent} · ${summary}`;
}
