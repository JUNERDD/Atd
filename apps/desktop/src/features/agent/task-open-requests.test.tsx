import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installBridge } from '../../../tests/app-test-bridge';
import {
  automationItem,
  automationTask,
  fakeAutomations,
  installAutomations,
} from '../../../tests/automation-fixtures';
import { ToastHost } from '../../components/toast';
import { useMarkAutomationRunRead, useTaskOpenRequests } from './use-task-open-requests';

/** Installs the bridges and a `task.open` source the test drives, as the shell's would. */
function installTaskOpen(automations: ReturnType<typeof fakeAutomations>) {
  installBridge();
  installAutomations(automations);
  let deliver: (taskId: string) => void = () => {};
  const desktop = window.desktop;
  if (!desktop) throw new Error('The desktop bridge is missing.');
  window.desktop = {
    ...desktop,
    onTaskOpen: (listener) => {
      deliver = listener;
      return () => {};
    },
  };
  return (taskId: string) => act(() => deliver(taskId));
}

function Panel({ open }: { open: (taskId: string) => void }) {
  useTaskOpenRequests(open);
  return <ToastHost top={0} />;
}

describe('task open requests', () => {
  it('opens a task that still exists', async () => {
    const automations = fakeAutomations([]);
    const send = installTaskOpen(automations);
    const open = vi.fn();
    render(<Panel open={open} />);
    send('task-1');
    await waitFor(() => expect(open).toHaveBeenCalledWith('task-1'));
    expect(automations.taskExists).toHaveBeenCalledWith('task-1');
  });

  it('says a deleted task is gone instead of opening an empty view', async () => {
    const automations = fakeAutomations([]);
    automations.taskExists.mockResolvedValue(false);
    const send = installTaskOpen(automations);
    const open = vi.fn();
    render(<Panel open={open} />);
    send('gone');
    expect(await screen.findByText('That task was deleted.')).toBeVisible();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('automation runs read in the panel', () => {
  it('marks a run read once it finishes while its task is shown', async () => {
    const automations = fakeAutomations([
      automationItem({ id: 'morning', name: 'Morning brief' }, { unread: 1 }),
    ]);
    installTaskOpen(automations);
    const { rerender } = renderHook(useMarkAutomationRunRead, {
      initialProps: automationTask('task-a', 'morning', 'running'),
    });
    // Another run is unread, but this one is still running: the service would ignore it.
    await waitFor(() => expect(automations.list).toHaveBeenCalled());
    expect(automations.markRead).not.toHaveBeenCalled();
    rerender(automationTask('task-a', 'morning', 'completed'));
    await waitFor(() => expect(automations.markRead).toHaveBeenCalledWith({ taskIds: ['task-a'] }));
    expect(automations.markRead).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a task a person started', async () => {
    const automations = fakeAutomations([
      automationItem({ id: 'morning', name: 'Morning brief' }, { unread: 1 }),
    ]);
    installTaskOpen(automations);
    const task = automationTask('mine', 'morning');
    delete task.origin;
    renderHook(useMarkAutomationRunRead, { initialProps: task });
    await waitFor(() => expect(automations.list).toHaveBeenCalled());
    expect(automations.markRead).not.toHaveBeenCalled();
  });
});
