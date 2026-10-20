import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { SHOW_UI_TOOL } from '@atd/agent-contracts';

/**
 * A `show_ui` call on a session branch. A view's id is its call id, and the transcript is the
 * source of truth: the view's document comes from this call's arguments.
 */
export interface ShowUiCall {
  /** The call's arguments as the model wrote them; unchecked. */
  args: unknown;
  /** The branch holds the call's result and it is an error: the tool showed no view. */
  failed: boolean;
}

/**
 * The `show_ui` call with this id on the branch, from its assistant message; null when the branch
 * has none. A call without a result yet (one that waits, or was interrupted) is found too.
 */
export function findShowUiCall(branch: readonly SessionEntry[], callId: string): ShowUiCall | null {
  let found = false;
  let args: unknown;
  let failed = false;
  for (const entry of branch) {
    if (entry.type !== 'message') continue;
    const { message } = entry;
    if (message.role === 'assistant') {
      for (const part of message.content)
        if (part.type === 'toolCall' && part.id === callId && part.name === SHOW_UI_TOOL) {
          found = true;
          args = part.arguments;
        }
    } else if (message.role === 'toolResult' && message.toolCallId === callId)
      failed = message.isError;
  }
  return found ? { args, failed } : null;
}
