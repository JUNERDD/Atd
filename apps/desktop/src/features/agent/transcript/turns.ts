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
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return false;
    }
  }
}

/** Foldable work: tool calls, questions, and thinking. An edit still awaiting approval stays out — you cannot judge a diff you cannot see. */
function isActivityKind(block: Block): boolean {
  return block.kind === 'thinking' || block.kind === 'tool' || block.kind === 'question';
}

/** Assistant prose with something in it — the paragraphs between tool calls. */
function isProseBlock(block: Block): boolean {
  return block.kind === 'assistant' && block.text.trim() !== '';
}

function isIgnoredBlock(block: Block): boolean {
  // Empty thoughts never render; redacted ones keep their placeholder. Empty assistant blocks
  // stay only when they carry an error or are still streaming into view.
  if (block.kind === 'thinking') return !block.redacted && block.text.trim() === '';
  if (block.kind === 'assistant')
    return block.text.trim() === '' && !block.error && !block.streaming;
  return false;
}

/**
 * Where the turn's final answer starts: the trailing run of assistant prose. Everything before it
 * folds, so the last thing the agent says is the only full-size thing left. A block still
 * streaming sits in that run, which is why text renders in full as it arrives and only folds once
 * the next tool starts.
 */
function finalResponseStart(blocks: Block[]): number {
  let index = blocks.length;
  while (index > 0) {
    const prev = blocks[index - 1];
    if (!prev || !isProseBlock(prev)) break;
    index -= 1;
  }
  return index;
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
  const finalStart = finalResponseStart(rest);
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
  rest.forEach((block, position) => {
    const request = requestFor(block, requests);
    if (
      !isPendingWrite(block, request) &&
      (isActivityKind(block) || (position < finalStart && isProseBlock(block)))
    ) {
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
