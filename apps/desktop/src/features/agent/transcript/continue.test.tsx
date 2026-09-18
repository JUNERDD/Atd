import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import type { RunStatus } from '../../../../electron/agent/task-schema';
import { Transcript } from './transcript';
import { assistantBlock, installAgent, makeDetail, userBlock } from './fixtures';

function mount(status: RunStatus, onContinue = vi.fn(async () => {})) {
  installAgent();
  render(
    <TooltipProvider>
      <Transcript
        detail={makeDetail({
          status,
          error: status === 'interrupted' ? 'Stopped by the user.' : '',
          blocks: [userBlock(), assistantBlock()],
        })}
        onAttach={vi.fn()}
        onContinue={onContinue}
        onRerun={vi.fn()}
      />
    </TooltipProvider>,
  );
  return { onContinue };
}

describe('inline continue', () => {
  it('shows Continue after a stopped run and calls onContinue', async () => {
    const user = userEvent.setup();
    const { onContinue } = mount('stopped');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('shows Continue after an interrupted run and calls onContinue', async () => {
    const user = userEvent.setup();
    const { onContinue } = mount('interrupted');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible();
    expect(screen.getByText('This task was interrupted')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('renders no terminal actions for a failed run', () => {
    mount('failed');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review task' })).toBeNull();
  });
});
