import { Value } from 'typebox/value';
import {
  ToolBlockDetailsSchema,
  type AgentTask as ServiceTask,
  type CapabilityRequest as ServiceCapability,
  type PermissionRequest as ServiceRequest,
  type ServiceBlock,
  type TaskContextState,
  type TaskRun as ServiceRun,
  type TaskSnapshot as ServiceSnapshot,
  type TaskSummary as ServiceSummary,
  type MessageUsage,
  type ToolBlockDetails,
} from '@ai/agent-contracts';
import type { ToolId } from './command-schema';
import type { AgentTask, FileRef, RunSnapshot, TaskInput, TaskRun } from './task-schema';
import type { PermissionRequest } from './permission-schema';
import type { AssistantUsage, Block, QueueState, ToolDetails } from './transcript-schema';
import type { TaskDetail } from './bridge';

const DESKTOP_TOOL_IDS: ReadonlySet<string> = new Set<ToolId>([
  'read',
  'write',
  'edit',
  'bash',
  'command',
]);

/** A task's desktop state without its session: what the task list and pending prompts need. */
export interface TaskSummaryState {
  task: AgentTask;
  requests: PermissionRequest[];
  queue: QueueState;
  capabilities: NonNullable<TaskDetail['capabilities']>;
}

/** A task's session as the desktop shows it: its transcript and context usage. */
export interface TaskTranscript {
  revision: number;
  blocks: Block[];
  context: TaskContextState;
}

/** Maps a service task summary (or the summary part of a snapshot) to the desktop shape. */
export function mapSummary(summary: ServiceSummary): TaskSummaryState {
  return {
    task: mapTask(summary.task),
    requests: summary.requests.map(mapRequest),
    queue: { ...summary.queue },
    capabilities: summary.capabilities.map((cap) => ({
      id: cap.id,
      capability: cap.capability,
      runId: cap.runId,
      executionId: cap.executionId,
      expiresAt: cap.expiresAt,
    })),
  };
}

/** Maps the session part of a service task snapshot (no Pi projection). */
export function mapTranscript(snapshot: ServiceSnapshot): TaskTranscript {
  return {
    revision: snapshot.revision,
    blocks: snapshot.blocks.map(mapBlock),
    context: { ...snapshot.context },
  };
}

/** The detail a consumer seeds from: the summary plus the transcript. */
export function taskDetail(summary: TaskSummaryState, transcript: TaskTranscript): TaskDetail {
  const { task, requests, queue, capabilities } = summary;
  return { task, artifacts: [], requests, queue, capabilities, ...transcript };
}

export function mapTask(task: ServiceTask): AgentTask {
  return {
    id: task.id,
    title: task.title,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    sessionFile: task.sessionFile,
    runs: task.runs.map(mapRun),
    legacy: null,
    ...(task.permissionTier ? { permissionTier: task.permissionTier } : {}),
  };
}

function mapRun(run: ServiceRun): TaskRun {
  return {
    id: run.id,
    invocationId: run.operationId,
    createdAt: run.createdAt,
    status: run.status,
    error: run.error,
    snapshot: mapRunSnapshot(run),
  };
}

function mapRunSnapshot(run: ServiceRun): RunSnapshot {
  const input: TaskInput = {
    text: run.snapshot.input.text,
    source: run.snapshot.input.source,
    capturedAt: run.snapshot.input.capturedAt,
    selection: run.snapshot.input.selection,
    clipboard: run.snapshot.input.clipboard,
    files: run.snapshot.input.files.map((file): FileRef => ({
      id: file.id,
      name: file.name,
      size: file.size,
      type: file.type,
    })),
    arguments: { ...run.snapshot.input.arguments },
    ...(run.snapshot.input.chips ? { chips: structuredClone(run.snapshot.input.chips) } : {}),
  };
  return {
    command: null,
    definition: 'current',
    input,
    instructions: run.snapshot.instructions,
    model: {
      connectionId: run.snapshot.model.connectionId,
      modelId: run.snapshot.model.modelId,
      provider: run.snapshot.model.provider,
      baseUrl: run.snapshot.model.baseUrl,
    },
    ...(run.snapshot.thinkingLevel ? { thinkingLevel: run.snapshot.thinkingLevel } : {}),
    // The desktop run snapshot lists command-policy tools only; grep/find/ls and ask_user are
    // service-side snapshot tools without a desktop policy entry.
    tools: run.snapshot.tools.filter((tool): tool is ToolId => DESKTOP_TOOL_IDS.has(tool)),
    memory: run.snapshot.memory,
  };
}

