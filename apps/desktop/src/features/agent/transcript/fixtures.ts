import { vi } from 'vitest';
import type { AgentBridge, TaskDetail } from '../../../../electron/agent/bridge';
import type { DesktopBridge } from '../../../../electron/contract';
import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import { emptyInput, type RunStatus, type TaskRun } from '../../../../electron/agent/task-schema';
import {
  EMPTY_QUEUE,
  type Block,
  type BlockOf,
  type ToolDetails,
} from '../../../../electron/agent/transcript-schema';

const DETAILS: ToolDetails = { diff: '', truncated: false, fullOutputPath: '' };

export function baseRun(status: RunStatus = 'completed', error = ''): TaskRun {
  return {
    id: 'run-1',
    invocationId: 'inv-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    error,
    snapshot: {
      command: null,
      definition: 'current',
      input: { ...emptyInput(), text: 'Do the work' },
      instructions: 'Do the work',
      model: {
        connectionId: 'c1',
        modelId: 'm1',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      },
      tools: ['read', 'edit', 'bash'],
      memory: true,
    },
  };
}

/** The run's prompt, flagged as the service flags the first user message after an invocation. */
export function userBlock(text = 'Do the work'): BlockOf<'user'> {
  return {
    kind: 'user',
    id: 'u:1:0',
    runId: 'run-1',
    timestamp: 1,
    endedAt: 1,
    text,
    prompt: true,
  };
}

export function assistantBlock(
  overrides: Partial<BlockOf<'assistant'>> = {},
): BlockOf<'assistant'> {
  return {
    kind: 'assistant',
    id: 'a:4:0',
    runId: 'run-1',
    timestamp: 4,
    endedAt: 4,
    text: 'Done.',
    streaming: false,
    stopReason: 'stop',
    error: '',
    ...overrides,
  };
}

export function thinkingBlock(overrides: Partial<BlockOf<'thinking'>> = {}): BlockOf<'thinking'> {
  return {
    kind: 'thinking',
    id: 't:2:0',
    runId: 'run-1',
    timestamp: 2,
    endedAt: 2,
    text: 'I should inspect the file first.',
    streaming: false,
    redacted: false,
    durationMs: null,
    ...overrides,
  };
}

export function toolBlock(overrides: Partial<BlockOf<'tool'>> & { id?: string }): BlockOf<'tool'> {
  return {
    kind: 'tool',
    id: overrides.id ?? 'tool:call-1',
    runId: 'run-1',
    timestamp: 3,
    endedAt: 3,
    callId: 'call-1',
    name: 'read',
    args: { path: 'notes.txt' },
    status: 'completed',
    output: 'ok',
    partial: '',
    details: DETAILS,
    permission: null,
    ...overrides,
  };
}

export function questionBlock(overrides: Partial<BlockOf<'question'>> = {}): BlockOf<'question'> {
  return {
    kind: 'question',
    id: 'q:ask-1',
    runId: 'run-1',
    timestamp: 3,
    endedAt: 3,
    callId: 'ask-1',
    title: 'Which style?',
    options: ['Concise', 'Detailed'],
    status: 'running',
    answer: null,
    skipped: false,
    ...overrides,
  };
}

export function makeDetail(options: {
  status?: RunStatus;
  error?: string;
  blocks: Block[];
  requests?: PermissionRequest[];
}): TaskDetail {
  const run = baseRun(options.status ?? 'completed', options.error ?? '');
  return {
    task: {
      id: 'task-1',
      title: 'Do the work',
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      sessionFile: null,
      runs: [run],
      legacy: null,
    },
    artifacts: [],
    requests: options.requests ?? [],
    queue: EMPTY_QUEUE,
    revision: 1,
    blocks: options.blocks,
  };
}

export function installAgent() {
  const answer = vi.fn(async () => {});
  const copy = vi.fn(async () => {});
  const openLink = vi.fn(async () => {});
  window.desktop = {
    platform: 'darwin',
    agent: { answer, copy, openLink } as unknown as AgentBridge,
  } as DesktopBridge;
  return { answer, copy, openLink };
}
