export const SETTINGS_IPC = {
  open: 'settings:open',
  close: 'settings:close',
  get: 'settings:get',
  saveProvider: 'settings:save-provider',
  testProvider: 'settings:test-provider',
  saveShortcuts: 'settings:save-shortcuts',
  restoreShortcuts: 'settings:restore-shortcuts',
  changed: 'settings:changed',
} as const;

export type ProviderId = 'openai' | 'openai-compatible';

export interface ProviderSettings {
  id: ProviderId;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface ProviderDraft {
  id: ProviderId;
  baseUrl: string;
  model: string;
  /** Omitted preserves the stored key; an empty string removes it. */
  apiKey?: string;
}

export const DEFAULT_SHORTCUTS = {
  togglePanel: 'CommandOrControl+Shift+Space',
  newConversation: 'CommandOrControl+N',
  openSettings: 'CommandOrControl+,',
  sendMessage: 'Enter',
  newLine: 'Shift+Enter',
} as const;

export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type ShortcutBindings = Record<ShortcutAction, string>;

export interface SettingsSnapshot {
  provider: ProviderSettings;
  shortcuts: ShortcutBindings;
  account: { name: string; kind: 'local' };
  pinned: boolean;
  shortcutAvailable: boolean;
}

export interface ProviderConnection {
  models: string[];
}

export interface SettingsBridge {
  open: () => Promise<void>;
  close: () => Promise<void>;
  get: () => Promise<SettingsSnapshot>;
  saveProvider: (provider: ProviderDraft) => Promise<SettingsSnapshot>;
  testProvider: (provider: ProviderDraft) => Promise<ProviderConnection>;
  saveShortcuts: (shortcuts: ShortcutBindings) => Promise<SettingsSnapshot>;
  restoreShortcuts: () => Promise<SettingsSnapshot>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
}
