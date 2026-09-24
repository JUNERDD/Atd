import type { ViewBlock } from './adapter';

/**
 * Activity phase semantics: one uninterrupted run of a turn's work — thinking, tool calls, and
 * questions between two pieces of prose — reads as a single labelled group, whatever mix of work
 * it holds. This module owns grouping only; titles live in `phase-title.ts` so the i18n keys
 * stay literal.
 */

export type ActivityWorkKind = 'research' | 'edit' | 'run' | 'agent' | 'plan' | 'other';

/** A work kind, or a run of pure thinking with no calls. */
export type ActivityPhaseKind = ActivityWorkKind | 'think';

export type ActivityPhase = {
  id: string;
  kind: ActivityPhaseKind;
  steps: ViewBlock[];
};

export function isThinkingView(block: ViewBlock): boolean {
  if (block.role !== 'reasoning') return false;
  if (block.text.trim() !== '') return true;
  return block.source.kind === 'thinking' && block.source.redacted === true;
}

export function isToolView(block: ViewBlock): boolean {
  return block.role === 'tool' || block.role === 'question';
}

export function isViewLive(block: ViewBlock): boolean {
  if (block.approvalPending) return true;
  switch (block.role) {
    case 'assistant':
    case 'reasoning':
      return block.streaming;
    case 'tool':
    case 'question':
      return block.status === 'running';
    case 'user':
    case 'system':
      return false;
    default: {
      const _exhaustive: never = block.role;
      void _exhaustive;
      return false;
    }
  }
}

export function toolCategory(block: ViewBlock): ActivityWorkKind {
  const kind = block.tool?.kind;
  if (kind === 'agent') return 'agent';
  if (kind === 'write') return 'edit';
  if (kind === 'search' || kind === 'read' || kind === 'web') return 'research';
  if (kind === 'shell') return 'run';
  if (kind === 'plan') return 'plan';
  return 'other';
}

/**
 * Gathers one run of activity into a single group. The kind only picks the settled title and
 * glyph: the shared category when every call is the same kind of work, `other` for a mix, and
 * `think` when the run holds no calls at all. Todo calls only track the work, so they name the
 * group only when it holds nothing else: updating the list between reads keeps a
 * research group reading as research.
 */
export function buildActivityPhase(blocks: ViewBlock[]): ActivityPhase {
  const kinds = new Set(blocks.filter(isToolView).map(toolCategory));
  if (kinds.size > 1) kinds.delete('plan');
  const [only] = kinds;
  const kind: ActivityPhaseKind =
    kinds.size === 0 ? 'think' : (kinds.size === 1 && only) || 'other';
  return { id: blocks[0]?.id ?? '', kind, steps: blocks };
}
