import type { RunReference } from '@atd/agent-contracts';
import type { PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { RunPolicy } from '../../client/agent/run-policy';
import { messageOf } from '../../lib/errors';
import {
  discardOutgoing,
  putOutgoing,
  settleOutgoing,
  type OutgoingMessage,
} from './outgoing-messages';

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

/** What an optimistic send reports back to the panel, around each attempt. */
export interface OptimisticHooks {
  /** The service took the message; its run's detail. */
  sent: (detail: TaskDetail) => void;
  /** A retry starts; the first attempt began with the send itself. */
  begin: () => void;
  /** An attempt ended, accepted or not. */
  settle: () => void;
  /** The person discarded the message the service did not take. */
  discarded?: (() => void) | undefined;
}

/**
 * Sends a message optimistically (`outgoing-messages.ts`): its conversation shows `message` as
 * sent before `send` answers. A refusal or an unreachable service shows on the message, with a
 * retry that sends the same request again, instead of being thrown, so it resolves null then.
 */
export function sendOptimistic(
  message: Omit<OutgoingMessage, 'error' | 'retry' | 'discard'>,
  send: () => Promise<TaskDetail>,
  hooks: OptimisticHooks,
): Promise<TaskDetail | null> {
  const retry = () => {
    hooks.begin();
    void attempt();
  };
  const discard = () => {
    discardOutgoing(message.taskId, message.id);
    hooks.discarded?.();
  };
  async function attempt(): Promise<TaskDetail | null> {
    putOutgoing({ ...message, error: null, retry, discard });
    try {
      const detail = await send();
      hooks.sent(detail);
      return detail;
    } catch (error) {
      settleOutgoing({ ...message, error: messageOf(error), retry, discard });
      return null;
    } finally {
      hooks.settle();
    }
  }
  return attempt();
}
