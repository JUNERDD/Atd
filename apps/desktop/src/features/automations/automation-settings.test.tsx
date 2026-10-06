import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import {
  automationItem,
  automationRun,
  automationTask,
  fakeAutomations,
  installAutomations,
  systemZone,
  withTasks,
} from '../../../tests/automation-fixtures';
import type { AgentTask } from '../../client/agent/task-schema';
import { SettingsWindow } from '../settings/settings-window';

/** The list row of the automation named `name`. */
async function row(name: string) {
  const open = await screen.findByRole('button', { name: `Edit ${name}` });
  const item = open.closest('li');
  if (!item) throw new Error(`${name} has no row.`);
  return within(item);
}

function renderAutomations(
  automations: ReturnType<typeof fakeAutomations>,
  tasks: AgentTask[] = [],
) {
  const { api } = installBridge();
  withTasks(api, tasks);
  installAutomations(automations);
  localStorage.setItem('settings.lastSection', 'automations');
  return render(<SettingsWindow />);
}

const items = () => [
  automationItem(
    { id: 'morning', name: 'Morning brief' },
    { nextRunAt: '2026-10-07T01:00:00.000Z', unread: 2 },
  ),
  automationItem(
    {
      id: 'invoices',
      name: 'File invoices',
      trigger: {
        kind: 'folder',
        folderId: 'downloads',
        events: ['added'],
        patterns: ['*.pdf'],
        recursive: false,
      },
    },
    { folders: [{ id: 'downloads', name: 'Downloads' }] },
  ),
  automationItem(
    {
      id: 'scans',
      name: 'Sort scans',
      trigger: {
        kind: 'folder',
        folderId: 'scans',
        events: ['added', 'changed'],
        patterns: [],
        recursive: true,
      },
    },
    // The watched folder is no longer registered: its status names it without a name.
    { folders: [{ id: 'scans' }], problem: 'unknownFolder' },
  ),
  automationItem({
    id: 'weekly',
    name: 'Weekly review',
    enabled: false,
    trigger: {
      kind: 'schedule',
      schedule: { kind: 'weekly', days: [5, 1, 3], time: '17:30' },
      timezone: systemZone,
    },
  }),
];

describe('automations list', () => {
  it('names each trigger in words with the automation’s state', async () => {
    renderAutomations(fakeAutomations(items()));
    const morning = await row('Morning brief');
    expect(morning.getByText(/^Every day at 9:00\sAM$/)).toBeVisible();
    expect(morning.getByText(/^Next run/)).toBeVisible();
    expect(morning.getByText('2 new')).toBeVisible();
    const invoices = await row('File invoices');
    expect(invoices.getByText('When files are added to Downloads, named *.pdf')).toBeVisible();
    const scans = await row('Sort scans');
    expect(
      scans.getByText('When files are added to or change in a folder that’s no longer available'),
    ).toBeVisible();
    expect(
      scans.getByText('The watched folder is no longer available. Choose it again.'),
    ).toBeVisible();
    const weekly = await row('Weekly review');
    expect(weekly.getByText(/^Mon, Wed, & Fri at 5:30\sPM$/)).toBeVisible();
    expect(weekly.getByText('Off · No runs yet')).toBeVisible();
  });

  it('turns automations on and off, runs them, and says why one cannot run', async () => {
    const automations = fakeAutomations(items());
    renderAutomations(automations);
    const user = userEvent.setup();
    await user.click(
      (await row('Weekly review')).getByRole('switch', { name: 'Turn on Weekly review' }),
    );
    await waitFor(() => expect(automations.setEnabled).toHaveBeenCalledWith('weekly', true));
    await user.click(
      (await row('Morning brief')).getByRole('button', { name: 'Run Morning brief now' }),
    );
    expect(automations.run).toHaveBeenCalledWith('morning');
    expect(await screen.findByText('Run started; its task shows in the task panel.')).toBeVisible();
    const blocked = (await row('Sort scans')).getByRole('button', {
      name: 'Run Sort scans now',
    });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await user.click(blocked);
    expect(automations.run).toHaveBeenCalledTimes(1);
  });

  it('deletes an automation after confirming', async () => {
    const automations = fakeAutomations(items());
    renderAutomations(automations);
    const user = userEvent.setup();
    await user.click(
      (await row('Morning brief')).getByRole('button', { name: 'More actions for Morning brief' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Morning brief?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(automations.remove).toHaveBeenCalledWith('morning');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit Morning brief' })).not.toBeInTheDocument(),
    );
  });

  it('pauses every automation from the overview without the switch bouncing back', async () => {
    const automations = fakeAutomations(items());
    // The service answers before it announces the change, as its trailing flush does.
    automations.setPaused.mockImplementationOnce(async () => {});
    renderAutomations(automations);
    const user = userEvent.setup();
    const pause = await screen.findByRole('switch', { name: 'Pause all automations' });
    await user.click(pause);
    expect(automations.setPaused).toHaveBeenCalledWith(true);
    await waitFor(() => expect(pause).not.toHaveAttribute('aria-busy'));
    expect(pause).toBeChecked();
    expect(
      await (await row('Morning brief')).findByText('Paused with all automations'),
    ).toBeVisible();
  });

  it('shows an empty list and a store it could not read', async () => {
    renderAutomations(fakeAutomations([], { problem: 'Unexpected token in automations.json' }));
    expect(await screen.findByText('Your automations couldn’t be read')).toBeVisible();
    expect(screen.getByText('Unexpected token in automations.json')).toBeVisible();
    expect(screen.getByText('No automations yet')).toBeVisible();
  });

  it('opens a run’s task from the run history and marks it read', async () => {
    const automations = fakeAutomations(items());
    automations.runs.mockResolvedValue([
      automationRun({
        id: 'run-1',
        outcome: 'delivered',
        taskId: 'task-1',
        summary: 'Three new invoices.',
        finishedAt: '2026-10-06T01:02:00.000Z',
      }),
      automationRun({
        id: 'run-skip',
        outcome: 'skipped',
        reason: 'unsupportedFiles',
        source: 'folder',
        firedAt: '2026-10-05T12:00:00.000Z',
        readAt: '2026-10-05T12:00:00.000Z',
      }),
      automationRun({
        id: 'run-0',
        outcome: 'nothingNew',
        taskId: 'task-0',
        firedAt: '2026-10-05T01:00:00.000Z',
        finishedAt: '2026-10-05T01:01:00.000Z',
        readAt: '2026-10-05T02:00:00.000Z',
      }),
    ]);
    // task-0 was deleted from history since its run.
    renderAutomations(automations, [automationTask('task-1', 'morning')]);
    const user = userEvent.setup();
    await user.click(
      (await row('Morning brief')).getByRole('button', { name: 'More actions for Morning brief' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Run history' }));
    expect(await screen.findByText('Three new invoices.')).toBeVisible();
    expect(screen.getByText('Result ready')).toBeVisible();
    expect(screen.getByText('New')).toBeVisible();
    expect(screen.getByText('Task deleted')).toBeVisible();
    expect(screen.getByText('None of its files could be given to the command.')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Open the task of the run from/ })).toHaveLength(
      1,
    );
    await user.click(screen.getByRole('button', { name: /^Open the task of the run from/ }));
    expect(automations.markRead).toHaveBeenCalledWith({ runIds: ['run-1'] });
    expect(automations.showTask).toHaveBeenCalledWith('task-1');
  });
});
