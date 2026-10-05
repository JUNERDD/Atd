import { LOAD_SKILL_TOOL, TODO_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from '@atd/agent-contracts';
import type { ResolvedModel, TaskRun } from '../../../client/agent/task-schema';
import type { Block, BlockOf, ToolStatus } from '../../../client/agent/transcript-schema';
import { buildActivityPhase, isViewLive, type ActivityPhase } from './phases';
import { reuseProjection, type ProjectionCache } from './projection-cache';
import { subagentLaunches } from './subagent-call';
import { hasCompactionMarker, sumTurnGeneration } from './token-rate';
import type { TurnWaitingKind } from './turn-header';
import { sumTurnUsage, type TurnUsage } from './turn-usage';
import { deriveTurns, requestFor, type RequestIndex, type Turn } from './turns';

/**
 * Renderer-side reshape adapter (plan T1). The main process keeps the canonical flat `Block`
 * document with snapshot plus coalesced patches over IPC; this module projects it — after
 * `applyTranscriptPatch`, memoized on the patched inputs in `Transcript` — into monocode-shaped
 * view blocks with title facts, status, preview, approval, and turn-timing synthesis. Rows keep
 * rendering from `source` so no main-process schema or IPC shape changes.
 */

export type ViewRole = 'user' | 'assistant' | 'reasoning' | 'tool' | 'question' | 'system';

/**
 * Preview kind synthesized from the Pi tool name plus its parsed args. `web` covers search and
 * page fetches; `plan` covers the todo list, which tracks the work rather than doing it.
 */
export type ViewToolKind =
  | 'read'
  | 'write'
  | 'shell'
  | 'search'
  | 'web'
  | 'plan'
  | 'agent'
  | 'other';

export type ViewTool = {
  callId: string;
  name: string;
  kind: ViewToolKind;
  status: ToolStatus;
  path: string | null;
  fileName: string | null;
  query: string | null;
  /** Subagents this call launched; zero for every other tool and for subagent management calls. */
  subagents: number;
};

export type ViewBlock = {
  id: string;
  runId: string;
  timestamp: number;
  role: ViewRole;
  text: string;
  streaming: boolean;
  /** Tool and question status; `null` for every other role. */
  status: ToolStatus | null;
  tool: ViewTool | null;
  /** A pending permission request still exists for this call. */
  approvalPending: boolean;
  /** Kind of the pending request, for the live footer's waiting label. */
  requestKind: 'confirmation' | 'input' | null;
  source: Block;
};

export type AdaptedItem =
  | { type: 'block'; block: Block }
  | {
      type: 'activity';
      id: string;
      view: ViewBlock[];
      phase: ActivityPhase;
      live: boolean;
      anchorRunId: string;
      anchorBlockId: string;
    };

export type AdaptedTurn = {
  id: string;
  user: BlockOf<'user'> | null;
  items: AdaptedItem[];
  /** Every non-user block of the turn as view blocks, in document order. */
  view: ViewBlock[];
  startedAt: number | null;
  /**
   * True turn wall length: user message to the max block completion time. The live header ticks
   * its own clock (frozen through approval waits) instead of using this.
   */
  durationMs: number | null;
  waiting: TurnWaitingKind;
  modelName: string;
  /** Provider true output total for settled turns; null while streaming or when unknown. */
  trueTokens: number | null;
  /** Worker-measured generation time for settled turns; null while streaming or when unknown. */
  trueDurationMs: number | null;
  /** Provider-reported usage summed over the turn's messages; null when none reported any. */
  usage: TurnUsage | null;
};

function toolKindForName(name: string): ViewToolKind {
  switch (name) {
    case 'read':
    case 'ls':
    case LOAD_SKILL_TOOL:
    case 'memory_read':
      return 'read';
    case 'write':
    case 'edit':
      return 'write';
    case 'bash':
      return 'shell';
    case 'memory_search':
    case 'grep':
    case 'find':
      return 'search';
    case WEB_SEARCH_TOOL:
    case WEB_FETCH_TOOL:
      return 'web';
    case TODO_TOOL:
      return 'plan';
    case 'subagent':
      return 'agent';
    default:
      return 'other';
  }
}

function stringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value ? value : null;
}

function leafName(path: string): string {
  return path.split('/').pop() || path;
}

