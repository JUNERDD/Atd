import { AppWindow, Blocks, Brain, Command, Info, Plug, Settings, Shield, Zap } from 'lucide-react';

/** The destinations the navigation lists from its top, in order. */
const listedSections = [
  { id: 'general', labelKey: 'nav.general', icon: Settings },
  { id: 'providers', labelKey: 'nav.providers', icon: Plug },
  { id: 'permissions', labelKey: 'nav.permissions', icon: Shield },
  { id: 'commands', labelKey: 'nav.commands', icon: Command },
  { id: 'automations', labelKey: 'nav.automations', icon: Zap },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain },
  { id: 'apps', labelKey: 'nav.apps', icon: AppWindow },
  { id: 'extensions', labelKey: 'nav.extensions', icon: Blocks },
] as const;

/** The destinations pinned to the navigation's bottom edge, after the listed ones. */
export const settingsFooterSections = [{ id: 'about', labelKey: 'nav.about', icon: Info }] as const;

/** Every settings destination, in navigation order. */
export const settingsSections = [...listedSections, ...settingsFooterSections] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionId = SettingsSection['id'];

/** Whether the navigation pins `id` to its bottom edge. */
export function isSettingsFooterSection(id: SettingsSectionId): boolean {
  return settingsFooterSections.some((section) => section.id === id);
}

export function findSettingsSection(id: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.id === id);
}
