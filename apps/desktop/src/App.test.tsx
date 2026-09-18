import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { installBridge } from '../tests/app-test-bridge';
import { SettingsWindow } from './features/settings/settings-window';

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
    await user.click(screen.getByRole('button', { name: /Plan my afternoon.*starting/ }));
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
    expect(await screen.findByRole('status')).toHaveTextContent('Attach at most 10 files.');
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
    // macOS dismisses the panel through the native traffic lights, so Escape is the only
    // renderer-side path to the hide bridge.
    expect(screen.queryByRole('button', { name: 'Hide panel' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(hide).toHaveBeenCalledOnce();
  });

  it('opens the settings editor for the prepared command', async () => {
    const { openCommand } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Translate selection/ }));
    await user.click(await screen.findByRole('button', { name: 'Command settings' }));
    await waitFor(() => expect(openCommand).toHaveBeenCalledWith('translate'));
  });

  it('deep-links the settings window to one command editor', async () => {
    installBridge();
    const previousHash = window.location.hash;
    window.location.hash = '#settings?commandId=translate';
    try {
      render(<SettingsWindow />);
      expect(await screen.findByDisplayValue('Translate selection')).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Edit command' })).toBeVisible();
    } finally {
      window.location.hash = previousHash;
    }
  });

  it('queues a follow-up with Enter while a run is active', async () => {
    const { api } = installBridge({ status: 'running' });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'Plan my afternoon{Enter}');
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    await user.type(screen.getByRole('textbox'), 'Also buy milk{Enter}');
    await waitFor(() =>
      expect(api.queueMessage).toHaveBeenCalledWith('test-task', 'Also buy milk', 'followUp'),
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('answers a pending input request from the composer', async () => {
    const { api } = installBridge({
      status: 'running',
      requests: [
        {
          kind: 'input',
          id: 'req-1',
          taskId: 'test-task',
          runId: 'test-run',
          toolCallId: 'call-1',
          title: 'What is the name?',
          options: [],
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'Plan my afternoon{Enter}');
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    await user.type(screen.getByRole('textbox'), 'Ada{Enter}');
    await waitFor(() =>
      expect(api.answer).toHaveBeenCalledWith('test-task', 'test-run', 'req-1', { answer: 'Ada' }),
    );
  });

  it('shows the permission-tier control on a task view', async () => {
    const { api } = installBridge();
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox'), 'Plan my afternoon{Enter}');
    await waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Permission level' })).toBeEnabled();
  });
});
