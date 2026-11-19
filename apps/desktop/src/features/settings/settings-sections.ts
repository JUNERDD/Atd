import {
  AppWindow,
  Blocks,
  Bot,
  Brain,
  Command,
  Info,
  MousePointerClick,
  Plug,
  Settings,
  Shield,
  Stethoscope,
  Zap,
} from 'lucide-react';
import { appWindowMotion } from '@atd/ui/lib/icon-motions/app-window';
import { blocksMotion } from '@atd/ui/lib/icon-motions/blocks';
import { botMotion } from '@atd/ui/lib/icon-motions/bot';
import { brainMotion } from '@atd/ui/lib/icon-motions/brain';
import { commandMotion } from '@atd/ui/lib/icon-motions/command';
import { infoMotion } from '@atd/ui/lib/icon-motions/info';
import { mousePointerClickMotion } from '@atd/ui/lib/icon-motions/mouse-pointer-click';
import { plugMotion } from '@atd/ui/lib/icon-motions/plug';
import { settingsMotion } from '@atd/ui/lib/icon-motions/settings';
import { shieldMotion } from '@atd/ui/lib/icon-motions/shield';
import { stethoscopeMotion } from '@atd/ui/lib/icon-motions/stethoscope';
import { zapMotion } from '@atd/ui/lib/icon-motions/zap';

/** The destinations the navigation lists from its top, in order. */
export const settingsListedSections = [
  { id: 'general', labelKey: 'nav.general', icon: Settings, motion: settingsMotion },
  { id: 'agent', labelKey: 'nav.agent', icon: Bot, motion: botMotion },
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

/** The row pinned to the navigation's bottom edge, after the listed ones. */
export const settingsFooterSection = {
  id: 'about',
  labelKey: 'nav.about',
  icon: Info,
  motion: infoMotion,
} as const;

/** The icon button at the footer row's trailing end; its label names it and is its tooltip. */
export const settingsFooterIconSection = {
  id: 'diagnostics',
  labelKey: 'nav.diagnostics',
  icon: Stethoscope,
  motion: stethoscopeMotion,
} as const;

/** Every settings destination, in navigation order. */
export const settingsSections = [
  ...settingsListedSections,
  settingsFooterSection,
  settingsFooterIconSection,
] as const;

export type SettingsSection = (typeof settingsSections)[number];
export type SettingsSectionId = SettingsSection['id'];

export function findSettingsSection(id: string): SettingsSection | undefined {
  return settingsSections.find((section) => section.id === id);
}
