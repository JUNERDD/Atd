import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import type { Artifact } from '../../../../electron/agent/task-schema';
import type { Block, BlockOf } from '../../../../electron/agent/transcript-schema';

export type RequestIndex = Map<string, PermissionRequest>;

export type TurnItem =
  | { type: 'block'; block: Block }
  | { type: 'activity'; id: string; blocks: Block[]; live: boolean };

export type Turn = {
  id: string;
  user: BlockOf<'user'> | null;
  items: TurnItem[];
};

export function indexRequests(requests: PermissionRequest[]): RequestIndex {
  const index: RequestIndex = new Map();
  for (const request of requests) {
    if (!index.has(request.toolCallId)) index.set(request.toolCallId, request);
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
