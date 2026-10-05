import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { appExtension } from '../apps/tool.js';
import { askUserExtension } from './ask-user.js';
import type { HarnessDeps } from './deps.js';
import { memoryExtension } from './memory-extension.js';
import { retiredMessagesExtension } from './retired-messages.js';
import { searchToolsExtension } from './search-tools.js';
import { todoExtension } from './todo-extension.js';
import { webExtension } from './web-extension.js';

export type { HarnessDeps } from './deps.js';
export {
  createGate,
  type Gate,
  type GateHost,
  type GateOutcome,
  type GateRequest,
} from './gate.js';

/**
 * The parent session's harness extensions, in registration order. pi-session.ts calls this once
 * per Pi session and appends the result to its extension factories; each feature owns its own
 * factory module, so adding behavior never edits the session assembly. Every tool registered
 * here must also be in the run binding's allowlist (run-binding.ts), or Pi drops it.
 */
export async function prepareHarness(deps: HarnessDeps): Promise<ExtensionFactory[]> {
  const memory = await memoryExtension(deps);
  return [
    askUserExtension(deps),
    searchToolsExtension(deps),
    todoExtension(deps),
    webExtension(deps),
    appExtension(deps),
    retiredMessagesExtension(),
    ...(memory ? [memory] : []),
  ];
}
