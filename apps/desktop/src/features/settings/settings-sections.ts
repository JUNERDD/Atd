import { AppWindow, Blocks, Brain, Command, Plug, Settings, Shield } from 'lucide-react';

/** The settings destinations, in navigation order. */
export const settingsSections = [
  { id: 'general', labelKey: 'nav.general', icon: Settings },
  { id: 'providers', labelKey: 'nav.providers', icon: Plug },
  { id: 'permissions', labelKey: 'nav.permissions', icon: Shield },
  { id: 'commands', labelKey: 'nav.commands', icon: Command },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain },
  { id: 'apps', labelKey: 'nav.apps', icon: AppWindow },
  { id: 'extensions', labelKey: 'nav.extensions', icon: Blocks },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionId = SettingsSection['id'];

export function findSettingsSection(id: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.id === id);
}
