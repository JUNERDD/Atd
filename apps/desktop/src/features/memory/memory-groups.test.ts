import { describe, expect, it } from 'vitest';
import { inMemoryGroup, memoryGroupCounts, memoryGroupOf } from './memory-groups';

const unit = (
  type: 'user' | 'memory' | 'failure',
  category:
    | 'failure'
    | 'correction'
    | 'insight'
    | 'preference'
    | 'convention'
    | 'tool-quirk'
    | null = null,
) => ({ type, category });

describe('memory groups', () => {
  it('puts profiles, preferences and tool quirks in their own groups', () => {
    expect(memoryGroupOf(unit('user'))).toBe('user');
    expect(memoryGroupOf(unit('memory'))).toBe('preference');
    expect(memoryGroupOf(unit('failure', 'preference'))).toBe('preference');
    expect(memoryGroupOf(unit('failure', 'tool-quirk'))).toBe('tool-quirk');
  });

  it('keeps every other failure category in corrections and learnings', () => {
    for (const category of ['failure', 'correction', 'insight', 'convention', null] as const)
      expect(memoryGroupOf(unit('failure', category))).toBe('correction');
  });

  it('filters by group and counts every group', () => {
    const units = [
      unit('user'),
      unit('memory'),
      unit('failure', 'preference'),
      unit('failure', 'tool-quirk'),
      unit('failure', 'correction'),
    ];
    expect(units.filter((item) => inMemoryGroup(item, 'preference'))).toHaveLength(2);
    expect(units.filter((item) => inMemoryGroup(item, 'correction'))).toHaveLength(1);
    expect(memoryGroupCounts(units)).toEqual({
      all: 5,
      user: 1,
      preference: 2,
      correction: 1,
      'tool-quirk': 1,
    });
  });
});
