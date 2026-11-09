import type { MemoryCategory, MemoryTarget, MemoryUnit } from '@atd/agent-contracts';

/**
 * The Settings filters. `preference` also takes a failure categorized as a
 * preference, and `tool-quirk` is the only category split out of corrections.
 */
export const MEMORY_GROUPS = ['all', 'user', 'preference', 'correction', 'tool-quirk'] as const;
export type MemoryGroup = (typeof MEMORY_GROUPS)[number];
type SpecificMemoryGroup = Exclude<MemoryGroup, 'all'>;

export const MEMORY_GROUP_LABEL_KEYS = {
  all: 'memory.groups.all',
  user: 'memory.groups.user',
  preference: 'memory.groups.preference',
  correction: 'memory.groups.correction',
  'tool-quirk': 'memory.groups.toolQuirk',
} as const satisfies Record<MemoryGroup, string>;

export function memoryGroupOf(unit: {
  type: MemoryTarget;
  category: MemoryCategory | null;
}): SpecificMemoryGroup {
  if (unit.type === 'user') return 'user';
  if (unit.type === 'memory' || unit.category === 'preference') return 'preference';
  if (unit.category === 'tool-quirk') return 'tool-quirk';
  return 'correction';
}

export function inMemoryGroup(
  unit: Pick<MemoryUnit, 'type' | 'category'>,
  group: MemoryGroup,
): boolean {
  return group === 'all' || memoryGroupOf(unit) === group;
}

export function memoryGroupCounts(
  units: readonly Pick<MemoryUnit, 'type' | 'category'>[],
): Record<MemoryGroup, number> {
  const counts: Record<MemoryGroup, number> = {
    all: units.length,
    user: 0,
    preference: 0,
    correction: 0,
    'tool-quirk': 0,
  };
  for (const unit of units) counts[memoryGroupOf(unit)] += 1;
  return counts;
}
