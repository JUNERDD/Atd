import { createElement, Fragment } from 'react';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { lazyWithPreload } from '../../lib/lazy-with-preload';
import type { SettingsSectionId } from './settings-sections';

const agent = lazyWithPreload(() =>
  import('./agent-settings').then((module) => module.AgentSettings),
);
const providers = lazyWithPreload(() =>
  import('./provider-settings').then((module) => module.ProviderSettingsForm),
);
const permissions = lazyWithPreload(() =>
  Promise.all([import('./permission-settings'), import('./shell-allowlist-settings')]).then(
    ([{ PermissionSettings }, { ShellAllowlistSettings }]) => {
      function PermissionsSection({ snapshot }: { snapshot: SettingsSnapshot | null }) {
        return createElement(
          Fragment,
          null,
          createElement(PermissionSettings, { snapshot }),
          createElement(ShellAllowlistSettings, { snapshot }),
        );
      }
      return PermissionsSection;
    },
  ),
);
const computer = lazyWithPreload(() =>
  import('../computer/computer-settings').then((module) => module.ComputerSettings),
);
const commands = lazyWithPreload(() =>
  import('../commands/command-settings').then((module) => module.CommandSettings),
);
const automations = lazyWithPreload(() =>
  import('../automations/automation-settings').then((module) => module.AutomationSettings),
);
const memory = lazyWithPreload(() =>
  import('../memory/memory-settings').then((module) => module.MemorySettings),
);
const apps = lazyWithPreload(() =>
  import('../apps/app-settings').then((module) => module.AppSettings),
);
const extensions = lazyWithPreload(() =>
  import('../service/service-settings').then((module) => module.ServiceSettings),
);
const about = lazyWithPreload(() =>
  import('./about-settings').then((module) => module.AboutSettings),
);

export const AgentSettings = agent.Component;
export const ProviderSettingsForm = providers.Component;
export const PermissionsSettings = permissions.Component;
export const ComputerSettings = computer.Component;
export const CommandSettings = commands.Component;
export const AutomationSettings = automations.Component;
export const MemorySettings = memory.Component;
export const AppSettings = apps.Component;
export const ServiceSettings = extensions.Component;
export const AboutSettings = about.Component;

const sectionPreloaders: Partial<Record<SettingsSectionId, () => Promise<unknown>>> = {
  agent: agent.preload,
  providers: providers.preload,
  permissions: permissions.preload,
  computer: computer.preload,
  commands: commands.preload,
  automations: automations.preload,
  memory: memory.preload,
  apps: apps.preload,
  extensions: extensions.preload,
  about: about.preload,
};

/** Begins loading a non-general settings section chunk if it has not been requested yet. */
export function preloadSettingsSection(id: SettingsSectionId): void {
  void sectionPreloaders[id]?.();
}
