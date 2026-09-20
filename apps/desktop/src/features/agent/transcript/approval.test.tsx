import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { HitlQueuePopover } from '../../../components/hitl-queue-popover';
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
      <HitlQueuePopover
        requests={detail.requests}
        queue={detail.queue}
        taskId="task-1"
        onEditQueued={vi.fn()}
      >
        <div data-testid="composer-surface" />
      </HitlQueuePopover>
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
    expect(screen.getByRole('button', { name: 'Allow for this session' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Decline/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Allow once/ }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'once' });
  });

  it('sends a session grant from the secondary control', async () => {
    const user = userEvent.setup();
    const { answer } = renderApproval();
    await user.click(screen.getByRole('button', { name: 'Allow for this session' }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'session' });
  });

  it('sends declined from the Decline control', async () => {
    const user = userEvent.setup();
    const { answer } = renderApproval();
    await user.click(screen.getByRole('button', { name: /Decline/ }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-1', { decision: 'declined' });
  });
});