function adaptBlock(block: Block, requests: RequestIndex): ViewBlock {
  const base = {
    id: block.id,
    runId: block.runId,
    timestamp: block.timestamp,
    approvalPending: false,
    requestKind: null as ViewBlock['requestKind'],
    source: block,
  };
  switch (block.kind) {
    case 'user':
      return {
        ...base,
        role: 'user',
        text: block.text,
        streaming: false,
        status: null,
        tool: null,
      };
    case 'assistant':
      return {
        ...base,
        role: 'assistant',
        text: block.text,
        streaming: block.streaming,
        status: null,
        tool: null,
      };
    case 'thinking':
      return {
        ...base,
        role: 'reasoning',
        text: block.text,
        streaming: block.streaming,
        status: null,
        tool: null,
      };
    case 'tool': {
      const path = stringArg(block.args, 'path');
      const command = stringArg(block.args, 'command');
      const query =
        stringArg(block.args, 'query') ??
        stringArg(block.args, 'pattern') ??
        stringArg(block.args, 'target');
      const request = requests.get(block.callId);
      return {
        ...base,
        role: 'tool',
        text: command?.split('\n')[0]?.trim() ?? '',
        streaming: false,
        status: block.status,
        tool: {
          callId: block.callId,
          name: block.name,
          kind: toolKindForName(block.name),
          status: block.status,
          path,
          fileName: path ? leafName(path) : null,
          query,
          subagents: block.name === 'subagent' ? subagentLaunches(block.args, block.status) : 0,
        },
        approvalPending: requests.has(block.callId),
        requestKind: request?.kind ?? null,
      };
    }
    case 'question': {
      const request = requests.get(block.callId);
      return {
        ...base,
        role: 'question',
        text: block.title,
        streaming: false,
        status: block.status,
        tool: null,
        approvalPending: requests.has(block.callId),
        requestKind: request?.kind ?? null,
      };
    }
    case 'system':
      return {
        ...base,
        role: 'system',
        text: block.text,
        streaming: false,
        status: null,
        tool: null,
      };
    // A compaction is a system event in the view model; `CompactionBlock` renders its source.
    case 'compaction':
      return {
        ...base,
        role: 'system',
        text: block.summary,
        streaming: false,
        status: null,
        tool: null,
      };
    // So is a retry; `RetryBlock` renders its source.
    case 'retry':
      return {
        ...base,
        role: 'system',
        text: block.error,
        streaming: false,
        status: null,
        tool: null,
      };
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return { ...base, role: 'system', text: '', streaming: false, status: null, tool: null };
    }
  }
}

/** Display name for a frozen or legacy model reference; empty when the run is unknown. */
export function modelNameForRun(run: TaskRun | undefined): string {
  const model: ResolvedModel | undefined = run?.snapshot.model;
  if (!model) return '';
  return 'definition' in model ? model.definition.name : model.modelId;
}

function waitingKindFor(view: ViewBlock[]): TurnWaitingKind {
  for (const block of view) {
    if (block.requestKind === 'input') return 'answer';
    if (block.requestKind === 'confirmation') return 'approval';
  }
  return null;
}

type ActivityItem = Extract<AdaptedItem, { type: 'activity' }>;

const activityCache: ProjectionCache<ActivityItem> = new WeakMap();
const turnCache: ProjectionCache<AdaptedTurn> = new WeakMap();

function adaptActivity(
  item: Extract<Turn['items'][number], { type: 'activity' }>,
  requests: RequestIndex,
): ActivityItem {
  // Each step with the request raised on it, if any: all an adapted step reads.
  const inputs = item.blocks.flatMap((block) => [block, requestFor(block, requests)]);
  return reuseProjection(activityCache, item.blocks[0], inputs, () => {
    const activity = item.blocks.map((block) => adaptBlock(block, requests));
    const anchor = item.blocks.at(-1);
    return {
      type: 'activity',
      id: item.id,
      view: activity,
      phase: buildActivityPhase(activity),
      live: activity.some(isViewLive),
      anchorRunId: anchor?.runId ?? '',
      anchorBlockId: anchor?.id ?? item.id,
    };
  });
}

function adaptTurn(turn: Turn, requests: RequestIndex, runs: TaskRun[]): AdaptedTurn {
  const items: AdaptedItem[] = turn.items.map((item) =>
    item.type === 'block' ? item : adaptActivity(item, requests),
  );
  const source = turn.items.flatMap((item) => (item.type === 'block' ? [item.block] : item.blocks));
  const head = turn.user ?? source[0];
  const runId = head?.runId ?? '';
  const run = runs.find((candidate) => candidate.id === runId) ?? runs[0];
  // Standalone blocks (prose, notes, compactions) carry no call, so no request reaches them.
  const inputs = [
    turn.id,
    run,
    turn.user,
    ...items.map((item) => (item.type === 'block' ? item.block : item)),
  ];
  return reuseProjection(turnCache, head, inputs, () => {
    const view = items.flatMap((item) =>
      item.type === 'block' ? [adaptBlock(item.block, requests)] : item.view,
    );
    const userTimestamp = turn.user?.timestamp;
    const startedAt = userTimestamp ?? view[0]?.timestamp ?? null;
    let end = userTimestamp ?? null;
    for (const block of source) end = end === null ? block.endedAt : Math.max(end, block.endedAt);
    const generation = hasCompactionMarker(source) ? null : sumTurnGeneration(source);
    return {
      id: turn.id,
      user: turn.user,
      items,
      view,
      startedAt,
      durationMs: startedAt !== null && end !== null ? Math.max(0, end - startedAt) : null,
      waiting: waitingKindFor(view),
      modelName: modelNameForRun(run),
      trueTokens: generation?.tokens ?? null,
      trueDurationMs: generation?.durationMs ?? null,
      usage: sumTurnUsage(source),
    };
  });
}

/**
 * Projects patched blocks plus the request index into adapted turns. Pure in its inputs; every
 * streamed patch replaces `blocks`, so it runs once per patch, but turns and activity groups whose
 * blocks, requests and run are unchanged come back as the same objects (`reuseProjection`), so
 * memoized turn and group views skip the patch.
 */
export function adaptTranscript(
  blocks: Block[],
  requests: RequestIndex,
  runs: TaskRun[],
): AdaptedTurn[] {
  return deriveTurns(blocks, requests).map((turn) => adaptTurn(turn, requests, runs));
}
