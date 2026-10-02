import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { ComposerPopover } from '../../../components/composer-popover';
import { ToolBlock } from './tool-block';
import { Transcript } from './transcript';
import { installAgent, makeDetail, toolBlock, userBlock } from './fixtures';

function renderApproval() {
  const { answer } = installAgent();
  const detail = makeDetail({
    status: 'awaiting_confirmation',
    blocks: [
      userBlock(),
      toolBlock({
        name: 'edit',
        status: 'running',
        args: { path: 'app.ts' },
        details: {
          diff: '--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n',
          truncated: false,
          fullOutputPath: '',
        },
      }),
    ],
    requests: [
      {
        kind: 'confirmation',
        id: 'req-1',
        taskId: 'task-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        scope: { tool: 'edit', location: 'outside' },
        title: 'Edit a file',
        detail: 'app.ts',
      },
    ],
  });
  render(
    <TooltipProvider>
      <div data-testid="transcript-root">
        <Transcript detail={detail} onAttach={vi.fn()} />
      </div>
      <ComposerPopover
        requests={detail.requests}
        queue={detail.queue}
        taskId="task-1"
        onEditQueued={vi.fn()}
      >
        <div data-testid="composer-surface" />
      </ComposerPopover>
    </TooltipProvider>,
  );
  return { answer };
}

describe('approval controls', () => {
  it('renders the three decisions in the popover and sends once', async () => {
    const user = userEvent.setup();
    const { answer } = renderApproval();
    const transcript = screen.getByTestId('transcript-root');
    expect(
      within(transcript).getAllByText('Waiting for your approval').length,
    ).toBeGreaterThanOrEqual(1);
    expect(within(transcript).queryByRole('button', { name: /Allow once/ })).toBeNull();
    expect(within(transcript).queryByRole('button', { name: /Decline/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Allow once/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Allow this tool/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Decline/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Allow once/ }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'once' });
  });

  it('sends a session grant from the secondary control', async () => {
    const user = userEvent.setup();
    const { answer } = renderApproval();
    await user.click(screen.getByRole('button', { name: /Allow this tool/ }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'session' });
  });

  it('sends declined from the Decline control', async () => {
    const user = userEvent.setup();
    const { answer } = renderApproval();
    await user.click(screen.getByRole('button', { name: /Decline/ }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'declined' });
  });

  it("shows a codemode step's pending approval on the step that asks", () => {
    const block = toolBlock({
      name: 'codemode',
      status: 'running',
      output: '',
      args: { code: "await tools.read({ path: 'a.txt' });" },
      details: {
        diff: '',
        truncated: false,
        fullOutputPath: '',
        data: {
          type: 'codemode',
          truncated: false,
          steps: [
            {
              id: 'call-1/1',
              name: 'read',
              args: { path: 'a.txt' },
              status: 'completed',
              output: 'ok',
            },
            {
              id: 'call-1/2',
              name: 'write',
              args: { path: 'b.txt' },
              status: 'running',
              output: '',
            },
          ],
        },
      },
    });
    render(
      <TooltipProvider>
        <ToolBlock
          block={block}
          forceOpen
          confirmation={{
            kind: 'confirmation',
            id: 'req-2',
            taskId: 'task-1',
            runId: 'run-1',
            toolCallId: 'call-1/2',
            scope: { tool: 'write', location: 'inside' },
            title: 'write: b.txt',
            detail: 'b.txt',
          }}
        />
      </TooltipProvider>,
    );
    const steps = screen.getByLabelText('Tool calls made by the script');
    const rows = within(steps).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).queryByText(/Waiting for your approval/)).toBeNull();
    expect(within(rows[1]!).getByText(/Waiting for your approval/)).toBeVisible();
    // The script's row keeps the waiting summary beside its steps.
    expect(screen.getAllByText(/Waiting for your approval/)).toHaveLength(2);
  });
});
