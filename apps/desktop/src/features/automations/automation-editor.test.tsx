import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import {
  automationItem,
  fakeAutomations,
  installAutomations,
  systemZone,
} from '../../../tests/automation-fixtures';
import { AutomationConflictError } from '../../client/automations-contract';
import { SettingsWindow } from '../settings/settings-window';

function renderSettings(automations: ReturnType<typeof fakeAutomations>, section = 'automations') {
  installBridge();
  installAutomations(automations);
  localStorage.setItem('settings.lastSection', section);
  return render(<SettingsWindow />);
}

async function openNewAutomation() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New automation' }));
  expect(await screen.findByRole('heading', { name: 'New automation' })).toBeVisible();
  return user;
}

describe('automation editor', () => {
  it('checks the fields before saving a new automation', async () => {
    const automations = fakeAutomations([]);
    renderSettings(automations);
    const user = await openNewAutomation();
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    expect(await screen.findByText('Enter a name.')).toBeVisible();
    expect(screen.getByText('Enter a prompt.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    expect(automations.create).not.toHaveBeenCalled();
    // A fixed field clears at once; the other keeps its problem until it is fixed.
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Morning brief');
    expect(screen.queryByText('Enter a name.')).not.toBeInTheDocument();
    expect(screen.getByText('Enter a prompt.')).toBeVisible();
  });

  it('saves a new prompt automation on the Mac’s time zone and returns to the list', async () => {
    const automations = fakeAutomations([]);
    renderSettings(automations);
    const user = await openNewAutomation();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Morning brief');
    await user.type(screen.getByRole('textbox', { name: 'Prompt' }), 'Summarize my inbox.');
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    await waitFor(() =>
      expect(automations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Morning brief',
          enabled: true,
          trigger: {
            kind: 'schedule',
            schedule: { kind: 'daily', time: '09:00' },
            timezone: systemZone,
          },
          action: { kind: 'prompt', prompt: 'Summarize my inbox.' },
        }),
      ),
    );
    expect(await screen.findByText('Automation saved.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Edit Morning brief' })).toBeVisible();
  });

  it('shows the service’s next run times for the trigger being edited', async () => {
    const automations = fakeAutomations([]);
    automations.preview.mockResolvedValue({
      nextRuns: [
        '2026-10-07T01:00:00.000Z',
        '2026-10-08T01:00:00.000Z',
        '2026-10-09T01:00:00.000Z',
      ],
    });
    renderSettings(automations);
    await openNewAutomation();
    await waitFor(() =>
      expect(automations.preview).toHaveBeenCalledWith({
        trigger: {
          kind: 'schedule',
          schedule: { kind: 'daily', time: '09:00' },
          timezone: systemZone,
        },
        count: 3,
      }),
    );
    const outlook = (await screen.findByText('Next runs')).parentElement;
    if (!outlook) throw new Error('The next runs have no list.');
    expect(within(outlook).getAllByRole('listitem')).toHaveLength(3);
  });

  it('words a trigger the service refuses and does not save it', async () => {
    const automations = fakeAutomations([
      automationItem({
        id: 'often',
        name: 'Every five minutes',
        trigger: {
          kind: 'schedule',
          schedule: { kind: 'cron', expression: '*/5 * * * *' },
          timezone: systemZone,
        },
      }),
    ]);
    automations.preview.mockResolvedValue({ nextRuns: [], problem: 'tooFrequent' });
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Every five minutes' }));
    expect(await screen.findByText('Runs can’t be less than 15 minutes apart.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Cron expression' })).toHaveValue('*/5 * * * *');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(automations.update).not.toHaveBeenCalled();
  });

  it('reloads the latest version after a conflicting save', async () => {
    const automations = fakeAutomations([automationItem({ id: 'morning', name: 'Morning brief' })]);
    automations.update.mockRejectedValueOnce(new AutomationConflictError('Changed.'));
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Morning brief' }));
    const name = await screen.findByRole('textbox', { name: 'Name' });
    await user.type(name, ' daily');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'This automation changed since you opened it. Reload to continue from the latest version.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reload latest version' }));
    expect(automations.get).toHaveBeenCalledWith('morning');
    // The fields start again from the reloaded automation, the name included.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Morning brief'),
    );
  });

  it('automates a command from its row and words what keeps a command from running', async () => {
    renderSettings(fakeAutomations([]), 'commands');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'More actions for Summarize files' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Automate…' }));
    expect(await screen.findByRole('heading', { name: 'New automation' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Summarize files');
    expect(screen.getByRole('tab', { name: 'Command' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Input' })).toBeVisible();
    // It summarizes files, which only a folder trigger hands it.
    const files = /only a folder trigger hands it/;
    expect(screen.getByText(files)).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Folder' }));
    expect(screen.queryByText(files)).not.toBeInTheDocument();
    // The trigger changed, so leaving asks first. A command reading the selection needs someone
    // there, so it is not offered as an automation at all.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const unsaved = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(unsaved).getByRole('button', { name: 'Discard' }));
    await user.click(screen.getByRole('button', { name: 'Commands' }));
    await user.click(
      await screen.findByRole('button', { name: 'More actions for Translate selection' }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Automate…' })).not.toBeInTheDocument();
  });
  it('names saved folders and has one that is no longer available chosen again', async () => {
    const automations = fakeAutomations([
      automationItem(
        {
          id: 'scans',
          name: 'Sort scans',
          trigger: {
            kind: 'folder',
            folderId: 'scans',
            events: ['added'],
            patterns: [],
            recursive: false,
          },
          policy: {
            permissionTier: 'manual',
            memory: true,
            folderIds: ['archive', 'old'],
            maxDurationMinutes: 30,
            missedRuns: 'runOnce',
          },
        },
        // The watched folder and one readable folder are no longer registered.
        { folders: [{ id: 'scans' }, { id: 'archive', name: 'Archive' }, { id: 'old' }] },
      ),
    ]);
    automations.pickFolder.mockResolvedValue({
      folders: [{ id: 'scans-new', name: 'Scans', path: '/Users/me/Scans' }],
      failures: [],
    });
    renderSettings(automations);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit Sort scans' }));
    expect(await screen.findByText('No longer available')).toBeVisible();
    expect(screen.getByText('Archive')).toBeVisible();
    expect(screen.getByText('Folder no longer available')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(
        'A folder here is no longer available. Choose it again or remove it.',
      ),
    ).toBeVisible();
    expect(automations.update).not.toHaveBeenCalled();
    // The watched folder's Choose again comes first; the readable folder's row has its own.
    await user.click(screen.getAllByRole('button', { name: 'Choose again…' })[0]!);
    expect(await screen.findByText('Scans')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Change…' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove Folder no longer available' }));
    expect(
      screen.queryByText('A folder here is no longer available. Choose it again or remove it.'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(automations.update).toHaveBeenCalledWith(
        'scans',
        1,
        expect.objectContaining({
          trigger: expect.objectContaining({ folderId: 'scans-new' }),
          policy: expect.objectContaining({ folderIds: ['archive'] }),
        }),
      ),
    );
  });

  it('saves a memory consolidation that runs once a day when the Mac is idle', async () => {
    const automations = fakeAutomations([]);
    renderSettings(automations);
    const user = await openNewAutomation();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Tidy memory');
    await user.click(screen.getByRole('tab', { name: 'Mac is idle' }));
    expect(screen.getByRole('combobox', { name: 'Idle for' })).toHaveTextContent('15 minutes');
    expect(screen.getByText(/^Runs at most once a day/)).toBeVisible();
    // An idle trigger only fires while Atd is open: there are no missed runs to choose about.
    expect(screen.queryByRole('combobox', { name: 'Missed runs' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Consolidate memory' }));
    expect(screen.getByText(/^Merges duplicate memories/)).toBeVisible();
    expect(screen.getByText(/^Consolidation only works on your memory/)).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /Use memory/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create automation' }));
    await waitFor(() =>
      expect(automations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Tidy memory',
          trigger: { kind: 'idle', idleMinutes: 15, timezone: systemZone },
          action: { kind: 'consolidateMemory' },
        }),
      ),
    );
  });
});
