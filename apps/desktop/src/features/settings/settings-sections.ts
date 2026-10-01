import { Blocks, Brain, Command, Keyboard, Plug, Shield } from 'lucide-react';

/** The settings destinations, in navigation order. */
export const settingsSections = [
  { id: 'permissions', labelKey: 'nav.permissions', icon: Shield },
  { id: 'extensions', labelKey: 'nav.extensions', icon: Blocks },
  { id: 'providers', labelKey: 'nav.providers', icon: Plug },
  { id: 'commands', labelKey: 'nav.commands', icon: Command },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain },
  { id: 'shortcuts', labelKey: 'nav.shortcuts', icon: Keyboard },
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionId = SettingsSection['id'];

export function findSettingsSection(id: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.id === id);
}
