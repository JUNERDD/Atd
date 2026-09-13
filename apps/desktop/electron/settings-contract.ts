import type { Connection, ProviderBridge } from './providers/schema';
import type { GenerationBridge } from './agent/generation-contract';

export const SETTINGS_IPC = {
  open: 'settings:open',
  close: 'settings:close',
  get: 'settings:get',
  saveShortcuts: 'settings:save-shortcuts',
  restoreShortcuts: 'settings:restore-shortcuts',
  changed: 'settings:changed',
} as const;

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
  connections: Connection[];
  defaultConnectionId: string | null;
  shortcuts: ShortcutBindings;
  pinned: boolean;
  shortcutAvailable: boolean;
}

export interface SettingsBridge {
  open: () => Promise<void>;
  close: () => Promise<void>;
  get: () => Promise<SettingsSnapshot>;
  providers: ProviderBridge;
  generation: GenerationBridge;
  saveShortcuts: (shortcuts: ShortcutBindings) => Promise<SettingsSnapshot>;
  restoreShortcuts: () => Promise<SettingsSnapshot>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
}
