import type { TaskRun } from '../../../client/agent/task-schema';
import type { AdaptedTurn } from './adapter';
import { promptRun } from './run-prompt';
import { promptText } from './turn-resend';

/**
 * A user message the prompt rail lists: the turn it opens, that turn's place in the transcript's
 * turns (where the window has to reach to mount it), and the line that names it.
 */
export type PromptEntry = { turnId: string; turnIndex: number; label: string };

/** The first line with text, its whitespace collapsed. */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const words = line.replace(/\s+/g, ' ').trim();
    if (words) return words;
  }
  return '';
}

/**
 * Every user message of the conversation in order, whether or not its turn is mounted: the
 * transcript holds them all and only renders a window. A message is named by its first line as
 * the user would copy it, by its attachments when it has no text, and by `fallback` otherwise.
 */
export function promptEntries(
  turns: readonly AdaptedTurn[],
  runs: TaskRun[],
  fallback: string,
): PromptEntry[] {
  return turns.flatMap((turn, turnIndex) => {
    if (!turn.user) return [];
    const run = promptRun(runs, turn.user);
    const files = run?.snapshot.input.files.map((file) => file.name).join(', ');
    const label = firstLine(promptText(turn.user, run)) || files || fallback;
    return [{ turnId: turn.id, turnIndex, label }];
  });
}

/** Whether two lists name the same messages the same way, at the same places. */
export function samePrompts(a: readonly PromptEntry[], b: readonly PromptEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return (
        entry.turnId === other?.turnId &&
        entry.turnIndex === other.turnIndex &&
        entry.label === other.label
      );
    })
  );
}