export function mapRequest(request: ServiceRequest): PermissionRequest {
  if (request.kind === 'confirmation') {
    return {
      kind: 'confirmation',
      id: request.id,
      taskId: request.taskId,
      runId: request.runId,
      toolCallId: request.toolCallId,
      executionId: request.executionId,
      scope: request.scope,
      title: request.title,
      detail: request.detail,
      ...(request.allowlistEntry ? { allowlistEntry: request.allowlistEntry } : {}),
      ...(request.review ? { review: request.review } : {}),
    };
  }
  return {
    kind: 'input',
    id: request.id,
    taskId: request.taskId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    executionId: request.executionId,
    title: request.title,
    options: [...request.options],
  };
}

/**
 * Splits service tool details into the desktop shape: the edit diff keeps its dedicated `diff`
 * field, every other variant rides in `data`. Service events reach main as unchecked JSON, so
 * details that fail the contract are dropped here and the row falls back to its output text.
 */
function mapToolDetails(details: ToolBlockDetails | undefined): ToolDetails {
  const none: ToolDetails = { diff: '', truncated: false, fullOutputPath: '' };
  if (details === undefined || !Value.Check(ToolBlockDetailsSchema, details)) return none;
  if (details.type === 'diff') return { ...none, diff: details.diff, truncated: details.truncated };
  return { ...none, data: details };
}

/** The message's usage as the desktop keeps it; the service measures no generation time. */
function mapUsage(usage: MessageUsage | undefined): { usage?: AssistantUsage } {
  return usage ? { usage: { ...usage } } : {};
}

export function mapBlock(block: ServiceBlock): Block {
  const base = {
    id: block.id,
    runId: block.runId,
    timestamp: block.timestamp,
    endedAt: block.endedAt,
  };
  switch (block.kind) {
    case 'user':
      return {
        kind: 'user',
        ...base,
        text: block.text,
        ...(block.prompt ? { prompt: true } : {}),
        ...(block.entryId ? { entryId: block.entryId } : {}),
      };
    case 'assistant':
      return {
        kind: 'assistant',
        ...base,
        text: block.text,
        streaming: block.streaming,
        stopReason: block.stopReason,
        error: block.error,
        ...mapUsage(block.usage),
      };
    case 'thinking':
      return {
        kind: 'thinking',
        ...base,
        text: block.text,
        streaming: block.streaming,
        redacted: block.redacted,
        durationMs: null,
        ...mapUsage(block.usage),
      };
    case 'tool':
      return {
        kind: 'tool',
        ...base,
        callId: block.callId,
        name: block.name,
        args: { ...(block.args as Record<string, unknown>) },
        status: block.status,
        output: block.output,
        partial: block.partial,
        details: mapToolDetails(block.details),
        permission: block.permission
          ? { scope: block.permission.scope, outcome: block.permission.outcome }
          : null,
        ...mapUsage(block.usage),
      };
    case 'question':
      return {
        kind: 'question',
        ...base,
        callId: block.callId,
        title: block.title,
        options: [...block.options],
        status: block.status,
        answer: block.answer,
        skipped: block.skipped,
        ...mapUsage(block.usage),
      };
    case 'system':
      return { kind: 'system', ...base, level: block.level, text: block.text };
    case 'compaction':
      return {
        kind: 'compaction',
        ...base,
        status: block.status,
        reason: block.reason,
        summary: block.summary,
        tokensBefore: block.tokensBefore,
        tokensAfter: block.tokensAfter,
        error: block.error,
      };
    default: {
      const _exhaustive: never = block;
      throw new Error(`Unsupported service block: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export function mapQueue(queue: QueueState): QueueState {
  return { steering: [...queue.steering], followUp: [...queue.followUp] };
}

export function serviceCapabilityId(cap: ServiceCapability): string {
  return `${cap.capability}:${cap.id}`;
}
