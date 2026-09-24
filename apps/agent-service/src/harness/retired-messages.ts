import type { ContextEvent, ExtensionFactory } from '@earendil-works/pi-coding-agent';

/**
 * Hidden custom messages of a removed feature that old session files still carry. Pi replays a
 * custom message to the model on every later turn, so each prefix here stays filtered out of the
 * context. `app-plan` covers the retired planning feature's instruction and todo reminder. Its
 * custom entries and plan tool rows need nothing here: entries never reach the model, and the
 * transcript shows those rows as ordinary tool calls.
 */
const RETIRED_PREFIXES = ['app-plan'];

/** Drops retired hidden messages from the model context; the session file keeps them. */
export function retiredMessagesExtension(): ExtensionFactory {
  return (pi) => {
    pi.on('context', (event) => {
      if (!event.messages.some(isRetired)) return undefined;
      return { messages: event.messages.filter((message) => !isRetired(message)) };
    });
  };
}

type AgentMessage = ContextEvent['messages'][number];

function isRetired(message: AgentMessage): boolean {
  return (
    message.role === 'custom' &&
    RETIRED_PREFIXES.some((prefix) => message.customType.startsWith(prefix))
  );
}
