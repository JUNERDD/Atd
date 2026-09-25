import { APP_LANGUAGES, type AppLanguage } from '@ai/agent-contracts';
import type { Connection, ProviderBridge } from './providers/schema';
import type { PermissionTier } from './agent/permission-schema';

export const SETTINGS_IPC = {
  open: 'settings:open',
  openCommand: 'settings:open-command',
  close: 'settings:close',
  get: 'settings:get',
  startCommandSession: 'settings:start-command-session',
  startExtensionSession: 'settings:start-extension-session',
  saveLanguage: 'settings:save-language',
  saveShortcuts: 'settings:save-shortcuts',
  restoreShortcuts: 'settings:restore-shortcuts',
  savePermissionTier: 'settings:save-permission-tier',
  saveShellAllowlist: 'settings:save-shell-allowlist',
  addShellAllowlistEntry: 'settings:add-shell-allowlist-entry',
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

/** Languages the UI ships translations for; the list lives in the contracts all clients share. */
export const LANGUAGE_CODES = APP_LANGUAGES;
export type { AppLanguage };

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
  /** Tier new tasks are created with; existing tasks keep their own tier. */
  permissionTier: PermissionTier;
  /**
   * The user's shell allowlist, in the user's order: commands matching an entry run without a
   * confirm (`isShellAllowlisted` in `@ai/agent-contracts`). Main persists it and pushes the full
   * list to the service on every connection and change; the operator's
   * `AI_AGENT_SHELL_ALLOWLIST` applies on the service side and is not listed here.
   */
  shellAllowlist: string[];
}

export interface SettingsBridge {
  open: () => Promise<void>;
  openCommand: (commandId: string) => Promise<void>;
  /** Opens the command's editor content in a new task-panel session; null creates a new command. */
  startCommandSession: (commandId: string | null) => Promise<void>;
  /** Opens a new task-panel session seeded for creating a skill, subagent, or MCP server. */
  startExtensionSession: (kind: 'skill' | 'subagent' | 'mcp') => Promise<void>;
  close: () => Promise<void>;
  get: () => Promise<SettingsSnapshot>;
  providers: ProviderBridge;
  setLanguage: (language: AppLanguage) => Promise<SettingsSnapshot>;
  saveShortcuts: (shortcuts: ShortcutBindings) => Promise<SettingsSnapshot>;
  restoreShortcuts: () => Promise<SettingsSnapshot>;
  setPermissionTier: (tier: PermissionTier) => Promise<SettingsSnapshot>;
  /**
   * Replaces the shell allowlist (settings window). Main normalizes each entry with
   * `normalizeShellAllowlistEntry`, rejects invalid entries, duplicates or more than
   * `SHELL_ALLOWLIST_MAX_ENTRIES`, then persists and pushes the list.
   */
  saveShellAllowlist: (entries: string[]) => Promise<SettingsSnapshot>;
  /**
   * Appends one entry: the bash confirm's add-to-allowlist choice (panel) or the settings page.
   * An entry already listed leaves the list unchanged; an invalid entry or a full list rejects.
   */
  addShellAllowlistEntry: (entry: string) => Promise<SettingsSnapshot>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
  onOpenCommand: (listener: (commandId: string) => void) => () => void;
}
