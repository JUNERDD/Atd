import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { RunMaterial } from './pi-session.js';

type ContextMessage = Parameters<ExtensionAPI['sendMessage']>[0];

/**
 * Appends hidden context from a `before_agent_start` handler so it lands just before that prompt's
 * user message. Pi converts custom messages to user-role text, and a message returned from the
 * handler would follow the prompt: models answer the last user message, so the prompt must come
 * last. The session is idle while the handler runs (Pi queues a prompt sent while streaming
 * without raising the event), so `sendMessage` appends at once; it also runs after Pi's
 * pre-prompt compaction, which could otherwise summarize the context away before the prompt.
 * In a new session Pi writes the first system message with the prompt, so this context precedes
 * it in the session file; `leadingSystemMessage` puts it back in front for every request.
 */
export function beforePrompt(pi: ExtensionAPI, message: ContextMessage): void {
  pi.sendMessage(message, { triggerTurn: false });
}

/**
 * Keeps the session's first system message at index 0 of each request. Providers read the
 * prompt and initial tools from the leading system message; one that follows hidden context is
 * read as a mid-conversation update, and Anthropic sends that update after the user's prompt.
 * Only the request changes, and the same way every time, so the cached prefix stays stable.
 */
export function leadingSystemMessage(): ExtensionFactory {
  return (pi) => {
    pi.on('context_with_system', (event) => {
      const first = event.messages.findIndex((message) => message.role === 'system');
      const system = event.messages[first];
      if (first <= 0 || !system) return undefined;
      return { messages: [system, ...event.messages.filter((_, index) => index !== first)] };
    });
  };
}

/**
 * Tag of the run's material, which the service system prompt explains: the saved command's
 * instructions, attached files, quoted passages and resolved references that go with the user's
 * next message.
 */
const RUN_MATERIAL_TAG = 'run_material';

/** Sends the current run's material with each of its prompts, before the user's text. */
export function runMaterialContext(material: () => RunMaterial): ExtensionFactory {
  return (pi) => {
    pi.on('before_agent_start', () => {
      const text = formatMaterial(material());
      if (!text) return;
      beforePrompt(pi, {
        customType: 'app-material',
        content: `<${RUN_MATERIAL_TAG}>\n${text}\n</${RUN_MATERIAL_TAG}>`,
        display: false,
      });
    });
  };
}

function formatMaterial(material: RunMaterial): string {
  return [
    material.instructions,
    ...material.attachments.map(
      (file) =>
        `File: ${file.name}\nRead-only resource: ${file.path}\n<file-material>\n${file.text}\n</file-material>`,
    ),
    material.references,
  ]
    .filter(Boolean)
    .join('\n\n');
}
