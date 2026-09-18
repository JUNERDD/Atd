import type { ViewBlock } from './adapter';

/**
 * Activity phase semantics ported from monocode `transcriptActivity.ts`: a turn's folded work
 * splits into labelled groups wherever it switches work kinds. This module owns grouping only;
 * titles live in `phase-title.ts` so the i18n keys stay literal.
 */

export type ActivityWorkKind = 'research' | 'edit' | 'run' | 'agent' | 'other';

/** A work kind, or a group of thoughts still waiting on the work they introduced. */
export type ActivityPhaseKind = ActivityWorkKind | 'think';

export type ActivityPhase = {
  id: string;
  kind: ActivityPhaseKind;
  steps: ViewBlock[];
};

export function isThinkingView(block: ViewBlock): boolean {
  return block.role === 'reasoning' && block.text.trim() !== '';
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

/** Ties break towards the kind that changed the most: an edit outranks a read. */
const WORK_KIND_ORDER: ActivityWorkKind[] = ['edit', 'run', 'agent', 'research', 'other'];

export function toolCategory(block: ViewBlock): ActivityWorkKind {
  const kind = block.tool?.kind;
  if (kind === 'agent') return 'agent';
  if (kind === 'write') return 'edit';
  if (kind === 'search' || kind === 'read') return 'research';
  if (kind === 'shell') return 'run';
  return 'other';
}

/**
 * Splits a turn's activity into labelled groups wherever the work switches kinds. Everything
 * else piles into the group already open. Assistant prose never reaches this module — `foldTurn`
 * keeps it standalone — so groups title from the work itself.
 */
export function buildActivityPhases(blocks: ViewBlock[]): ActivityPhase[] {
  const phases: ActivityPhase[] = [];
  let current: ActivityPhase | undefined;

  const open = (kind: ActivityPhaseKind) => {
    current = { id: '', kind, steps: [] };
    phases.push(current);
    return current;
  };

  for (const block of blocks) {
    // Reasoning is a step, never a header: the thinking behind the work reads as working out
    // rather than as another thing the agent said.
    if (isThinkingView(block)) {
      if (!current) current = open('think');
      current.steps.push(block);
      if (!current.id) current.id = block.id;
      continue;
    }
    const kind = toolCategory(block);
    if (!current) {
      current = open(kind);
    } else if (current.kind === 'think') {
      // A group that opened on thoughts takes the shape of the work they introduced.
      current.kind = kind;
    } else if (current.kind !== kind) {
      // A thought at the end of a group was about what came next: it moves into the group it
      // introduced.
      const trailing = takeTrailingNarration(current);
      current = open(kind);
      current.steps.push(...trailing);
      const first = trailing[0];
      if (first) current.id = first.id;
    }
    current.steps.push(block);
    if (!current.id) current.id = block.id;
  }

  return absorbStrayPhases(phases);
}

/** The run of thinking a group ends on, lifted out of it. */
function takeTrailingNarration(phase: ActivityPhase): ViewBlock[] {
  let cut = phase.steps.length;
  while (cut > 0) {
    const prev = phase.steps[cut - 1];
    if (!prev || isToolView(prev)) break;
    cut -= 1;
  }
  return phase.steps.splice(cut);
}

/**
 * A single call the agent never introduced — the read wedged between two edits, the test run
 * after them — folds back into the group before it rather than taking a header of its own.
 */
function absorbStrayPhases(phases: ActivityPhase[]): ActivityPhase[] {
  const kept: ActivityPhase[] = [];
  for (const phase of phases) {
    const previous = kept[kept.length - 1];
    const stray = phase.steps.filter(isToolView).length === 1;
    if (
      previous &&
      stray &&
      previous.steps.length > 0 &&
      phase.kind !== 'agent' &&
      previous.kind !== 'agent'
    ) {
      previous.steps.push(...phase.steps);
      previous.kind = dominantWorkKind(previous.steps) ?? previous.kind;
      continue;
    }
    kept.push(phase);
  }
  return kept;
}

function dominantWorkKind(steps: ViewBlock[]): ActivityWorkKind | undefined {
  const counts = new Map<ActivityWorkKind, number>();
  for (const block of steps) {
    if (!isToolView(block)) continue;
    const kind = toolCategory(block);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: ActivityWorkKind | undefined;
  for (const kind of WORK_KIND_ORDER) {
    const count = counts.get(kind) ?? 0;
    if (count > 0 && (!best || count > (counts.get(best) ?? 0))) best = kind;
  }
  return best;
}

/** True while a tool in this turn is still running or waiting on the user. */
export function activityStillRunning(blocks: ViewBlock[]): boolean {
  return blocks.some((block) => (isToolView(block) && isViewLive(block)) || block.approvalPending);
}

/**
 * The activity group a settled turn hangs its footer on: the last one, which sits right above
 * the final answer.
 */
export function lastActivityIndex(items: Array<{ type: string }>): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'activity') return index;
  }
  return -1;
}
