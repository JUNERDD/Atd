import {
  APP_LANGUAGES,
  DEFAULT_SHORTCUTS,
  type AppLanguage,
  type ExcludedApp,
  type SelectionToolbarSettings,
} from '@atd/agent-contracts';
import type { Connection, ProviderBridge } from './providers/schema';
import type { ExtensionSessionKind } from './agent/bridge';
import type { PermissionTier } from './agent/permission-schema';

export type ShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type ShortcutBindings = Record<ShortcutAction, string>;

/** Languages the UI ships translations for; the list lives in the contracts all clients share. */
export const LANGUAGE_CODES = APP_LANGUAGES;
export type { AppLanguage, ExcludedApp, SelectionToolbarSettings };

/** The selection toolbar before the service's settings load, as the service defaults it. */
export const DEFAULT_SELECTION_TOOLBAR: SelectionToolbarSettings = {
  enabled: true,
  excludedApps: [],
};

/** Apps the selection toolbar can be kept away from (`SelectionToolbarSettingsSchema`). */
export const MAX_EXCLUDED_APPS = 100;

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Maps an OS or browser locale such as `zh-Hans-CN` to the nearest shipped language. */
export function resolveLanguage(locale: string): AppLanguage {
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export interface SettingsSnapshot {
  connections: Connection[];
  defaultConnectionId: string | null;
  language: AppLanguage;
  shortcuts: ShortcutBindings;
  pinned: boolean;
  /** macOS window preference; the web client always reports false. */
  showInDock: boolean;
  /**
   * The OS login item, read live rather than stored; null where it is unavailable (development
   * builds, Linux, the web client).
   */
  openAtLogin: boolean | null;
  /** Whether the shell registered the panel shortcut; null until the panel reports it. */
  shortcutAvailable: boolean | null;
  /** Whether the shell registered the screenshot shortcut; null until the panel reports it. */
  screenshotShortcutAvailable: boolean | null;
  /** Tier new tasks are created with; existing tasks keep their own tier. */
  permissionTier: PermissionTier;
  /**
   * The user's shell allowlist, in the user's order: commands matching an entry run without a
   * confirm (`isShellAllowlisted` in `@atd/agent-contracts`). Main persists it and pushes the full
   * list to the service on every connection and change; the operator's
   * `AI_AGENT_SHELL_ALLOWLIST` applies on the service side and is not listed here.
   */
  shellAllowlist: string[];
  /** The toolbar the shell shows over text selected in other apps, and the apps it skips. */
  selectionToolbar: SelectionToolbarSettings;
  /**
   * Whether macOS trusts the app for Accessibility, which selection capture and the toolbar need;
   * null until the shell reports it.
   */
  accessibilityTrusted: boolean | null;
}

export interface SettingsBridge {
  open: () => Promise<void>;
  openCommand: (commandId: string) => Promise<void>;
  /** Opens the command's editor content in a new task-panel session; null creates a new command. */
  startCommandSession: (commandId: string | null) => Promise<void>;
  /**
   * Opens a new task-panel session seeded for creating a skill, subagent, MCP server, or memory.
   * `target` names an existing skill, subagent, or MCP serverId to edit instead; omitted or null
   * creates. Memory takes no target.
   */
  startExtensionSession: (kind: ExtensionSessionKind, target?: string | null) => Promise<void>;
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
  /** Replaces the selection toolbar settings as a whole. */
  saveSelectionToolbar: (value: SelectionToolbarSettings) => Promise<SettingsSnapshot>;
  /**
   * Shows the system's Accessibility prompt while the app is not trusted and opens its pane in
   * System Settings; `accessibilityTrusted` follows the outcome.
   */
  requestAccessibility: () => Promise<void>;
  /** The open panel on application bundles; empty when cancelled. */
  pickApps: () => Promise<ExcludedApp[]>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
  onOpenCommand: (listener: (commandId: string) => void) => () => void;
}
