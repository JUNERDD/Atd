import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { SettingsWindow } from './features/settings/settings-window';
import { DEFAULT_SHORTCUTS, type SettingsSnapshot } from '../electron/settings-contract';
import { loadState } from './lib/task-store';

describe('task panel', () => {
  it('starts with the Figma empty state and disallows a whitespace-only task', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send task' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Task prompt' }), '   ');
    expect(screen.getByRole('button', { name: 'Send task' })).toBeDisabled();
  });

  it('saves a task with Enter, clears the composer, and reopens it from history', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'Plan my afternoon{Enter}');
    expect(screen.getByRole('heading', { name: 'Task saved' })).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(loadState().tasks[0]?.prompt).toBe('Plan my afternoon');
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    await user.click(screen.getByRole('button', { name: /Plan my afternoon/ }));
    expect(screen.getByText('Plan my afternoon')).toBeVisible();
    expect(screen.getByText('Saved on this device.')).toBeVisible();
  });

  it('allows multiline input and never submits while an IME composition is active', async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = screen.getByRole('textbox');
    await user.type(input, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(input).toHaveValue('Line one\nLine two');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true });
    expect(loadState().tasks).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Task saved' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    await user.click(screen.getByRole('button', { name: 'Open task panel' }));
    expect(screen.getByRole('textbox')).toHaveValue('A work in progress');
  });

  it('supports attachments, removal and the six-file limit', async () => {
    const user = userEvent.setup();
    render(<App />);
    const files = Array.from(
      { length: 7 },
      (_, index) => new File(['context'], `file-${index}.txt`, { type: 'text/plain' }),
    );
    await user.upload(screen.getByLabelText('Choose context files'), files);
    expect(screen.getByRole('status')).toHaveTextContent('You can attach up to 6 files.');
    expect(screen.queryByText('file-6.txt')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove file-0.txt' }));
    await user.click(screen.getByRole('button', { name: 'Send task' }));
    expect(loadState().tasks[0]?.attachments).toHaveLength(5);
    expect(loadState().tasks[0]?.attachments[0]?.name).toBe('file-1.txt');
  });

  it('uses the isolated desktop bridge for pinning and hiding', async () => {
    const user = userEvent.setup();
    let snapshot: SettingsSnapshot = {
      provider: { id: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false },
      shortcuts: { ...DEFAULT_SHORTCUTS },
      account: { name: 'Test user', kind: 'local' },
      pinned: true,
      shortcutAvailable: true,
    };
    const listeners = new Set<(settings: SettingsSnapshot) => void>();
    const setPinned = vi.fn(async (pinned: boolean) => {
      snapshot = { ...snapshot, pinned };
      listeners.forEach((listener) => listener(snapshot));
      return pinned;
    });
    const hide = vi.fn(async () => {});
    window.desktop = {
      platform: 'darwin',
      getState: vi.fn(async () => ({
        pinned: true,
        shortcut: '⌘ ⇧ Space',
        shortcutAvailable: true,
      })),
      setPinned,
      hide,
      chooseFiles: vi.fn(async () => []),
      settings: {
        open: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        get: vi.fn(async () => snapshot),
        saveProvider: vi.fn(async () => snapshot),
        testProvider: vi.fn(async () => ({ models: [] })),
        saveShortcuts: vi.fn(async () => snapshot),
        restoreShortcuts: vi.fn(async () => snapshot),
        onChange: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    };
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.desktop.settings.open).toHaveBeenCalledOnce();
    const settingsView = render(<SettingsWindow />);
    await user.click(await screen.findByRole('tab', { name: 'Shortcuts' }));
    await user.click(screen.getByRole('switch', { name: 'Always on top' }));
    await waitFor(() => expect(setPinned).toHaveBeenLastCalledWith(false));
    expect(loadState().pinned).toBe(false);
    settingsView.unmount();
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(hide).toHaveBeenCalledOnce();
  });
});
