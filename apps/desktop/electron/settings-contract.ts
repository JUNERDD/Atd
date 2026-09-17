import type { Connection, ProviderBridge } from './providers/schema';

export const SETTINGS_IPC = {
  open: 'settings:open',
  openCommand: 'settings:open-command',
  close: 'settings:close',
  get: 'settings:get',
  startCommandSession: 'settings:start-command-session',
  saveLanguage: 'settings:save-language',
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

/** Languages the desktop UI ships translations for. English is the source language. */
export const LANGUAGE_CODES = ['en', 'zh-CN'] as const;
export type AppLanguage = (typeof LANGUAGE_CODES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Maps an Electron or browser locale such as `zh-Hans-CN` to the nearest shipped language. */
export function resolveLanguage(locale: string): AppLanguage {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export interface SettingsSnapshot {
  connections: Connection[];
  defaultConnectionId: string | null;
  language: AppLanguage;
  shortcuts: ShortcutBindings;
  pinned: boolean;
  shortcutAvailable: boolean;
}

export interface SettingsBridge {
  open: () => Promise<void>;
  openCommand: (commandId: string) => Promise<void>;
  /** Opens the command's editor content in a new task-panel session; null creates a new command. */
  startCommandSession: (commandId: string | null) => Promise<void>;
  close: () => Promise<void>;
  get: () => Promise<SettingsSnapshot>;
  providers: ProviderBridge;
  setLanguage: (language: AppLanguage) => Promise<SettingsSnapshot>;
  saveShortcuts: (shortcuts: ShortcutBindings) => Promise<SettingsSnapshot>;
  restoreShortcuts: () => Promise<SettingsSnapshot>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
  onOpenCommand: (listener: (commandId: string) => void) => () => void;
}
