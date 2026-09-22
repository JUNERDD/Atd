import { vi } from 'vitest';
import { DEFAULT_SHORTCUTS, type SettingsSnapshot } from '../electron/settings-contract';
import type { AgentBridge, AgentEvent, AgentSnapshot, TaskDetail } from '../electron/agent/bridge';
import { initialCommands } from '../electron/agent/command-templates';
import { emptyInput, type RunStatus } from '../electron/agent/task-schema';
import type { PermissionRequest } from '../electron/agent/permission-schema';
import type { QueueState } from '../electron/agent/transcript-schema';
import type { ModelThinkingLevel } from '../electron/providers/schema';

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
    shortcutAvailable: true,
    permissionTier: 'manual',
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
            },
          ]
        : [];
      detail = {
        task,
        artifacts: [],
        requests: extras?.requests ?? [],
        queue: extras?.queue ?? { steering: [], followUp: [] },
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
    stop: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    queueMessage: vi.fn(async () => {}),
    replaceQueue: vi.fn(async () => {}),
    setPermissionTier: vi.fn(async () => {}),
    renameTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    chooseFiles: vi.fn(async () => []),
    artifact: vi.fn(async () => null),
    copy: vi.fn(async () => {}),
    openLink: vi.fn(async () => {}),
    memory: vi.fn(async () => ({ entries: [], paused: false, error: '' })),
    pauseMemory: vi.fn(async (paused) => ({ entries: [], paused, error: '' })),
    updateMemory: vi.fn(async () => ({ entries: [], paused: false, error: '' })),
    importLegacy: vi.fn(async () => {}),
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
    show: vi.fn(async () => {}),
    hide,
    chooseFiles: vi.fn(async () => []),
    settings: {
      open,
      openCommand,
      startCommandSession: vi.fn(async (_commandId: string | null) => {}),
      startExtensionSession: vi.fn(async (_kind: 'skill' | 'subagent' | 'mcp') => {}),
      close: vi.fn(async () => {}),
      get: vi.fn(async () => settings),
      providers: {
        catalog: vi.fn(async () => []),
        save: vi.fn(async () => settings.connections[0]!),
        setDefault: vi.fn(async () => {}),
        setModel: vi.fn(async () => {}),
        levels: vi.fn(async (): Promise<ModelThinkingLevel[]> => ['off', 'low', 'high']),
        disconnect: vi.fn(async () => {}),
        refresh: vi.fn(async () => {}),
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
