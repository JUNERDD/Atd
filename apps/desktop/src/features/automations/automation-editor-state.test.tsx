import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AutomationItem, FolderRef } from '@atd/agent-contracts';
import { installBridge } from '../../../tests/app-test-bridge';
import {
  automationItem,
  fakeAutomations,
  installAutomations,
  systemZone,
} from '../../../tests/automation-fixtures';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { AutomationConflictError } from '../../client/automations-contract';
import type { ImportFailure } from '../../client/contract';
import { SettingsWindow } from '../settings/settings-window';

function renderSettings(
  automations: ReturnType<typeof fakeAutomations>,
  section = 'automations',
  commands?: (list: CommandDefinition[]) => CommandDefinition[],
) {
  const { api } = installBridge();
  if (commands) {
    const get = api.get;
    api.get = async () => {
      const snapshot = await get();
      return { ...snapshot, commands: commands(snapshot.commands) };
    };
  }
  installAutomations(automations);
  localStorage.setItem('settings.lastSection', section);
  render(<SettingsWindow />);
}

/** Saving `saved` with a new name meets a conflict; Reload brings `latest`. */
async function reloadAfterConflict(saved: AutomationItem, latest: AutomationItem) {
  const automations = fakeAutomations([saved]);
  automations.update.mockRejectedValueOnce(new AutomationConflictError('Changed.'));
  automations.get.mockResolvedValueOnce(latest);
  renderSettings(automations);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Edit ${saved.automation.name}` }));
  await user.type(await screen.findByRole('textbox', { name: 'Name' }), '!');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await user.click(await screen.findByRole('button', { name: 'Reload latest version' }));
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(saved.automation.name),
  );
  return { automations, user };
}

describe('automation editor state', () => {
  it('shows the reloaded interval, and saves it, after a conflict', async () => {
    const every = (everyMinutes: number, revision: number) =>
      automationItem({
        id: 'every',
        name: 'Every hour',
        revision,
        trigger: {
          kind: 'schedule',
          schedule: { kind: 'interval', everyMinutes },
          timezone: systemZone,
        },
      });
    const { automations, user } = await reloadAfterConflict(every(60, 1), every(180, 2));
    expect(screen.getByRole('spinbutton', { name: 'Every' })).toHaveValue(3);
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('Hours');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' (3h)');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(automations.update).toHaveBeenCalledTimes(2));
    expect(automations.update.mock.calls[1]?.[2].trigger).toMatchObject({
      schedule: { kind: 'interval', everyMinutes: 180 },
    });
  });

  it('keeps the reloaded file patterns instead of the ones shown before', async () => {
    const inbox = (patterns: string[], revision: number) =>
      automationItem(
        {
          id: 'inbox',
          name: 'Inbox folder',
          revision,
          trigger: {
            kind: 'folder',
            folderId: 'f1',
            events: ['added'],
            patterns,
            recursive: false,
          },
        },
        { folders: [{ id: 'f1', name: 'Inbox' }] },
      );
    const { automations, user } = await reloadAfterConflict(
      inbox(['*.pdf'], 1),
      inbox(['*.png', '*.jpg'], 2),
    );
    const patterns = screen.getByRole('textbox', { name: 'Only files named' });
    expect(patterns).toHaveValue('*.png, *.jpg');
    await user.type(patterns, ', *.gif');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(automations.update).toHaveBeenCalledTimes(2));
    expect(automations.update.mock.calls[1]?.[2].trigger).toMatchObject({
      patterns: ['*.png', '*.jpg', '*.gif'],
    });
  });

  it('applies a folder pick to the edits made while the open panel was up', async () => {
    const automations = fakeAutomations([]);
    let answer: (value: { folders: FolderRef[]; failures: ImportFailure[] }) => void = () => {};
    automations.pickFolder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New automation' }));
    await user.click(await screen.findByRole('tab', { name: 'Folder' }));
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Invoices');
    await user.type(screen.getByRole('textbox', { name: 'Only files named' }), '*.pdf');
    await act(async () =>
      answer({ folders: [{ id: 'f1', name: 'Inbox', path: '/Users/me/Inbox' }], failures: [] }),
    );
    expect(await screen.findByText('Inbox')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Invoices');
    expect(screen.getByRole('textbox', { name: 'Only files named' })).toHaveValue('*.pdf');
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'File them.');
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    await waitFor(() =>
      expect(automations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Invoices',
          trigger: expect.objectContaining({ folderId: 'f1', patterns: ['*.pdf'] }),
        }),
      ),
    );
  });

  it('asks for a new time instead of turning a finished one-time automation on', async () => {
    const automations = fakeAutomations([
      automationItem(
        {
          id: 'once',
          name: 'Send the report',
          enabled: false,
          trigger: {
            kind: 'schedule',
            schedule: { kind: 'once', at: '2026-01-05T09:00:00+08:00' },
            timezone: 'Asia/Shanghai',
          },
        },
        { pausedReason: 'finished' },
      ),
    ]);
    automations.preview.mockResolvedValue({ nextRuns: [], problem: 'inPast' });
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('switch', { name: 'Turn on Send the report' }));
    expect(await screen.findByRole('heading', { name: 'Edit automation' })).toBeVisible();
    expect(await screen.findByText('That time has already passed.')).toBeVisible();
    expect(automations.setEnabled).not.toHaveBeenCalled();
    // Saving now would only be refused: the time has to change first.
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(automations.update).not.toHaveBeenCalled();
  });

  it('blocks Run now with the row’s reason while the automation cannot run', async () => {
    const automations = fakeAutomations([
      automationItem({ id: 'morning', name: 'Morning brief' }, { problem: 'modelUnavailable' }),
    ]);
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Morning brief' }));
    const run = await screen.findByRole('button', { name: 'Run now' });
    expect(run).toHaveAttribute('aria-disabled', 'true');
    await user.hover(run);
    expect(await screen.findByRole('tooltip', {}, { timeout: 2_000 })).toHaveTextContent(
      'Fix its problem to run it',
    );
    await user.click(run);
    expect(automations.run).not.toHaveBeenCalled();
  });

  it('prefills memory from the automated command’s own setting', async () => {
    renderSettings(fakeAutomations([]), 'commands', (commands) =>
      commands.map((command) =>
        command.id === 'summarize' ? { ...command, memory: 'off' } : command,
      ),
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'More actions for Summarize files' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Automate…' }));
    expect(await screen.findByRole('heading', { name: 'New automation' })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Use memory' })).not.toBeChecked();
  });
});
