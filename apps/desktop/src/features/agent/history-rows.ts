import type { TaskSearchHit } from '@atd/agent-contracts';
import type { FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import type { AgentTask } from '../../client/agent/task-schema';

export type HistoryEntry = {
  task: AgentTask;
  /** Shown only when it says something: every finished task would otherwise read "Completed". */
  statusLabel: string;
  match: FieldsMatch<'title' | 'status'> | null;
  /**
   * The conversation's best message for the search, shown under the meta line when it is why the
   * task is listed; null without a content match or when the title or status matched.
   */
  content: TaskSearchHit | null;
};

/**
 * One row of the virtualized history: a task, carrying the heading of the section it opens.
 * Folding the heading into the section's first row keeps every row of the flat list a list item,
 * so the list keeps the positions assistive technology reads, and a heading never scrolls apart
 * from its first task.
 */
export type HistoryRow = {
  entry: HistoryEntry;
  /** The section heading above the row; null within a section and in the ungrouped list. */
  title: string | null;
  /** Opens a section after the first, which keeps the wider gap between sections. */
  laterSection: boolean;
};

/** The sections, in order, as the one flat list the virtualizer windows. */
export function historyRows(
  sections: readonly { title: string | null; items: readonly HistoryEntry[] }[],
): HistoryRow[] {
  return sections.flatMap((section, sectionIndex) =>
    section.items.map((entry, index) => ({
      entry,
      title: index === 0 ? section.title : null,
      laterSection: index === 0 && sectionIndex > 0,
    })),
  );
}
