import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MemoryUnit } from '@atd/agent-contracts';
import { MemoryList } from './memory-list';

const unit: MemoryUnit = {
  id: 'memory-1',
  name: 'reply-language',
  description: 'Use Chinese for replies.',
  type: 'memory',
  category: null,
  activation: 'index',
  enabled: true,
  source: 'user',
  origin: null,
  reviewed: true,
  created: '2026-11-09T00:00:00.000Z',
  updated: '2026-11-09T00:00:00.000Z',
  body: 'Reply in Chinese.',
  revision: 'revision',
};

function list(units: readonly MemoryUnit[], totalUnits: number, query: string) {
  return (
    <MemoryList
      units={units}
      totalUnits={totalUnits}
      query={query}
      busyIds={new Set()}
      onClearSearch={() => {}}
      onOpen={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
    />
  );
}

describe('memory list empty states', () => {
  it('prefers the global empty state after the last memory is deleted during a search', () => {
    render(list([], 0, 'needle'));
    expect(
      screen.getByText('No saved memories yet. Share a lasting preference as you work.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No memories match/)).not.toBeInTheDocument();
  });

  it('shows the search empty state while another memory still exists', () => {
    render(list([unit], 1, 'needle'));
    expect(screen.getByText('No memories match “needle”')).toBeInTheDocument();
  });
});
