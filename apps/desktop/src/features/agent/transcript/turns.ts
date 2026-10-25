import { SHOW_UI_TOOL } from '@atd/agent-contracts';
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
    case 'retry':
      return true;
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return false;
    }
  }
}

/** Foldable work: tool calls, questions, and thinking. Pending edits fold like any other
 * step now — the approval diff moved to the composer popover, so the transcript row only needs
 * the tool name plus waiting text. A view the agent shows (`show_ui`) is part of its answer, not a
 * step of its work, so it stands alone like prose; updates to it (`update_ui`) are steps. */
function isActivityKind(block: Block): boolean {
  if (block.kind === 'tool') return block.name !== SHOW_UI_TOOL;
  return block.kind === 'thinking' || block.kind === 'question';
}

/**
 * Whether one of the agent's blocks puts something on screen: prose with text or an error, and
 * every call, question and thought, whose row shows from its start. A thought's live row reads
 * "Thinking" before any text; one that settled with none (a provider that keeps its reasoning to
 * itself) has nothing to show. Prose still waiting on its first token holds its place in the turn
 * but shows nothing.
 */
export function showsAgentOutput(block: Block): boolean {
  switch (block.kind) {
    case 'assistant':
      return block.text.trim() !== '' || block.error !== '';
    case 'thinking':
      return block.streaming || block.redacted || block.text.trim() !== '';
    case 'tool':
    case 'question':
      return true;
    case 'user':
    case 'system':
    case 'compaction':
    case 'retry':
      return false;
  }
}

function isIgnoredBlock(block: Block): boolean {
  // Settled empty thoughts never render. Empty prose stays while it streams into view.
  if (block.kind === 'thinking') return !showsAgentOutput(block);
  if (block.kind === 'assistant') return !block.streaming && !showsAgentOutput(block);
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
    // Assistant prose and views always render standalone at full strength; only foldable work
    // enters an activity group.
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
