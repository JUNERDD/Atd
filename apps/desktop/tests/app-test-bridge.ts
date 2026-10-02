import { vi } from 'vitest';
import { DEFAULT_SHORTCUTS } from '@ai/agent-contracts';
import type { SettingsSnapshot } from '../src/client/settings-contract';
import type {
  AgentBridge,
  AgentEvent,
  AgentSnapshot,
  TaskDetail,
} from '../src/client/agent/bridge';
import { initialCommands } from '../src/client/agent/command-templates';
import { emptyInput, type RunStatus } from '../src/client/agent/task-schema';
import type { PermissionRequest } from '../src/client/agent/permission-schema';
import type { QueueState } from '../src/client/agent/transcript-schema';
import type { ModelThinkingLevel } from '../src/client/providers/schema';

/** Desktop bridge used by `App.test.tsx`; keep the TaskDetail shape aligned with the frozen contract. */
export function installBridge(extras?: {
  status?: RunStatus;
  requests?: PermissionRequest[];
  queue?: QueueState;
}) {
  let settings: SettingsSnapshot = {
    connections: [
      {
        connectionId: 'test',
        revision: 1,
        provider: 'openai',
        name: 'OpenAI API',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'api_key',
        defaultModel: 'test-model',
        connected: true,
        hasCredential: true,
        options: {},
        customModels: [],
        catalog: [],
        catalogError: '',
        verifiedModel: '',
      },
    ],
    defaultConnectionId: 'test',
    language: 'en',
    shortcuts: { ...DEFAULT_SHORTCUTS },
    pinned: true,
    showInDock: false,
    openAtLogin: null,
    shortcutAvailable: true,
    permissionTier: 'manual',
    shellAllowlist: [],
  };
  const settingsListeners = new Set<(value: SettingsSnapshot) => void>();
  const listeners = new Set<(event: AgentEvent) => void>();
  const snapshot: AgentSnapshot = {
    revision: 1,
    connectionId: 'test',
    commands: initialCommands(),
    tasks: [],
    shortcutErrors: {},
    error: '',
  };
  let detail: TaskDetail | null = null;
  const api: AgentBridge = {
    get: vi.fn(async () => structuredClone(snapshot)),
    detail: vi.fn(async () => {
      if (!detail) throw new Error('Missing task');
      return structuredClone(detail);
    }),
    submit: vi.fn(async (request) => {
      const now = new Date().toISOString();
      const task = {
        id: 'test-task',
        title: request.input.text || 'Attached context',
        createdAt: now,
        updatedAt: now,
        sessionFile: null,
        legacy: null,
        permissionTier: 'manual' as const,
        runs: [
          {
            id: 'test-run',
            invocationId: request.invocationId,
            createdAt: now,
            status: extras?.status ?? ('queued' as const),
            error: '',
            snapshot: {
              command: null,
              definition: 'current' as const,
              input: request.input,
              instructions: '',
              model: {
                connectionId: 'test',
                modelId: 'test-model',
                provider: 'openai' as const,
                baseUrl: 'https://api.openai.com/v1',
              },
              tools: [],
              memory: true,
            },
          },
        ],
      };
      snapshot.tasks = [task];
      snapshot.revision++;
      const blocks: TaskDetail['blocks'] = request.input.text
        ? [
            {
              kind: 'user',
              id: 'u:1:0',
              runId: 'test-run',
              timestamp: 0,
              endedAt: 0,
              text: request.input.text,
              prompt: true,
            },
          ]
        : [];
      detail = {
        task,
        artifacts: [],
        requests: extras?.requests ?? [],
        queue: extras?.queue ?? { steering: [], followUp: [] },
        context: {
          contextWindow: null,
          tokens: null,
          percent: null,
          compactions: 0,
          compacting: false,
        },
        revision: 0,
        blocks,
      };
      listeners.forEach((listener) =>
        listener({ type: 'snapshot', snapshot: structuredClone(snapshot) }),
      );
      return structuredClone(detail);
    }),
    prepare: vi.fn(async () => ({
      command: initialCommands()[0]!,
      input: emptyInput(),
      notice: '',
    })),
    preview: vi.fn(async () => {
      throw new Error('Not used by this interaction');
    }),
    capture: vi.fn(async () => ({ text: '', capturedAt: '' })),
    saveCommand: vi.fn(async (command) => command),
    deleteCommand: vi.fn(async () => {}),
    launch: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ steering: [], followUp: [] })),
    answer: vi.fn(async () => {}),
    queueMessage: vi.fn(async () => {}),
    replaceQueue: vi.fn(async () => {}),
    setPermissionTier: vi.fn(async () => {}),
    renameTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    compactTask: vi.fn(async () => null),
    contextBreakdown: vi.fn(async () => ({
      contextWindow: null,
      usedTokens: 0,
      estimated: true,
      autocompactBuffer: 0,
      categories: [],
    })),
    forkTask: vi.fn(async () => ({ taskId: 'test-fork' })),
    chooseFiles: vi.fn(async () => []),
    saveMarkdown: vi.fn(async () => true),
    artifact: vi.fn(async () => null),
    copy: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    memory: vi.fn(async () => ({ entries: [], paused: false, error: '' })),
    pauseMemory: vi.fn(async (paused) => ({ entries: [], paused, error: '' })),
    updateMemory: vi.fn(async () => ({ entries: [], paused: false, error: '' })),
    childTranscript: vi.fn(async (taskId, childKey) => ({
      taskId,
      childKey,
      revision: 0,
      live: false,
      blocks: [],
    })),
    releaseChildTranscript: vi.fn(async () => {}),
    onLaunch: () => () => {},
    onCommandSession: () => () => {},
    onExtensionSession: () => () => {},
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const setPinned = vi.fn(async (pinned: boolean) => {
    settings = { ...settings, pinned };
    settingsListeners.forEach((listener) => listener(settings));
    return pinned;
  });
  const setShowInDock = vi.fn(async (showInDock: boolean) => {
    settings = { ...settings, showInDock };
    settingsListeners.forEach((listener) => listener(settings));
    return showInDock;
  });
  const hide = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  const openCommand = vi.fn(async (_commandId: string) => {});
  window.desktop = {
    platform: 'darwin',
    agent: api,
    getState: vi.fn(async () => ({
      pinned: settings.pinned,
      shortcut: '⌘ ⇧ Space',
      shortcutAvailable: true,
    })),
    setPinned,
    setShowInDock,
    setOpenAtLogin: vi.fn(async (_open: boolean) => false),
    show: vi.fn(async () => {}),
    hide,
    chooseFiles: vi.fn(async () => []),
    screenshot: vi.fn(async () => null),
    editScreenshot: vi.fn(async () => null),
    resource: vi.fn(async () => new Blob()),
    settings: {
      open,
      openCommand,
      startCommandSession: vi.fn(async (_commandId: string | null) => {}),
      startExtensionSession: vi.fn(
        async (_kind: 'skill' | 'subagent' | 'mcp' | 'memory', _target?: string | null) => {},
      ),
      close: vi.fn(async () => {}),
      get: vi.fn(async () => settings),
      providers: {
        catalog: vi.fn(async () => []),
        save: vi.fn(async () => settings.connections[0]!),
        setDefault: vi.fn(async () => {}),
        setModel: vi.fn(async () => {}),
        levels: vi.fn(async (): Promise<ModelThinkingLevel[]> => ['off', 'low', 'high']),
        contexts: vi.fn(async () => ({ options: [], defaultTier: null, selected: null })),
        setContext: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        refresh: vi.fn(async () => {}),
        refreshCatalogs: vi.fn(async () => {}),
        verify: vi.fn(async () => {}),
        login: vi.fn(async () => Promise.reject(new Error('Not used'))),
        answer: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
        openLink: vi.fn(async () => {}),
        onLogin: () => () => {},
      },
      setLanguage: vi.fn(async (language: SettingsSnapshot['language']) => {
        settings = { ...settings, language };
        settingsListeners.forEach((listener) => listener(settings));
        return settings;
      }),
      saveShortcuts: vi.fn(async () => settings),
      restoreShortcuts: vi.fn(async () => settings),
      setPermissionTier: vi.fn(async (tier) => {
        settings = { ...settings, permissionTier: tier };
        settingsListeners.forEach((listener) => listener(settings));
        return settings;
      }),
      saveShellAllowlist: vi.fn(async (entries: string[]) => {
        settings = { ...settings, shellAllowlist: [...entries] };
        settingsListeners.forEach((listener) => listener(settings));
        return settings;
      }),
      addShellAllowlistEntry: vi.fn(async (entry: string) => {
        if (!settings.shellAllowlist.includes(entry))
          settings = { ...settings, shellAllowlist: [...settings.shellAllowlist, entry] };
        settingsListeners.forEach((listener) => listener(settings));
        return settings;
      }),
      onChange: (listener) => {
        settingsListeners.add(listener);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onOpenCommand: () => () => {},
    },
  };
  return { api, setPinned, hide, open, openCommand };
}
