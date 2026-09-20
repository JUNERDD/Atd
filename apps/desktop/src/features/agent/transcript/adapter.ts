import type { ResolvedModel, TaskRun } from '../../../../electron/agent/task-schema';
import type { Block, BlockOf, ToolStatus } from '../../../../electron/agent/transcript-schema';
import { buildActivityPhases, isViewLive, type ActivityPhase } from './phases';
import { buildRateText, hasCompactionMarker, sumTurnUsage } from './token-rate';
import type { TurnWaitingKind } from './turn-header';
import { deriveTurns, type RequestIndex, type Turn } from './turns';

/**
 * Renderer-side reshape adapter (plan T1). The main process keeps the canonical flat `Block`
 * document with snapshot plus coalesced patches over IPC; this module projects it — after
 * `applyTranscriptPatch`, memoized on the patched inputs in `Transcript` — into monocode-shaped
 * view blocks with title facts, status, preview, approval, and turn-timing synthesis. Rows keep
 * rendering from `source` so no main-process schema or IPC shape changes.
 */

export type ViewRole = 'user' | 'assistant' | 'reasoning' | 'tool' | 'question' | 'system';

/** Preview kind synthesized from the Pi tool name plus its parsed args. */
export type ViewToolKind = 'read' | 'write' | 'shell' | 'search' | 'agent' | 'other';

export type ViewTool = {
  callId: string;
  name: string;
  kind: ViewToolKind;
  status: ToolStatus;
  path: string | null;
  fileName: string | null;
  query: string | null;
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
      phases: ActivityPhase[];
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
   * Timestamp-derived turn length. This cannot reproduce pause-aware elapsed time under approval
   * waits; the live footer ticks its own clock instead.
   */
  durationMs: number | null;
  waiting: TurnWaitingKind;
  modelName: string;
  /** Markdown the user actually reads: assistant prose joined for the footer copy action. */
  copyText: string;
  /** Model-output text for the live rate estimate; includes tool args for tool-heavy turns. */
  rateText: string;
  /** Provider true total for settled turns; null while streaming or when unknown. */
  trueTokens: number | null;
  /** A tool/question in the turn is still running; the rate clock pauses. */
  toolRunning: boolean;
  /** The turn lost provider history to compaction; settled falls back to the estimate. */
  rateUnknown: boolean;
};

function toolKindForName(name: string): ViewToolKind {
  switch (name) {
    case 'read':
      return 'read';
    case 'write':
    case 'edit':
      return 'write';
    case 'bash':
      return 'shell';
    case 'memory_search':
      return 'search';
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
      const query = stringArg(block.args, 'query') ?? stringArg(block.args, 'target');
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

function turnCopyText(blocks: Block[]): string {
  return blocks
    .filter((block) => block.kind === 'assistant')
    .map((block) => block.text.replace(/\r\n?/g, '\n').trim())
    .filter(Boolean)
    .join('\n\n');
}

function waitingKindFor(view: ViewBlock[]): TurnWaitingKind {
  for (const block of view) {
    if (block.requestKind === 'input') return 'answer';
    if (block.requestKind === 'confirmation') return 'approval';
  }
  return null;
}

function adaptTurn(turn: Turn, requests: RequestIndex, runs: TaskRun[]): AdaptedTurn {
  const view = turn.items.flatMap((item) =>
    item.type === 'block'
      ? [adaptBlock(item.block, requests)]
      : item.blocks.map((block) => adaptBlock(block, requests)),
  );
  const items: AdaptedItem[] = turn.items.map((item) => {
    if (item.type === 'block') return item;
    const activity = item.blocks.map((block) => adaptBlock(block, requests));
    const anchor = item.blocks.at(-1);
    return {
      type: 'activity',
      id: item.id,
      view: activity,
      phases: buildActivityPhases(activity),
      live: activity.some(isViewLive),
      anchorRunId: anchor?.runId ?? '',
      anchorBlockId: anchor?.id ?? item.id,
    };
  });
  const first = view[0];
  const last = view.at(-1);
  const userTimestamp = turn.user?.timestamp;
  const startedAt = userTimestamp ?? first?.timestamp ?? null;
  const end = last?.timestamp ?? userTimestamp ?? null;
  const runId = turn.user?.runId ?? first?.runId ?? '';
  const run = runs.find((candidate) => candidate.id === runId) ?? runs[0];
  const source = turn.items.flatMap((item) => (item.type === 'block' ? [item.block] : item.blocks));
  return {
    id: turn.id,
    user: turn.user,
    items,
    view,
    startedAt,
    durationMs: startedAt !== null && end !== null ? Math.max(0, end - startedAt) : null,
    waiting: waitingKindFor(view),
    modelName: modelNameForRun(run),
    copyText: turnCopyText(source),
    rateText: buildRateText(source),
    trueTokens: sumTurnUsage(source),
    toolRunning: view.some(
      (block) => (block.role === 'tool' || block.role === 'question') && isViewLive(block),
    ),
    rateUnknown: hasCompactionMarker(source),
  };
}

/**
 * Projects patched blocks plus the request index into adapted turns. Pure in its inputs — call it
 * inside `useMemo` keyed on the patched blocks, request index, and runs so the 40ms patch cadence
 * cannot rerender markdown past the revision that changed it.
 */
export function adaptTranscript(
  blocks: Block[],
  requests: RequestIndex,
  runs: TaskRun[],
): AdaptedTurn[] {
  return deriveTurns(blocks, requests).map((turn) => adaptTurn(turn, requests, runs));
}
