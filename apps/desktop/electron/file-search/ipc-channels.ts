/**
 * Panel-only channels, kept apart from `agent:request`, which also trusts the settings window.
 * Schema-free so the sandboxed preload can import it without bundling typebox.
 */
export const FILE_SEARCH_IPC = {
  search: 'files:search',
  attach: 'files:attach',
} as const;
