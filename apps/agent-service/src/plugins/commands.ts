import type { ServiceCommandFull } from '@ai/agent-contracts';
import { ConflictError } from '../errors.js';
import { currentPluginComponents, type Mapped } from './components.js';
import { PluginHost } from './host.js';

/**
 * Installed plugins' commands as the command routes serve them (B3): listed beside the user's
 * saved commands with their `pluginId`, read-only except for `enabled`, which is the plugin
 * item's switch. They are never written to `commands.json`.
 */
export async function listPluginCommands(dataDir: string): Promise<ServiceCommandFull[]> {
  const { components } = await currentPluginComponents(dataDir, ['command']);
  return components.commands.map(({ value }) => value).sort((a, b) => a.name.localeCompare(b.name));
}

/** The plugin command `id` with its resolved item (its plugin and local name), or null. */
export async function findPluginCommand(
  dataDir: string,
  id: string,
): Promise<Mapped<ServiceCommandFull> | null> {
  const { components } = await currentPluginComponents(dataDir, ['command']);
  return components.commands.find(({ value }) => value.id === id) ?? null;
}

/** JSON with object keys sorted, so equal commands compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

function withoutState(command: ServiceCommandFull): Omit<ServiceCommandFull, 'enabled'> {
  const { enabled: _enabled, migratedAt: _migratedAt, ...rest } = command;
  return rest;
}

/**
 * Applies a full-replace update to a plugin command. Only `enabled` may change; it goes to the
 * plugin item's switch. Answers the command as the catalog now resolves it (still off while its
 * plugin is off).
 */
export async function updatePluginCommand(
  dataDir: string,
  { item, value: current }: Mapped<ServiceCommandFull>,
  next: ServiceCommandFull,
  expectedRevision: number,
): Promise<ServiceCommandFull> {
  if (expectedRevision !== current.revision)
    throw new ConflictError('This command changed. Reload before saving.');
  if (canonical(withoutState(next)) !== canonical(withoutState(current)))
    throw new TypeError(
      'Invalid data: commands from a plugin are read-only; only turning them on or off is allowed.',
    );
  const host = await PluginHost.for(dataDir);
  await host.installer.setItemEnabled(item.pluginId, `command:${item.localName}`, next.enabled);
  return (await findPluginCommand(dataDir, current.id))?.value ?? current;
}
