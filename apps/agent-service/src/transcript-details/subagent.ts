import {
  SUBAGENT_DETAILS_MAX_CHILDREN,
  SUBAGENT_ERROR_MAX_LENGTH,
  SUBAGENT_OUTPUT_MAX_LENGTH,
  SUBAGENT_TASK_MAX_LENGTH,
  subagentChildKey,
  type ServiceToolStatus,
  type SubagentChildEntry,
  type SubagentChildStatus,
  type SubagentChildSummary,
  type SubagentDetails,
} from '@ai/agent-contracts';
import { createClamp, isRecord } from './clamp.js';

/**
 * Parent `subagent` row details. The card list comes from the parent session's `app-child` entries
 * for the call (the only link between a call and its children); pi-subagents' result rows only
 * enrich a card, matched by the child's `sessionFile`. Rows arrive untrusted: the final
 * `ToolResultMessage.details` once the call ended, or the streamed partial details while it runs.
 */

/** Result rows kept per call; matches the card cap, since an unmatched row adds no card. */
const MAX_ROWS = SUBAGENT_DETAILS_MAX_CHILDREN;
const MODEL_MAX_LENGTH = 256;
const TOOL_MAX_LENGTH = 128;
const PATH_MAX_LENGTH = 4096;

/** One pi-subagents result row reduced to what a card shows; bounded so live state stays small. */
export interface SubagentRow {
  sessionFile: string;
  /**
   * Workflow lane key: `task-<n>`, `step-<n>` or `step-<n>-<m>` for pi-subagents' `tasks` and
   * `chain` (`p<i>` / `c<i>` in the former service workflows); names the lane's task.
   */
  workflowKey?: string;
  status: SubagentChildStatus;
  model?: string;
  currentTool?: string;
  toolCount: number;
  turnCount?: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  finalOutput: string;
  error: string;
  /** Characters were cut from this row; the card's details report `truncated`. */
  clipped: boolean;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/**
 * pi-subagents `SingleResult` status: a row whose own progress still runs is live; otherwise its
 * exit decides (`interrupted`/`stopped`/`detached` end without a verdict).
 */
function rowStatus(
  row: Record<string, unknown>,
  progress: Record<string, unknown>,
): SubagentChildStatus {
  if (progress['status'] === 'running' || progress['status'] === 'pending') return 'running';
  if (row['interrupted'] === true || row['stopped'] === true || row['detached'] === true)
    return 'interrupted';
  if (row['exitCode'] !== 0 || text(row['error'])) return 'failed';
  return 'completed';
}

function toRow(raw: unknown): SubagentRow | null {
  if (!isRecord(raw)) return null;
  const clamp = createClamp();
  const sessionFile = text(raw['sessionFile']);
  // Running rows carry no session file yet; without one a row cannot be matched to a card.
  if (!sessionFile || sessionFile.length > PATH_MAX_LENGTH) return null;
  const progress = isRecord(raw['progress']) ? raw['progress'] : {};
  const summary = isRecord(raw['progressSummary']) ? raw['progressSummary'] : {};
  const usage = isRecord(raw['usage']) ? raw['usage'] : {};
  const status = rowStatus(raw, progress);
  const model = text(raw['model']) ?? text(progress['model']);
  const currentTool = status === 'running' ? text(progress['currentTool']) : undefined;
  const workflowKey = text(raw['workflowKey']);
  const turnCount = count(usage['turns']) ?? count(progress['turnCount']);
  const inputTokens = count(usage['input']) ?? count(progress['inputTokens']);
  const outputTokens = count(usage['output']) ?? count(progress['outputTokens']);
  const toolCalls = Array.isArray(raw['toolCalls']) ? raw['toolCalls'].length : undefined;
  return {
    sessionFile,
    ...(workflowKey ? { workflowKey: clamp.text(workflowKey, TOOL_MAX_LENGTH) } : {}),
    status,
    ...(model ? { model: clamp.text(model, MODEL_MAX_LENGTH) } : {}),
    ...(currentTool ? { currentTool: clamp.text(currentTool, TOOL_MAX_LENGTH) } : {}),
    toolCount: count(summary['toolCount']) ?? count(progress['toolCount']) ?? toolCalls ?? 0,
    ...(turnCount !== undefined ? { turnCount } : {}),
    durationMs: count(summary['durationMs']) ?? count(progress['durationMs']) ?? 0,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    finalOutput: clamp.text(text(raw['finalOutput']) ?? '', SUBAGENT_OUTPUT_MAX_LENGTH),
    error: clamp.text(text(raw['error']) ?? '', SUBAGENT_ERROR_MAX_LENGTH),
    clipped: clamp.truncated,
  };
}

/** The matchable rows of one call's details (`{ results: SingleResult[] }`), final or partial. */
export function subagentRows(details: unknown): SubagentRow[] {
  if (!isRecord(details) || !Array.isArray(details['results'])) return [];
  const rows: SubagentRow[] = [];
  for (const raw of details['results']) {
    const row = toRow(raw);
    if (row) rows.push(row);
    if (rows.length === MAX_ROWS) break;
  }
  return rows;
}

/** One child of a multi-child call: its workflow lane key and the task the call gave it. */
interface Lane {
  key: string;
  task: string;
}

function laneTask(item: unknown): string {
  return isRecord(item) ? (text(item['task']) ?? '') : '';
}

/**
 * The children a `tasks` or `chain` call names, in launch order and keyed as pi-subagents keys
 * their lanes (1-based; a chain's parallel step `step-<n>-<m>`). Sessions from before these kept
 * the service's named workflows, `workflow` with `args.tasks` (`p<i>`) or `args.steps` (`c<i>`).
 * Null for a single child.
 */
function lanesOf(args: Record<string, unknown>): Lane[] | null {
  const tasks = args['tasks'];
  if (Array.isArray(tasks))
    return tasks.map((item: unknown, index) => ({
      key: `task-${index + 1}`,
      task: laneTask(item),
    }));
  const chain = args['chain'];
  if (Array.isArray(chain))
    return chain.flatMap((step: unknown, index): Lane[] => {
      const parallel = isRecord(step) ? step['parallel'] : undefined;
      if (!Array.isArray(parallel)) return [{ key: `step-${index + 1}`, task: laneTask(step) }];
      return parallel.map((item: unknown, member) => ({
        key: `step-${index + 1}-${member + 1}`,
        task: laneTask(item),
      }));
    });
  if (args['workflow'] == null) return null;
  const workflowArgs = isRecord(args['args']) ? args['args'] : {};
  const legacy = Array.isArray(workflowArgs['tasks'])
    ? { prefix: 'p', list: workflowArgs['tasks'] }
    : { prefix: 'c', list: Array.isArray(workflowArgs['steps']) ? workflowArgs['steps'] : [] };
  return legacy.list.map((item: unknown, index) => ({
    key: `${legacy.prefix}${index}`,
    task: laneTask(item),
  }));
}

/**
 * The task a child ran, from the call's own arguments: pi-subagents redacts its copy once a child
 * ends. A single call has one task for every attempt; a multi-child call names the lane by its
 * result row's key when one matched, otherwise by launch order.
 */
function taskFor(args: Record<string, unknown>, seq: number, row: SubagentRow | undefined): string {
  const lanes = lanesOf(args);
  if (!lanes) return text(args['task']) ?? '';
  const lane = lanes.find((entry) => entry.key === row?.workflowKey) ?? lanes[seq];
  return lane?.task ?? '';
}

/**
 * A card's status: the matched row's when it ended; otherwise running while the parent call runs,
 * and interrupted once the call is over without a verdict for this child.
 */
function childStatus(row: SubagentRow | undefined, call: ServiceToolStatus): SubagentChildStatus {
  if (row && row.status !== 'running') return row.status;
  return call === 'running' ? 'running' : 'interrupted';
}

export interface SubagentDetailsInput {
  args: Record<string, unknown>;
  /** The call's tool status (transcript-blocks.ts `resolveStatus`). */
  status: ServiceToolStatus;
  /** This call's `app-child` entries in `seq` order. */
  children: readonly SubagentChildEntry[];
  /** Result rows from the final details, or the latest streamed ones while the call runs. */
  rows: readonly SubagentRow[];
}

export function projectSubagentDetails(input: SubagentDetailsInput): SubagentDetails {
  const clamp = createClamp();
  const bySession = new Map(input.rows.map((row) => [row.sessionFile, row]));
  const cards = clamp
    .list(input.children, SUBAGENT_DETAILS_MAX_CHILDREN)
    .map((entry): SubagentChildSummary => {
      const row = bySession.get(entry.sessionFile);
      if (row?.clipped) clamp.drop();
      const status = childStatus(row, input.status);
      return {
        key: subagentChildKey(entry.toolCallId, entry.seq),
        seq: entry.seq,
        executionId: entry.executionId,
        agent: entry.agent,
        task: clamp.text(taskFor(input.args, entry.seq, row), SUBAGENT_TASK_MAX_LENGTH),
        status,
        ...(row?.model ? { model: row.model } : {}),
        ...(status === 'running' && row?.currentTool ? { currentTool: row.currentTool } : {}),
        toolCount: row?.toolCount ?? 0,
        ...(row?.turnCount !== undefined ? { turnCount: row.turnCount } : {}),
        durationMs: row?.durationMs ?? 0,
        ...(row?.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
        ...(row?.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
        finalOutput: row?.finalOutput ?? '',
        error: row?.error ?? '',
      };
    });
  return { type: 'subagent', children: cards, truncated: clamp.truncated };
}
