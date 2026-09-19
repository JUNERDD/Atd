import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@ai/ui/components/tooltip';
import { Transcript } from './transcript';
import { installAgent, makeDetail, questionBlock, userBlock } from './fixtures';

function renderQuestion() {
  const { answer } = installAgent();
  const detail = makeDetail({
    status: 'awaiting_input',
    blocks: [userBlock(), questionBlock()],
    requests: [
      {
        kind: 'input',
        id: 'req-q',
        taskId: 'task-1',
        runId: 'run-1',
        toolCallId: 'ask-1',
        title: 'Which style?',
        options: ['Concise', 'Detailed'],
      },
    ],
  });
  render(
    <TooltipProvider>
      <Transcript detail={detail} onAttach={vi.fn()} />
    </TooltipProvider>,
  );
  return { answer };
}

describe('question block', () => {
  it('answers with the chosen chip', async () => {
    const user = userEvent.setup();
    const { answer } = renderQuestion();
    expect(screen.getByRole('button', { name: 'Concise' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Concise' }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-q', { answer: 'Concise' });
  });

  it('skips the question', async () => {
    const user = userEvent.setup();
    const { answer } = renderQuestion();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(answer).toHaveBeenCalledWith('task-1', 'run-1', 'req-q', { skipped: true });
  });

  it('shows the stored answer after resolution', () => {
    installAgent();
    render(
      <TooltipProvider>
        <Transcript
          detail={makeDetail({
            blocks: [
              userBlock(),
              questionBlock({ status: 'completed', answer: 'Detailed', skipped: false }),
            ],
          })}
          onAttach={vi.fn()}
        />
      </TooltipProvider>,
    );
    // A lone answered step renders directly: no phase header repeats the question title.
    expect(screen.getByText('Which style?')).toBeVisible();
    expect(screen.getByText('Detailed')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});
