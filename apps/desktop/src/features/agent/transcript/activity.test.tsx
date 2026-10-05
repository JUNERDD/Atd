import { render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import type { ViewBlock } from './adapter';
import { phaseTitle } from './phase-title';
import { Transcript } from './transcript';
import {
  assistantBlock,
  installAgent,
  makeDetail,
  questionBlock,
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

/** Renders a settled agent phase title through the real `tasks` translations. */
function AgentSettledTitle({ step }: { step: ViewBlock }) {
  const { t } = useTranslation('tasks');
  return <>{phaseTitle({ id: 'phase-agent', kind: 'agent', steps: [step] }, false, t)}</>;
}

describe('activity folding', () => {
  it('shows a live group that fits its peek window under a static tally', () => {
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
    // Both steps already show in the peek window, so folding would change nothing.
    expect(screen.queryByRole('button', { name: /^Show 2 steps/ })).toBeNull();
    expect(screen.getByText('Thought once · Ran a tool')).toBeVisible();
    expect(screen.getByText('Read file notes.txt')).toBeVisible();
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
      name: 'Show 4 steps, Thought once · Ran 3 tools',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
  });

  it('counts an answered question toward the settled tool total', () => {
    mount(
      makeDetail({
        blocks: [
          userBlock(),
          thinkingBlock(),
          toolBlock({ id: 'tool:read-1', callId: 'read-1' }),
          questionBlock({ status: 'completed', answer: 'Detailed' }),
          assistantBlock(),
        ],
      }),
    );
    const trigger = screen.getByRole('button', {
      name: 'Show 3 steps, Thought once · Ran 2 tools',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
  });

  it('counts redacted empty thinking toward the thought prefix', () => {
    mount(
      makeDetail({
        blocks: [
          userBlock(),
          thinkingBlock({ text: '', redacted: true }),
          toolBlock({ id: 'tool:read-1', callId: 'read-1' }),
          assistantBlock(),
        ],
      }),
    );
    // Without the redacted placeholder the lone tool would render headerless, so the
    // thought prefix proves the empty redacted block still counts as thinking.
    const trigger = screen.getByRole('button', {
      name: 'Show 2 steps, Thought once · Ran a tool',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
  });

  it('renders a lone tool step without a phase header', () => {
    mount(
      makeDetail({
        blocks: [userBlock(), toolBlock({ id: 'tool:read-1', callId: 'read-1' }), assistantBlock()],
      }),
    );
    expect(document.querySelector('[data-activity="settled"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /(Show|Hide) \d+ step/ })).toBeNull();
    expect(screen.getByText('Done.')).toBeVisible();
  });

  it('titles a settled agent phase as invoked', () => {
    // Covered at the title contract with a step shaped like the adapter's view of a
    // `subagent` call that launched one child.
    const source = toolBlock({
      id: 'tool:agent-1',
      callId: 'agent-1',
      name: 'subagent',
      args: { agent: 'task.greeter', task: 'Say hello' },
    });
    const step: ViewBlock = {
      id: source.id,
      runId: source.runId,
      timestamp: source.timestamp,
      role: 'tool',
      text: '',
      streaming: false,
      status: 'completed',
      tool: {
        callId: source.callId,
        name: source.name,
        kind: 'agent',
        status: 'completed',
        path: null,
        fileName: null,
        query: null,
        subagents: 1,
      },
      approvalPending: false,
      requestKind: null,
      source,
    };
    render(<AgentSettledTitle step={step} />);
    expect(screen.getByText('Invoked a subagent')).toBeVisible();
  });
});
