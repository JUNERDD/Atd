import type { ExtensionSessionKind } from '../client/agent/bridge';

/**
 * Messages between the shell's panel and settings windows. Electron routes these through its main
 * process; the shell's web views share the `ai-app://renderer` origin, so they travel on a
 * `BroadcastChannel` without a round trip through Swift.
 */
export type WindowMessage =
  /** Settings → panel: open the command editor session (`null` creates a command). */
  | { type: 'commandSession'; commandId: string | null }
  /** Settings → panel: start a create-with-AI session, or an edit session when `target` is set. */
  | { type: 'extensionSession'; kind: ExtensionSessionKind; target: string | null }
  /** Panel → settings: show one command's editor in an already open settings window. */
  | { type: 'openCommand'; commandId: string };

export interface WindowMessages {
  post(message: WindowMessage): void;
  listen(listener: (message: WindowMessage) => void): () => void;
}

/** Cross-window messages; a window never receives its own posts, as with desktop IPC. */
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
