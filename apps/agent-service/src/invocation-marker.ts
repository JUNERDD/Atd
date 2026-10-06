import type { SessionManager } from '@earendil-works/pi-coding-agent';
import type { TaskRun } from '@atd/agent-contracts';

/**
 * The custom entry that marks where a run starts in a session branch. Transcript projection
 * attributes the entries after it to that run (transcript.ts, tasks/turns.ts), and memory
 * learning leaves out the runs it marks as kept out of memory (memory/learner/transcript.ts).
 */
export const INVOCATION_ENTRY = 'app-invocation';

/** What a run's invocation marker records. */
export interface InvocationData {
  runId: string;
  /**
   * `automation` for a run an automation started (`RunSnapshot.trigger`): its messages are the
   * automation's prompt and the data that fired it, sent while nobody was present. `command` for a
   * command run (`RunSnapshot.fromCommand`): its messages are a saved command's material. Neither
   * is the user's own words.
   */
  source: 'automation' | 'command' | 'user';
  /** The run snapshot's memory flag; a run with memory off is never learned from. */
  memory: boolean;
}

/**
 * Marks where `run` starts in the session branch. Every run a session executes needs one,
 * whether the session was reused or rebuilt for it.
 */
export function markInvocation(manager: SessionManager, run: TaskRun): void {
  const { trigger, fromCommand, memory } = run.snapshot;
  const data: InvocationData = {
    runId: run.id,
    source: trigger ? 'automation' : fromCommand ? 'command' : 'user',
    memory,
  };
  manager.appendCustomEntry(INVOCATION_ENTRY, data);
}
