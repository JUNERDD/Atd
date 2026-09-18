import type { ViewBlock } from './adapter';

/**
 * Activity phase semantics ported from monocode `transcriptActivity.ts`: a turn's folded work
 * splits into labelled groups wherever the agent narrates its next move or switches work kinds.
 * This module owns grouping only; titles live in `phase-title.ts` so the i18n keys stay literal.
 */

export type ActivityWorkKind = 'research' | 'edit' | 'run' | 'agent' | 'other';

/** A work kind, or a group the agent only narrated: a thought, or a note. */
export type ActivityPhaseKind = ActivityWorkKind | 'think' | 'note';

export type ActivityPhase = {
  id: string;
  kind: ActivityPhaseKind;
  /** The agent's own words for this run, when it wrote some. */
  headline?: ViewBlock;
  steps: ViewBlock[];
};

export function isThinkingView(block: ViewBlock): boolean {
  return block.role === 'reasoning' && block.text.trim() !== '';
}

export function isToolView(block: ViewBlock): boolean {
  return block.role === 'tool' || block.role === 'question';
}

/** Assistant prose with something in it — the paragraphs between tool calls. */
export function isProseView(block: ViewBlock): boolean {
  return block.role === 'assistant' && block.text.trim() !== '';
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

/**
 * Where the turn's final answer starts: the trailing run of assistant prose. Everything before it
 * folds, so the last thing the agent says is the only full-size thing left. A block still
 * streaming sits in that run, which is why text renders in full as it arrives and only folds once
 * the next tool starts.
 */
export function finalResponseStart(blocks: ViewBlock[]): number {
  let index = blocks.length;
  while (index > 0) {
    const prev = blocks[index - 1];
    if (!prev || !isProseView(prev)) break;
    index -= 1;
  }
  return index;
}

/** First paragraph of a folded prose block, stripped to one plain line. */
export function proseSummary(text: string): string {
  const body = text.replace(/```[\s\S]*?(?:```|$)/g, ' ');
  const paragraph =
    body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) ?? '';
  return paragraph
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
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
 * Splits a turn's activity into labelled groups. Two things start a new one: the agent saying
 * what it is about to do, and it switching from one kind of work to another. Everything else piles
 * into the group already open.
 */
export function buildActivityPhases(blocks: ViewBlock[]): ActivityPhase[] {
  const phases: ActivityPhase[] = [];
  let current: ActivityPhase | undefined;

  const open = (kind: ActivityPhaseKind, headline?: ViewBlock) => {
    current = { id: headline?.id ?? '', kind, headline, steps: [] };
    phases.push(current);
    return current;
  };

  for (const block of blocks) {
    // Reasoning is a step, never a header. The agent's own words title a group; the thinking
    // behind them belongs inside it, where it reads as working out rather than as another thing
    // the agent said.
    if (isThinkingView(block)) {
      if (!current) current = open('think');
      current.steps.push(block);
      if (!current.id) current.id = block.id;
      continue;
    }
    if (isProseView(block)) {
      const narrating = current?.kind === 'think' || current?.kind === 'note';
      // A line after work has started is the title of what comes next, not a footnote to what
      // just happened.
      if (!current || !narrating) {
        current = open('note', block);
      } else if (!current.headline) {
        // A group that opened on a thought takes the agent's words as its title, keeping the id
        // it already has so the group is not remounted.
        current.headline = block;
        current.kind = 'note';
      } else {
        current.steps.push(block);
      }
      continue;
    }
    const kind = toolCategory(block);
    if (!current) {
      current = open(kind);
    } else if (current.kind === 'think' || current.kind === 'note') {
      // The group the agent announced takes the shape of the work it announced.
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
    const stray = !phase.headline && phase.steps.filter(isToolView).length === 1;
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

/** Whether the line that titled a group has more in it than the header shows. */
export function headlineHasMore(block: ViewBlock | undefined): boolean {
  if (!block) return false;
  return block.role === 'reasoning' || /\n\s*\n/.test(block.text.trim());
}
