import {
  BookOpen,
  Bookmark,
  BookmarkMinus,
  BookmarkPlus,
  Lightbulb,
  PencilLine,
  Pin,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type {
  MemoryActivation,
  MemoryCategory,
  MemoryProposalKind,
  MemorySource,
  MemoryTarget,
} from '@atd/agent-contracts';

/**
 * Each unit type's icon and name, shared by the Memory section, Personal's Memory tab and the `@`
 * panel. The names are the Memory section's original group names, which settings search lists.
 */
export const MEMORY_TYPES = {
  memory: { icon: Bookmark, labelKey: 'memory.list.preference' },
  user: { icon: UserRound, labelKey: 'memory.list.userProfile' },
  failure: { icon: Lightbulb, labelKey: 'memory.list.corrections' },
} as const satisfies Record<MemoryTarget, { icon: LucideIcon; labelKey: string }>;

/** Types in the order the Type field offers them. */
export const MEMORY_TYPE_ORDER: readonly MemoryTarget[] = ['memory', 'user', 'failure'];

/** Who wrote a unit, as its page names the source. */
export const MEMORY_SOURCES = {
  user: 'memory.source.user',
  agent: 'memory.source.agent',
  learned: 'memory.source.learned',
  app: 'memory.source.app',
} as const satisfies Record<MemorySource, string>;

/** Each category's name. */
export const MEMORY_CATEGORIES = {
  failure: 'memory.category.failure',
  correction: 'memory.category.correction',
  insight: 'memory.category.insight',
  preference: 'memory.category.preference',
  convention: 'memory.category.convention',
  'tool-quirk': 'memory.category.tool-quirk',
} as const satisfies Record<MemoryCategory, string>;

/** Categories in the order the Category field offers them. */
export const MEMORY_CATEGORY_ORDER: readonly MemoryCategory[] = [
  'failure',
  'correction',
  'insight',
  'preference',
  'convention',
  'tool-quirk',
];

/** How a unit reaches runs, with the hint the Activation field shows for the choice. */
export const MEMORY_ACTIVATIONS = {
  core: { labelKey: 'memory.activation.core.label', hintKey: 'memory.activation.core.hint' },
  index: { labelKey: 'memory.activation.index.label', hintKey: 'memory.activation.index.hint' },
  search: { labelKey: 'memory.activation.search.label', hintKey: 'memory.activation.search.hint' },
} as const satisfies Record<MemoryActivation, { labelKey: string; hintKey: string }>;

/** Activations in the order the field offers them, the most present first. */
export const MEMORY_ACTIVATION_ORDER: readonly MemoryActivation[] = ['core', 'index', 'search'];

/** What a learner suggestion would do, as its row marks and names it. */
export const PROPOSAL_KINDS = {
  create: { icon: BookmarkPlus, labelKey: 'memory.suggestions.kinds.create' },
  update: { icon: PencilLine, labelKey: 'memory.suggestions.kinds.update' },
  remove: { icon: BookmarkMinus, labelKey: 'memory.suggestions.kinds.remove' },
  core: { icon: Pin, labelKey: 'memory.suggestions.kinds.core' },
  // The skill mark the composer chips and Extensions use.
  skill: { icon: BookOpen, labelKey: 'memory.suggestions.kinds.skill' },
} as const satisfies Record<MemoryProposalKind, { icon: LucideIcon; labelKey: string }>;
