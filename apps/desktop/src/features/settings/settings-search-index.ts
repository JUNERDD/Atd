import type { ParseKeys } from 'i18next';
import { Languages, type LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from './settings-sections';

/** The namespaces whose existing copy the index reuses; `settings` is the default one. */
export const SEARCH_NAMESPACES = ['settings', 'commands', 'memory'] as const;
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
  permissions: 'permissions.description',
  extensions: 'extensions.plugins.description',
  providers: 'providers.overview.description',
  commands: 'commands:list.description',
  memory: 'memory:memory.description',
  shortcuts: 'shortcuts.description',
} as const satisfies Record<SettingsSectionId, SearchKey>;

export const SECTION_KEYWORDS = {
  permissions: 'search.keywords.sectionPermissions',
  extensions: 'search.keywords.sectionExtensions',
  providers: 'search.keywords.sectionProviders',
  commands: 'search.keywords.sectionCommands',
  memory: 'search.keywords.sectionMemory',
  shortcuts: 'search.keywords.sectionShortcuts',
} as const satisfies Record<SettingsSectionId, SearchKey>;

/**
 * The settings inside the sections, in page order. The sections themselves are entries too (see
 * `useSettingsSearch`). Anchors exist only where the owning page marks them with
 * `data-settings-anchor`; entries of pages without markers open the section overview.
 */
export const settingsSearchEntries: readonly SettingsSearchEntry[] = [
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
  ...(['togglePanel', 'newConversation', 'openSettings', 'sendMessage', 'newLine'] as const).map(
    (action): SettingsSearchEntry => ({
      id: `shortcut-${action}`,
      section: 'shortcuts',
      anchor: `shortcut-${action}`,
      label: `shortcuts.actions.${action}.label`,
      description: `shortcuts.actions.${action}.description`,
      keywords: 'search.keywords.shortcutAction',
    }),
  ),
  {
    id: 'window-open-at-login',
    section: 'shortcuts',
    anchor: 'settings-open-at-login',
    label: 'shortcuts.openAtLogin',
    keywords: 'search.keywords.openAtLogin',
  },
  {
    id: 'window-show-in-dock',
    section: 'shortcuts',
    anchor: 'settings-show-in-dock',
    label: 'shortcuts.showInDock',
    keywords: 'search.keywords.showInDock',
  },
  {
    id: 'window-always-on-top',
    section: 'shortcuts',
    anchor: 'settings-always-on-top',
    label: 'shortcuts.alwaysOnTop',
    keywords: 'search.keywords.alwaysOnTop',
  },
  {
    id: 'shortcuts-restore-defaults',
    section: 'shortcuts',
    anchor: 'shortcuts-restore-defaults',
    label: 'shortcuts.restoreDefaults',
    keywords: 'search.keywords.restoreDefaults',
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
