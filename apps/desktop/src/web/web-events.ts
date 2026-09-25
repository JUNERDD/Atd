import type { ExtensionSessionKind } from '../../electron/agent/bridge';

/**
 * Messages between the web client's tabs. The desktop routes these through the main process
 * between its settings and panel windows; in the browser the settings page is another tab of
 * the same origin, so they travel on a `BroadcastChannel`.
 */
export type TabMessage =
  /** Settings → panel: open the command editor session (`null` creates a command). */
  | { type: 'commandSession'; commandId: string | null }
  /** Settings → panel: start a create-with-AI session. */
  | { type: 'extensionSession'; kind: ExtensionSessionKind }
  /** Panel → settings: show one command's editor in an already open settings tab. */
  | { type: 'openCommand'; commandId: string };

export interface WebEvents {
  post(message: TabMessage): void;
  listen(listener: (message: TabMessage) => void): () => void;
}

/** Cross-tab messages; a tab never receives its own posts, as with desktop IPC. */
export function webEvents(): WebEvents {
  const channel = new BroadcastChannel('ai-web-client');
  const listeners = new Set<(message: TabMessage) => void>();
  channel.addEventListener('message', (event: MessageEvent<TabMessage>) => {
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
