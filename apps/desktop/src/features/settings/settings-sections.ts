import {
  AppWindow,
  Blocks,
  Brain,
  Command,
  Info,
  MousePointerClick,
  Plug,
  Settings,
  Shield,
  Zap,
} from 'lucide-react';
import { appWindowMotion } from '@atd/ui/lib/icon-motions/app-window';
import { blocksMotion } from '@atd/ui/lib/icon-motions/blocks';
import { brainMotion } from '@atd/ui/lib/icon-motions/brain';
import { commandMotion } from '@atd/ui/lib/icon-motions/command';
import { infoMotion } from '@atd/ui/lib/icon-motions/info';
import { mousePointerClickMotion } from '@atd/ui/lib/icon-motions/mouse-pointer-click';
import { plugMotion } from '@atd/ui/lib/icon-motions/plug';
import { settingsMotion } from '@atd/ui/lib/icon-motions/settings';
import { shieldMotion } from '@atd/ui/lib/icon-motions/shield';
import { zapMotion } from '@atd/ui/lib/icon-motions/zap';

/** The destinations the navigation lists from its top, in order. */
const listedSections = [
  { id: 'general', labelKey: 'nav.general', icon: Settings, motion: settingsMotion },
  { id: 'providers', labelKey: 'nav.providers', icon: Plug, motion: plugMotion },
  { id: 'permissions', labelKey: 'nav.permissions', icon: Shield, motion: shieldMotion },
  {
    id: 'computer',
    labelKey: 'nav.computer',
    icon: MousePointerClick,
    motion: mousePointerClickMotion,
  },
  { id: 'commands', labelKey: 'nav.commands', icon: Command, motion: commandMotion },
  { id: 'automations', labelKey: 'nav.automations', icon: Zap, motion: zapMotion },
  { id: 'memory', labelKey: 'nav.memory', icon: Brain, motion: brainMotion },
  { id: 'apps', labelKey: 'nav.apps', icon: AppWindow, motion: appWindowMotion },
  { id: 'extensions', labelKey: 'nav.extensions', icon: Blocks, motion: blocksMotion },
] as const;

/** The destinations pinned to the navigation's bottom edge, after the listed ones. */
export const settingsFooterSections = [
  { id: 'about', labelKey: 'nav.about', icon: Info, motion: infoMotion },
] as const;

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
