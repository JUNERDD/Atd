import type { AgentRequest, ExtensionSessionKind } from '../client/agent/bridge';

/**
 * Messages between the shell's panel and settings windows. The shell's web views share the
 * `ai-app://renderer` origin, so they travel on a `BroadcastChannel` without a round trip through
 * Swift.
 */
export type WindowMessage =
  /** Settings → panel: open the command editor session (`null` creates a command). */
  | { type: 'commandSession'; commandId: string | null }
  /**
   * Settings → panel: run a command from the settings list. The panel shows a launched command,
   * so it also prepares it: a screenshot command then captures with the panel out of the way.
   */
  | { type: 'launchCommand'; request: Extract<AgentRequest, { action: 'launch' }> }
  /** Settings → panel: start a create-with-AI session, or an edit session when `target` is set. */
  | { type: 'extensionSession'; kind: ExtensionSessionKind; target: string | null }
  /** Panel → settings: show one command's editor in an already open settings window. */
  | { type: 'openCommand'; commandId: string }
  /**
   * Panel → settings: what the shell answered for the latest global shortcut set, posted after
   * every push and in reply to `shortcutStateRequest`. Only the panel pushes the set, so it alone
   * learns the answer.
   */
  | { type: 'shortcutState'; panelAvailable: boolean; errors: Record<string, string> }
  /** Settings → panel: a settings window that just loaded asks for the latest `shortcutState`. */
  | { type: 'shortcutStateRequest' };

export interface WindowMessages {
  post(message: WindowMessage): void;
  listen(listener: (message: WindowMessage) => void): () => void;
}

/** Cross-window messages; a window never receives its own posts. */
export function windowMessages(): WindowMessages {
  const channel = new BroadcastChannel('ai-windows');
  const listeners = new Set<(message: WindowMessage) => void>();
  channel.addEventListener('message', (event: MessageEvent<WindowMessage>) => {
    for (const listener of listeners) listener(event.data);
  });
  return {
    post: (message) => channel.postMessage(message),
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
