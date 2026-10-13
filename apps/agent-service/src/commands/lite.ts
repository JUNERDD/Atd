import type { InstructionToken, ServiceToolId, TaskInput } from '@atd/agent-contracts';
import type { InternalSubmitOptions } from '../tasks/submit-options.js';

/** What decides whether a command run may take the lightweight session (lite-session.ts). */
export interface LiteRunFacts {
  /** The task the run joins; a run that creates its task leaves it out. */
  taskId: string | undefined;
  input: TaskInput;
  /** The tools the run freezes, as the preview resolved them with the caller's policy. */
  tools: readonly ServiceToolId[];
  /** The tokens of the command's saved template (`parseInstructionTokens`). */
  tokens: readonly InstructionToken[];
  /** Whether the caller wraps the template in text of its own (an automation's frame). */
  framed: boolean;
  internal: InternalSubmitOptions;
}

/**
 * Whether a command run needs nothing the full session wires: it gets no tools, the template
 * stages no skill, reference, subagent or MCP server, nothing attaches files, a screenshot or
 * folders, and it is a person's run, not an automation's. Only the first run of a new task
 * qualifies, so a lite session never has to serve a conversation that already used tools; the
 * task's follow-ups take the full session, as do messages queued while it answers
 * (tasks/held-queue.ts). The run's memory flag still freezes as resolved: the lite session shows
 * only core memory and learns none, as no command run is learned from.
 */
export function isLiteRun(facts: LiteRunFacts): boolean {
  const { input } = facts;
  return (
    !facts.internal.trigger &&
    facts.taskId === undefined &&
    !facts.framed &&
    facts.tools.length === 0 &&
    facts.tokens.length === 0 &&
    input.files.length === 0 &&
    input.source !== 'screenshot' &&
    !input.folders?.length
  );
}
