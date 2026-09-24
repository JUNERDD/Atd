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

/**
 * One settled row per structured tool body (todo, edit diff, web search/fetch) plus the
 * read-style grep/find/ls rows, with long values that exercise truncation at narrow widths.
 * Render them through `makeDetail({ blocks: [userBlock(), ...toolDetailFixtures()] })`.
 */
export function toolDetailFixtures(): BlockOf<'tool'>[] {
  const settled = (id: string, name: string, args: Record<string, unknown>, output = 'ok') =>
    toolBlock({ id: `tool:${id}`, callId: id, name, args, output });
  const longSubject =
    'Update the settings window navigation so the drawer keeps focus while it is open and closes after navigation';
  return [
    {
      ...settled('todo-1', 'todo', { action: 'update', id: 2, status: 'in_progress' }),
      details: {
        ...DETAILS,
        data: {
          type: 'todo',
          truncated: false,
          tasks: [
            { id: 1, subject: 'Read the plan', status: 'completed', blockedBy: [] },
            {
              id: 2,
              subject: longSubject,
              status: 'in_progress',
              activeForm: 'Updating the settings navigation',
              blockedBy: [],
            },
            { id: 3, subject: 'Run the smoke suite', status: 'pending', blockedBy: [1, 2] },
            { id: 4, subject: 'Dropped idea', status: 'deleted', blockedBy: [] },
          ],
        },
      },
    },
    {
      ...settled('edit-1', 'edit', { path: 'src/features/settings/settings-window.tsx' }),
      details: {
        ...DETAILS,
        diff: '  9 import { Drawer } from "./drawer";\n-10 const open = false;\n+10 const [open, setOpen] = useState(false);\n 11 \n   ...',
      },
    },
    {
      ...settled('search-1', 'web_search', { query: 'electron vibrancy transparent window' }),
      details: {
        ...DETAILS,
        data: {
          type: 'webSearch',
          queries: ['electron vibrancy transparent window'],
          provider: 'duckduckgo',
          truncated: false,
          results: [
            {
              title: 'BrowserWindow | Electron',
              url: 'https://www.electronjs.org/docs/latest/api/browser-window#new-browserwindowoptions-with-a-very-long-anchor',
              snippet:
                'Create and control browser windows. vibrancy sets the window vibrancy effect on macOS.',
            },
          ],
        },
      },
    },
    {
      ...settled('fetch-1', 'fetch_content', {
        urls: ['https://example.com', 'https://bad.example'],
      }),
      details: {
        ...DETAILS,
        data: {
          type: 'webFetch',
          truncated: true,
          pages: [
            {
              url: 'https://example.com',
              title: 'Example Domain',
              excerpt: 'This domain is for use in examples.',
              length: 1256,
            },
            { url: 'https://bad.example', title: '', excerpt: '', length: 0, error: 'HTTP 404' },
          ],
        },
      },
    },
    settled('grep-1', 'grep', { pattern: 'useLivePhasePin', path: 'src' }, 'src/a.tsx:12: x'),
    settled('find-1', 'find', { pattern: '**/*.test.tsx' }, 'src/a.test.tsx'),
    settled('ls-1', 'ls', { path: 'src/features/agent' }, 'transcript/\nagent.css'),
  ];
}
