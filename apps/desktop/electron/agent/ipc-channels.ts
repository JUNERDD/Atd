/**
 * Agent IPC channel names. This module stays free of schemas and imports because the sandboxed
 * preload bundles everything it imports; channel names here keep typebox out of every window.
 */
export const AGENT_IPC = {
  request: 'agent:request',
  changed: 'agent:changed',
  launch: 'agent:launch',
  session: 'agent:command-session',
  extensionSession: 'agent:extension-session',
} as const;
