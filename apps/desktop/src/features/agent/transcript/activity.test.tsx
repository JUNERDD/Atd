import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { Transcript } from './transcript';
import {
  assistantBlock,
  installAgent,
  makeDetail,
  thinkingBlock,
  toolBlock,
  userBlock,
} from './fixtures';

function mount(detail: ReturnType<typeof makeDetail>) {
  installAgent();
  render(
    <TooltipProvider>
      <Transcript detail={detail} onAttach={vi.fn()} />
    </TooltipProvider>,
  );
}

describe('activity folding', () => {
  it('collapses a live group behind the latest step and expands on click', async () => {
    const user = userEvent.setup();
    mount(
      makeDetail({
        status: 'running',
        blocks: [
          userBlock(),
          thinkingBlock({ streaming: true }),
          toolBlock({ status: 'running', output: '', partial: '…' }),
          assistantBlock({
            id: 'a:5:0',
            timestamp: 5,
            text: 'Working on it',
            streaming: true,
            stopReason: null,
          }),
        ],
      }),
    );
    const group = document.querySelector('[data-activity="live"]');
    expect(group).not.toBeNull();
    const header = screen.getByRole('button', { name: 'Show 2 steps, Reading notes.txt' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Read file')).toBeVisible();
  });

  it('collapses a settled group behind the phase verb title', () => {
    mount(
      makeDetail({
        blocks: [
          userBlock(),
          thinkingBlock(),
          toolBlock({ id: 'tool:a', callId: 'a', name: 'read', args: { path: 'a.ts' } }),
          toolBlock({ id: 'tool:b', callId: 'b', name: 'read', args: { path: 'b.ts' } }),
          toolBlock({ id: 'tool:c', callId: 'c', name: 'bash', args: { command: 'ls' } }),
          assistantBlock(),
        ],
      }),
    );
    const trigger = screen.getByRole('button', {
      name: 'Show 4 steps, Thought once · Read 2 files',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
  });
});
