import type { RunReference } from '@atd/agent-contracts';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { RunPolicy } from '../../client/agent/run-policy';

/**
 * The panel's send (`useTaskPanel`'s `submit`): the bound conversation's draft, or a command
 * (`launched`), optionally as conversation `sideChatOf`'s side chat. Resolves with the started
 * task's detail, or null when the panel refused it.
 */
export type PanelSubmit = (
  launched?: PreparedCommand,
  sideChatOf?: string | null,
) => Promise<TaskDetail | null>;

/**
 * Stages what the draft's chips select: the skills are the draft's skill chips, and the references
 * are exactly its conversation, MCP server and subagent chips, each item once.
 */
export function withChips(
  policy: RunPolicy,
  skills: string[],
  references: RunReference[],
): RunPolicy {
  return {
    ...policy,
    ...(skills.length ? { skills: skills.map((name) => ({ name })) } : {}),
    ...(references.length ? { references } : {}),
  };
}

/**
 * Sends a run (`send`), hands its detail to `sent`, and calls `settle` once either ends, resolved
 * or thrown, in the same turn as `sent`. Kept out of the hook: the React Compiler does not
 * compile a `finally` clause.
 */
export async function sendSettling(
  send: () => Promise<TaskDetail>,
  sent: (detail: TaskDetail) => void,
  settle: () => void,
): Promise<TaskDetail> {
  try {
    const detail = await send();
    sent(detail);
    return detail;
  } finally {
    settle();
  }
}
