import type { PermissionRequest } from '../../../client/agent/permission-schema';
import type { Artifact } from '../../../client/agent/task-schema';
import type { Block, BlockOf } from '../../../client/agent/transcript-schema';

export type RequestIndex = Map<string, PermissionRequest>;

export type TurnItem =
  | { type: 'block'; block: Block }
  | { type: 'activity'; id: string; blocks: Block[]; live: boolean };

export type Turn = {
  id: string;
  user: BlockOf<'user'> | null;
  items: TurnItem[];
};

/**
 * A tool call a `codemode` script made has the id `<codemode call id>/<n>`; its requests show on
 * the script's row, the one the transcript has.
 */
const NESTED_CALL_ID = /^(.+?)(?:\/(?:\d+|\?))+$/;

/**
 * Pending requests by the call id of the row that shows them: a call's own, and a nested call's
 * under its codemode call too. Exact ids are indexed first, so a row's own request wins and a
 * provider id that happens to end like a nested one still finds its own row.
 */
export function indexRequests(requests: PermissionRequest[]): RequestIndex {
  const index: RequestIndex = new Map();
  for (const request of requests) {
    if (!index.has(request.toolCallId)) index.set(request.toolCallId, request);
  }
  for (const request of requests) {
    const parent = NESTED_CALL_ID.exec(request.toolCallId)?.[1];
    if (parent && !index.has(parent)) index.set(parent, request);
  }
  return index;
}

export function requestFor(block: Block, requests: RequestIndex): PermissionRequest | undefined {
  return 'callId' in block ? requests.get(block.callId) : undefined;
}

export function isPendingWrite(
  block: Block,
  request: PermissionRequest | undefined,
): request is Extract<PermissionRequest, { kind: 'confirmation' }> {
  // Kept for reversibility: the composer popover now embeds the approval diff, so folding no
  // longer keeps pending edits unfolded. Callers were migrated; this predicate documents the
  // scope that used to bypass the activity group.
  if (block.kind !== 'tool' || request?.kind !== 'confirmation') return false;
  return request.scope.tool === 'edit' || request.scope.tool === 'write';
}

export function isLiveBlock(block: Block, request: PermissionRequest | undefined): boolean {
  if (request) return true;
  switch (block.kind) {
    case 'assistant':
    case 'thinking':
      return block.streaming;
    case 'tool':
    case 'question':
      return block.status === 'running';
    case 'user':
    case 'system':
      return false;
    case 'compaction':
      return block.status === 'running';
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return false;
    }
  }
}

/** Foldable work: tool calls, questions, and thinking. Pending edits fold like any other
 * step now — the approval diff moved to the composer popover, so the transcript row only needs
 * the tool name plus waiting text. */
function isActivityKind(block: Block): boolean {
  return block.kind === 'thinking' || block.kind === 'tool' || block.kind === 'question';
}

function isIgnoredBlock(block: Block): boolean {
  // Empty thoughts never render; redacted ones keep their placeholder. Empty assistant blocks
  // stay only when they carry an error or are still streaming into view.
  if (block.kind === 'thinking') return !block.redacted && block.text.trim() === '';
  if (block.kind === 'assistant')
    return block.text.trim() === '' && !block.error && !block.streaming;
  return false;
}

export function deriveTurns(blocks: Block[], requests: RequestIndex): Turn[] {
  const groups: Block[][] = [];
  let current: Block[] = [];
  for (const block of blocks) {
    if (block.kind === 'user' && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);
  return groups.map((turnBlocks, index) => foldTurn(turnBlocks, requests, index));
}

function foldTurn(blocks: Block[], requests: RequestIndex, index: number): Turn {
  const first = blocks[0];
  const user = first?.kind === 'user' ? first : null;
  const rest = (user ? blocks.slice(1) : blocks).filter((block) => !isIgnoredBlock(block));
  const items: TurnItem[] = [];
  let activity: Block[] = [];
  const flush = () => {
    const head = activity[0];
    if (!head) return;
    items.push({
      type: 'activity',
      id: `activity-${head.id}`,
      blocks: activity,
      live: activity.some((block) => isLiveBlock(block, requestFor(block, requests))),
    });
    activity = [];
  };
  rest.forEach((block) => {
    // Assistant prose always renders standalone at full strength; only foldable work enters an
    // activity group.
    if (isActivityKind(block)) {
      activity.push(block);
      return;
    }
    flush();
    items.push({ type: 'block', block });
  });
  flush();
  return { id: user?.id ?? `turn-${index}`, user, items };
}

export function artifactAnchorIds(blocks: Block[], artifacts: Artifact[]): Set<string> {
  const runIds = new Set(artifacts.map((file) => file.runId));
  const anchors = new Set<string>();
  for (const runId of runIds) {
    const ofRun = blocks.filter((block) => block.runId === runId);
    const lastAssistant = [...ofRun].reverse().find((block) => block.kind === 'assistant');
    const anchor = lastAssistant ?? ofRun.at(-1);
    if (anchor) anchors.add(anchor.id);
  }
  return anchors;
}

/** Whether two id sets hold the same ids. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
