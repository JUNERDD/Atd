import type { ParseKeys } from 'i18next';
import { Languages, type LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from './settings-sections';

/** The namespaces whose existing copy the index reuses; `settings` is the default one. */
export const SEARCH_NAMESPACES = ['settings', 'commands', 'memory', 'apps'] as const;
export type SearchKey = ParseKeys<typeof SEARCH_NAMESPACES>;

/**
 * One findable setting or group. Copy is referenced by i18n key so the labels and descriptions the
 * pages already show are the ones searched; `keywords` is a space-separated list of aliases
 * (`search.keywords.*`) for words the visible copy does not contain.
 */
export interface SettingsSearchEntry {
  id: string;
  /** The section the entry lives in; null for a control outside every section, such as the header. */
  section: SettingsSectionId | null;
  /** The `data-settings-anchor` to reveal; without one the section page opens at its top. */
  anchor?: string;
  /** Replaces the section's icon in the results. */
  icon?: LucideIcon;
  label: SearchKey;
  description?: SearchKey;
  keywords: SearchKey;
}

/** Each section's own description, shown under its row in the results. */
export const SECTION_DESCRIPTIONS = {
  general: 'general.description',
  providers: 'providers.overview.description',
  permissions: 'permissions.description',
  commands: 'commands:list.description',
  memory: 'memory:memory.description',
  apps: 'apps:settings.description',
  extensions: 'extensions.plugins.description',
} as const satisfies Record<SettingsSectionId, SearchKey>;

export const SECTION_KEYWORDS = {
  general: 'search.keywords.sectionGeneral',
  providers: 'search.keywords.sectionProviders',
  permissions: 'search.keywords.sectionPermissions',
  commands: 'search.keywords.sectionCommands',
  memory: 'search.keywords.sectionMemory',
  apps: 'search.keywords.sectionApps',
  extensions: 'search.keywords.sectionExtensions',
} as const satisfies Record<SettingsSectionId, SearchKey>;

/**
 * The settings inside the sections, in page order. The sections themselves are entries too (see
 * `useSettingsSearch`). Anchors exist only where the owning page marks them with
 * `data-settings-anchor`; entries of pages without markers open the section overview.
 */
export const settingsSearchEntries: readonly SettingsSearchEntry[] = [
  ...(
    [
      'togglePanel',
      'captureScreenshot',
      'newConversation',
      'openSettings',
      'sendMessage',
      'newLine',
    ] as const
  ).map((action): SettingsSearchEntry => ({
    id: `shortcut-${action}`,
    section: 'general',
    anchor: `shortcut-${action}`,
    label: `shortcuts.actions.${action}.label`,
    description: `shortcuts.actions.${action}.description`,
    keywords: 'search.keywords.shortcutAction',
  })),
  {
    id: 'window-open-at-login',
    section: 'general',
    anchor: 'settings-open-at-login',
    label: 'shortcuts.openAtLogin',
    description: 'shortcuts.preferenceNotes.openAtLogin',
    keywords: 'search.keywords.openAtLogin',
  },
  {
    id: 'window-show-in-dock',
    section: 'general',
    anchor: 'settings-show-in-dock',
    label: 'shortcuts.showInDock',
    description: 'shortcuts.preferenceNotes.showInDock',
    keywords: 'search.keywords.showInDock',
  },
  {
    id: 'window-always-on-top',
    section: 'general',
    anchor: 'settings-always-on-top',
    label: 'shortcuts.alwaysOnTop',
    description: 'shortcuts.preferenceNotes.alwaysOnTop',
    keywords: 'search.keywords.alwaysOnTop',
  },
  {
    id: 'window-mini-panel',
    section: 'general',
    anchor: 'settings-mini-panel',
    label: 'shortcuts.miniPanel',
    description: 'shortcuts.preferenceNotes.miniPanel',
    keywords: 'search.keywords.miniPanel',
  },
  {
    id: 'window-mini-panel-open',
    section: 'general',
    anchor: 'settings-mini-panel-open',
    label: 'shortcuts.miniPanelOpenOn.title',
    description: 'shortcuts.miniPanelOpenOn.description',
    keywords: 'search.keywords.miniPanelOpenOn',
  },
  {
    id: 'selection-toolbar',
    section: 'general',
    anchor: 'settings-selection-toolbar',
    label: 'selectionToolbar.enabled',
    description: 'selectionToolbar.enabledDescription',
    keywords: 'search.keywords.selectionToolbar',
  },
  {
    id: 'selection-toolbar-activation',
    section: 'general',
    anchor: 'settings-selection-toolbar-activation',
    label: 'selectionToolbar.activation.title',
    description: 'selectionToolbar.activation.description',
    keywords: 'search.keywords.selectionToolbarActivation',
  },
  {
    id: 'selection-toolbar-hud',
    section: 'general',
    anchor: 'settings-selection-toolbar-hud',
    label: 'selectionToolbar.hud.title',
    description: 'selectionToolbar.hud.description',
    keywords: 'search.keywords.selectionToolbarHud',
  },
  {
    id: 'selection-toolbar-apps',
    section: 'general',
    anchor: 'settings-selection-toolbar-apps',
    label: 'selectionToolbar.excluded.title',
    description: 'selectionToolbar.excluded.description',
    keywords: 'search.keywords.selectionToolbarApps',
  },
  {
    id: 'shortcuts-restore-defaults',
    section: 'general',
    anchor: 'shortcuts-restore-defaults',
    label: 'shortcuts.restoreDefaults',
    keywords: 'search.keywords.restoreDefaults',
  },
  {
    id: 'providers-default-model',
    section: 'providers',
    label: 'providers.overview.defaultModel',
    description: 'providers.overview.description',
    keywords: 'search.keywords.defaultModel',
  },
  {
    id: 'providers-connected',
    section: 'providers',
    label: 'providers.overview.connectedProviders',
    keywords: 'search.keywords.connectedProviders',
  },
  {
    id: 'providers-add',
    section: 'providers',
    label: 'providers.overview.addProvider',
    keywords: 'search.keywords.addProvider',
  },
  {
    id: 'permission-manual',
    section: 'permissions',
    anchor: 'permission-tier-manual',
    label: 'permissions.tiers.manual.label',
    description: 'permissions.tiers.manual.description',
    keywords: 'search.keywords.tierManual',
  },
  {
    id: 'permission-auto',
    section: 'permissions',
    anchor: 'permission-tier-auto',
    label: 'permissions.tiers.auto.label',
    description: 'permissions.tiers.auto.description',
    keywords: 'search.keywords.tierAuto',
  },
  {
    id: 'permission-always',
    section: 'permissions',
    anchor: 'permission-tier-always',
    label: 'permissions.tiers.always.label',
    description: 'permissions.tiers.always.description',
    keywords: 'search.keywords.tierAlways',
  },
  {
    id: 'shell-allowlist',
    section: 'permissions',
    anchor: 'shell-allowlist',
    label: 'permissions.shellAllowlist.title',
    description: 'permissions.shellAllowlist.description',
    keywords: 'search.keywords.allowlist',
  },
  {
    id: 'commands-new',
    section: 'commands',
    label: 'search.entries.newCommand',
    description: 'commands:list.description',
    keywords: 'search.keywords.newCommand',
  },
  {
    id: 'memory-learning',
    section: 'memory',
    label: 'memory:memory.learning.label',
    description: 'memory:memory.learning.description',
    keywords: 'search.keywords.memoryLearning',
  },
  {
    id: 'memory-create',
    section: 'memory',
    label: 'memory:memory.create.label',
    keywords: 'search.keywords.memoryCreate',
  },
  {
    id: 'memory-profile',
    section: 'memory',
    label: 'memory:memory.list.userProfile',
    keywords: 'search.keywords.memoryProfile',
  },
  {
    id: 'memory-corrections',
    section: 'memory',
    label: 'memory:memory.list.corrections',
    keywords: 'search.keywords.memoryCorrections',
  },
  {
    id: 'extensions-install-plugin',
    section: 'extensions',
    label: 'extensions.plugins.installPlugin',
    description: 'extensions.plugins.description',
    keywords: 'search.keywords.installPlugin',
  },
  {
    id: 'extensions-skills',
    section: 'extensions',
    label: 'extensions.plugins.kinds.skill',
    keywords: 'search.keywords.skills',
  },
  {
    id: 'extensions-subagents',
    section: 'extensions',
    label: 'extensions.plugins.kinds.agent',
    keywords: 'search.keywords.subagents',
  },
  {
    id: 'extensions-mcp',
    section: 'extensions',
    label: 'extensions.plugins.kinds.mcp',
    keywords: 'search.keywords.mcp',
  },
  {
    id: 'language',
    section: null,
    anchor: 'language',
    icon: Languages,
    label: 'language.label',
    keywords: 'search.keywords.language',
  },
];
