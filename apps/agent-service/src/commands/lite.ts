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
  /** Whether the launch binds computer targets (`LaunchCommandRequest.computer`). */
  computer?: boolean;
  internal: InternalSubmitOptions;
  /**
   * True when the command runs on recognized screenshot text (`screenshotText`) in a new task or
   * one whose earlier runs were all `lite`: its preloaded screenshot and context need no tools.
   */
  screenshotText?: boolean;
}

/**
 * Whether a command run needs nothing the full session wires: it gets no tools or computer
 * bindings, the template stages no skill, reference, subagent or MCP server, nothing attaches
 * arbitrary files, a screenshot source or folders, and it is a person's run, not an automation's.
 * Runs on recognized screenshot text (`screenshotText`) attach only the capture's preloaded image
 * and context, so they qualify on a new task or a `lite`-only task; any other run qualifies only as
 * the first run of a new task with no attached files. Ordinary follow-ups and queued messages take
 * the full session (tasks/held-queue.ts). The run's memory flag still freezes as resolved: the lite
 * session shows only core memory and learns none, as no command run is learned from.
 */
export function isLiteRun(facts: LiteRunFacts): boolean {
  const { input } = facts;
  const screenshotText = facts.screenshotText === true;
  return (
    !facts.internal.trigger &&
    !facts.computer &&
    (facts.taskId === undefined || screenshotText) &&
    !facts.framed &&
    facts.tools.length === 0 &&
    facts.tokens.length === 0 &&
    (screenshotText || input.files.length === 0) &&
    (screenshotText || input.source !== 'screenshot') &&
    !input.folders?.length
  );
}
