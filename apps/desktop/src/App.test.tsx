import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SettingsWindow } from './features/settings/settings-window';
import { DEFAULT_SHORTCUTS, type SettingsSnapshot } from '../electron/settings-contract';
import type { AgentBridge, AgentEvent, AgentSnapshot, TaskDetail } from '../electron/agent/bridge';
import { initialCommands } from '../electron/agent/command-templates';
import { emptyInput } from '../electron/agent/task-schema';

function installBridge() {
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
    shortcuts: { ...DEFAULT_SHORTCUTS },
    pinned: true,
    shortcutAvailable: true,
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
        runs: [
          {
            id: 'test-run',
            invocationId: request.invocationId,
            createdAt: now,
            status: 'queued' as const,
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
      detail = { task, messages: [], artifacts: [], request: null };
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
  window.desktop = {
    platform: 'darwin',
    agent: api,
    getState: vi.fn(async () => ({
      pinned: settings.pinned,
      shortcut: '⌘ ⇧ Space',
      shortcutAvailable: true,
    })),
    setPinned,
    hide,
    chooseFiles: vi.fn(async () => []),
    settings: {
      open,
      close: vi.fn(async () => {}),
      get: vi.fn(async () => settings),
      providers: {
        catalog: vi.fn(async () => []),
        save: vi.fn(async () => settings.connections[0]!),
        setDefault: vi.fn(async () => {}),
        setModel: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
        refresh: vi.fn(async () => {}),
        verify: vi.fn(async () => {}),
        login: vi.fn(async () => {
          throw new Error('Not used');
        }),
        answer: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
        openLink: vi.fn(async () => {}),
        onLogin: () => () => {},
      },
      generation: {
        generate: vi.fn(async () => ({ status: 'stopped' as const, message: 'Stopped' })),
        cancel: vi.fn(async () => {}),
      },
      saveShortcuts: vi.fn(async () => settings),
      restoreShortcuts: vi.fn(async () => settings),
      onChange: (listener) => {
        settingsListeners.add(listener);
        return () => {
          settingsListeners.delete(listener);
        };
      },
    },
  };
  return { api, setPinned, hide, open };
}

describe('task panel', () => {
  it('starts with the Figma empty state and disallows a whitespace-only task', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send task' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Task prompt' }), '   ');
    expect(screen.getByRole('button', { name: 'Send task' })).toBeDisabled();
  });

  it('submits through the Agent bridge with Enter, clears the accepted draft, and reopens history', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'Plan my afternoon{Enter}');
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: 'Plan my afternoon' })).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await user.click(screen.getByRole('button', { name: /Plan my afternoon.*queued/ }));
    expect(
      await screen.findByText('Plan my afternoon', { selector: '.message-bubble' }),
    ).toBeVisible();
  });

  it('allows multiline input and never submits while an IME composition is active', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(input).toHaveValue('Line one\nLine two');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(api.submit).not.toHaveBeenCalled();
  });

  it('preserves a draft while viewing history, settings, and hiding the web preview', async () => {
    const user = userEvent.setup();
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockReturnValue(window);
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'A work in progress');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(open).toHaveBeenCalledWith(expect.any(URL), 'ai-settings', 'width=1000,height=720');
    expect(focus).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    await user.click(screen.getByRole('button', { name: 'Open task panel' }));
    expect(screen.getByRole('textbox')).toHaveValue('A work in progress');
  });

  it('uses persistent attachment IDs, allows removal, and rejects more than ten files', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    const files = Array.from({ length: 11 }, (_, index) => ({
      id: `file-${index}`,
      name: `file-${index}.txt`,
      size: 7,
      type: 'text/plain',
    }));
    vi.mocked(api.chooseFiles)
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce(files.slice(0, 2));
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Attach context' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attach at most 10 files.');
    await user.click(screen.getByRole('button', { name: 'Attach context' }));
    await user.click(await screen.findByRole('button', { name: 'Remove file-0.txt' }));
    await user.click(screen.getByRole('button', { name: 'Send task' }));
    expect(api.submit).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ files: [files[1]] }) }),
    );
  });

  it('uses the isolated desktop bridge for pinning and hiding', async () => {
    const { open, setPinned, hide } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(open).toHaveBeenCalledOnce();
    const settingsView = render(<SettingsWindow />);
    await user.click(await screen.findByRole('button', { name: 'Shortcuts' }));
    await user.click(screen.getByRole('switch', { name: 'Always on top' }));
    await waitFor(() => expect(setPinned).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('switch', { name: 'Always on top' })).not.toBeChecked();
    settingsView.unmount();
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(hide).toHaveBeenCalledOnce();
  });
});
