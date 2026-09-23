/**
 * Provider IPC channel names. Schema-free so the sandboxed preload can import it without bundling
 * typebox or the provider schemas.
 */
export const PROVIDER_IPC = {
  catalog: 'providers:catalog',
  save: 'providers:save',
  default: 'providers:default',
  model: 'providers:model',
  levels: 'providers:levels',
  disconnect: 'providers:disconnect',
  refresh: 'providers:refresh',
  verify: 'providers:verify',
  login: 'providers:login',
  answer: 'providers:answer',
  cancel: 'providers:cancel',
  loginEvent: 'providers:login-event',
  openLink: 'providers:open-link',
} as const;
