import type { ModelAlias, ModelSelection } from '@atd/agent-contracts';
import type { Connection, ProviderBridge } from './providers/schema';
import type { AutomationSessionTarget, ExtensionSessionKind } from './agent/session-handoff';
import type { PermissionTier } from './agent/permission-schema';
import type {
  AppAppearance,
  AppLanguage,
  ExcludedApp,
  LongScreenshotConfirmAction,
  MiniPanelOpenOn,
  NextStepClick,
  PanelBackground,
  PanelPlacement,
  ScreenshotConfirmAction,
  SelectionToolbarSettings,
  SettingsItemLink,
  ShortcutBindings,
  ViewInitiative,
} from './settings-defaults';

export {
  APP_APPEARANCES,
  DEFAULT_COMMAND_TYPING,
  DEFAULT_COMMAND_TYPING_ANIMATION,
  DEFAULT_GLOW_EFFECTS,
  DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_NEXT_STEP_CLICK,
  DEFAULT_NEXT_STEPS,
  DEFAULT_PANEL_BACKGROUND,
  DEFAULT_RESULT_MARKDOWN,
  DEFAULT_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_SCREENSHOT_CONFIRM_IN_COMPOSER,
  DEFAULT_SELECTION_TOOLBAR,
  DEFAULT_SUMMARY_TITLES,
  DEFAULT_VIEW_INITIATIVE,
  isAppAppearance,
  isAppLanguage,
  isLongScreenshotConfirmAction,
  isScreenshotConfirmAction,
  isViewInitiative,
  LANGUAGE_CODES,
  LONG_SCREENSHOT_CONFIRM_ACTIONS,
  MAX_EXCLUDED_APPS,
  MINI_PANEL_OPEN_ON,
  PANEL_GLASS_TUNING_RANGE,
  PANEL_GLASS_VARIANTS,
  PANEL_PLACEMENTS,
  PANEL_TINTS,
  PANEL_TONE_RANGE,
  resolveLanguage,
  SCREENSHOT_CONFIRM_ACTIONS,
  SELECTION_TOOLBAR_ACTIVATIONS,
  SELECTION_TOOLBAR_ICON_MODES,
  SELECTION_TOOLBAR_KEYS,
  SELECTION_TOOLBAR_POSITIONS,
  SettingsItemLinkSchema,
  VIEW_INITIATIVES,
  type AppAppearance,
  type AppLanguage,
  type ExcludedApp,
  type LongScreenshotConfirmAction,
  type MiniPanelOpenOn,
  type NextStepClick,
  type PanelBackground,
  type PanelGlassVariant,
  type PanelPlacement,
  type PanelTint,
  type ScreenshotConfirmAction,
  type SelectionToolbarActivation,
  type SelectionToolbarIconMode,
  type SelectionToolbarKey,
  type SelectionToolbarPosition,
  type SelectionToolbarSettings,
  type SettingsItemLink,
  type ShortcutAction,
  type ShortcutBindings,
  type ViewInitiative,
} from './settings-defaults';
export interface SettingsSnapshot {
  connections: Connection[];
  defaultConnectionId: string | null;
  aliases: ModelAlias[];
  defaultAliasId: string | null;
  /**
   * Whether the provider connections were read. They load apart from the shared settings, and
   * until they arrive `connections` is empty, which must not be taken for having none.
   */
  providersLoaded: boolean;
  /** Whether keyring readability was probed for loaded connections in this epoch. */
  providerStatusesChecked: boolean;
  language: AppLanguage;
  /** The pinned color scheme; null follows the system. Unlike `language`, never resolved here. */
  appearance: AppAppearance | null;
  /**
   * Whether the app's decorative glows show and running text shimmers, in the renderer and the
   * shell's surfaces alike; the service's default until it loads.
   */
  glowEffects: boolean;
  /**
   * Whether the shell's floating result cards render Markdown rather than plain text; the
   * service's default until it loads.
   */
  resultMarkdown: boolean;
  /** The panel's and floating surfaces' fill and glass; the service's default until it loads. */
  panelBackground: PanelBackground;
  /** Null reads screens with the task model; a selection uses a separate image model. */
  computerVisionModel: ModelSelection | null;
  shortcuts: ShortcutBindings;
  pinned: boolean;
  /** macOS window preference; the web client always reports false. */
  showInDock: boolean;
  /**
   * The OS login item, read live rather than stored; null where it is unavailable (development
   * builds, Linux, the web client).
   */
  openAtLogin: boolean | null;
  /**
   * Whether macOS can configure this app's widgets: false while it runs outside `/Applications`
   * and `~/Applications` (the shell's `app.state`). True until the shell answers; optional for
   * test hosts, which read as available.
   */
  widgetsAvailable?: boolean;
  /**
   * Whether the shell shows the mini panel on the screen edge. It follows every change, the menu
   * bar's toggle and the mini panel's own Hide included; null until the shell reports it. Optional
   * for test hosts, which read as not reported.
   */
  miniPanelShown?: boolean | null;
  /**
   * How the mini panel opens (`MINI_PANEL_OPEN_ON`), following every change, its context menu's
   * included; null until the shell reports it. Optional for test hosts, which read as not reported.
   */
  miniPanelOpenOn?: MiniPanelOpenOn | null;
  /**
   * Where summons show the panel (`PANEL_PLACEMENTS`); null until the shell reports it. Optional
   * for test hosts, which read as not reported.
   */
  panelPlacement?: PanelPlacement | null;
  /** Whether the shell registered the panel shortcut; null until the panel reports it. */
  shortcutAvailable: boolean | null;
  /** Whether the shell registered the screenshot shortcut; null until the panel reports it. */
  screenshotShortcutAvailable: boolean | null;
  /** Whether the shell registered the record-screen shortcut; null until the panel reports it. */
  recordShortcutAvailable: boolean | null;
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
  /** Toolbar ✓ confirm action for screenshots (`DEFAULT_SCREENSHOT_CONFIRM_ACTION`). */
  screenshotConfirmAction: ScreenshotConfirmAction;
  /** Whether `screenshotConfirmAction` applies to composer `+ › Screenshot` (`DEFAULT_SCREENSHOT_CONFIRM_IN_COMPOSER`). */
  screenshotConfirmInComposer: boolean;
  /** Done action in long screenshot (`DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION`). */
  longScreenshotConfirmAction: LongScreenshotConfirmAction;
  /**
   * Whether write-back command answers are typed into other apps rather than pasted at once; the
   * service's default until it loads.
   */
  commandTyping: boolean;
  /**
   * Whether written-back answers leave a trace over the field as they land (a glow at the insertion
   * point, a wash behind the new text), typed or pasted at once. The service keeps it unchosen
   * (null) until the user picks it or first turns the typing effect on, which turns it on; until
   * then, and until the service loads, it reads as the default.
   */
  commandTypingAnimation: boolean;
  /**
   * How readily the agent shows interactive views (`VIEW_INITIATIVES`); each run freezes the level
   * as it starts. The service's default until it loads.
   */
  viewInitiative: ViewInitiative;
  /** Whether new conversations receive an asynchronously generated summary title. */
  summaryTitles: boolean;
  /** Whether finished conversations get suggested next steps. */
  nextSteps: boolean;
  /** What a click on a suggested follow-up does: put it in the composer or send it at once. */
  nextStepClick: NextStepClick;
  /**
   * Whether macOS trusts the app for Accessibility, which selection capture and the toolbar need;
   * null until the shell reports it.
   */
  accessibilityTrusted: boolean | null;
  /**
   * Whether this running app may capture the screen, which screenshots need (Screen Recording);
   * null until the shell reports it. macOS applies a new grant only to a relaunched app, so it can
   * stay false after the user allows it.
   */
  screenRecordingTrusted: boolean | null;
  /**
   * Whether the user explicitly finished or dismissed the welcome guide. False after an
   * interrupted guide, so the next launch resumes it. True until service settings load.
   */
  onboardingCompleted: boolean;
}

