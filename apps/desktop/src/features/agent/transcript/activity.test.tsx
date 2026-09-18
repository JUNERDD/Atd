import { render, screen } from '@testing-library/react';
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
      <Transcript
        detail={detail}
        onAttach={vi.fn()}
        onContinue={vi.fn(async () => {})}
        onRerun={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe('activity folding', () => {
  it('keeps a live group expanded while a tool runs and the assistant streams', () => {
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
    const header = screen.getByRole('button', { name: 'Hide 2 steps, Reading notes.txt' });
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
    const trigger = screen.getByRole('button', { name: 'Show 4 steps, Read 2 files' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
  });
});
