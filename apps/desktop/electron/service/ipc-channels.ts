/**
 * Service IPC channel names. Schema-free so the sandboxed preload can import it without bundling
 * typebox or the request schemas.
 */
export const SERVICE_IPC = {
  request: 'service:request',
  changed: 'service:changed',
} as const;