export interface SettingsBridge {
  open: () => Promise<void>;
  openCommand: (commandId: string) => Promise<void>;
  /** Shows the settings window at `section` (a settings section id), open or not. */
  openSection: (section: string) => Promise<void>;
  /** Shows the settings window at one saved item's page, open or not. */
  openItem: (item: SettingsItemLink) => Promise<void>;
  /** Opens the command's editor content in a new task-panel session; null creates a new command. */
  startCommandSession: (commandId: string | null) => Promise<void>;
  /**
   * Opens a new task-panel session seeded with the `create-automation` skill: an edit session for
   * the saved automation `automation` names, or a create session when it is null.
   */
  startAutomationSession: (automation: AutomationSessionTarget) => Promise<void>;
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
  /** Pins the light or dark scheme; null follows the system. */
  setAppearance: (appearance: AppAppearance | null) => Promise<SettingsSnapshot>;
  /** Shows or leaves out the decorative glows and the running-text shimmer everywhere. */
  setGlowEffects: (enabled: boolean) => Promise<SettingsSnapshot>;
  /** Renders Markdown on the floating result cards, or shows their text plain. */
  setResultMarkdown: (enabled: boolean) => Promise<SettingsSnapshot>;
  /** Replaces the whole panel background setting. */
  setPanelBackground: (background: PanelBackground) => Promise<SettingsSnapshot>;
  setComputerVisionModel: (model: ModelSelection | null) => Promise<SettingsSnapshot>;
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
  setScreenshotConfirmAction: (action: ScreenshotConfirmAction) => Promise<SettingsSnapshot>;
  setScreenshotConfirmInComposer: (enabled: boolean) => Promise<SettingsSnapshot>;
  setLongScreenshotConfirmAction: (
    action: LongScreenshotConfirmAction,
  ) => Promise<SettingsSnapshot>;
  /** Sets how write-back command answers arrive in other apps. */
  saveCommandTyping: (value: boolean) => Promise<SettingsSnapshot>;
  /** Sets whether written-back answers leave a trace over the field they land in. */
  saveCommandTypingAnimation: (value: boolean) => Promise<SettingsSnapshot>;
  /** Sets how readily the agent shows interactive views; runs that start later use the new level. */
  setViewInitiative: (level: ViewInitiative) => Promise<SettingsSnapshot>;
  /** Applies to conversations created after this preference is saved. */
  setSummaryTitles: (enabled: boolean) => Promise<SettingsSnapshot>;
  /** Applies to runs that finish after this preference is saved. */
  setNextSteps: (enabled: boolean) => Promise<SettingsSnapshot>;
  /** Applies to suggestions clicked after this preference is saved; automations always confirm. */
  setNextStepClick: (value: NextStepClick) => Promise<SettingsSnapshot>;
  /**
   * Shows the system's Accessibility prompt while the app is not trusted and opens its pane in
   * System Settings; `accessibilityTrusted` follows the outcome.
   */
  requestAccessibility: () => Promise<void>;
  /**
   * Shows the system's Screen Recording prompt while the app may not capture the screen and opens
   * its pane in System Settings; `screenRecordingTrusted` follows the outcome.
   */
  requestScreenRecording: () => Promise<void>;
  /** The open panel on application bundles; empty when cancelled. */
  pickApps: () => Promise<ExcludedApp[]>;
  onChange: (listener: (settings: SettingsSnapshot) => void) => () => void;
  onOpenCommand: (listener: (commandId: string) => void) => () => void;
  /** A section another window asked an open settings window to show (`openSection`). */
  onOpenSection: (listener: (section: string) => void) => () => void;
  /**
   * An item another window asked this settings window to show (`openItem`): at once, the one left
   * for it while it was not open yet, then each one asked while it is open.
   */
  onOpenItem: (listener: (item: SettingsItemLink) => void) => () => void;
}
