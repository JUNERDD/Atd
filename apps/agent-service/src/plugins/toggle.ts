import type { PluginItemKind } from '@atd/agent-contracts';
import type { ResolvedItem } from '@atd/plugin-kit';
import { setAgentHarnessEnabled } from '../atd-agents/harness.js';
import { CommandStore } from '../commands/store.js';
import { LedgerNotFound } from '../ledger.js';
import type { McpAuthority } from '../mcp/index.js';
import type { MemoryAuthority } from '../memory/index.js';
import { setSkillHarnessEnabled } from '../skills/harness.js';
import { skillProfilePaths } from '../skills/profile.js';
import { findPlugin } from './detail.js';
import type { PluginHost, PluginView } from './host.js';

/** What a plugin switch may reach: the plugin host, and the authorities that own host items. */
export interface PluginActions {
  host: PluginHost;
  view: PluginView;
  memory: () => Promise<MemoryAuthority>;
  mcp: () => Promise<McpAuthority>;
}

export function findItem(
  view: PluginView,
  pluginId: string,
  kind: PluginItemKind,
  name: string,
): ResolvedItem {
  const item = view.catalog.items.find(
    (entry) => entry.pluginId === pluginId && entry.kind === kind && entry.localName === name,
  );
  if (!item) throw new LedgerNotFound('Plugin item', `${pluginId}/${kind}/${name}`);
  return item;
}

/**
 * Turns a whole plugin on or off. An installed or shared plugin's switch is installer state; System
 * and Personal have no switch.
 */
export async function setPluginEnabled(
  actions: PluginActions,
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  const plugin = findPlugin(actions.view, pluginId);
  if (!plugin.toggleable)
    throw new TypeError(`Invalid request: the ${plugin.name} plugin cannot be turned off.`);
  await actions.host.installer.setPluginEnabled(pluginId, enabled);
}

/**
 * Turns one item on or off in the store that owns its switch: installer state for installed
 * plugins; for host plugins the skill or agent harness, the command's `enabled`, the MCP record's
 * `disabled` (through the MCP authority, which disconnects it), or, for Personal's memory, the
 * learning pause of Memory settings (D5), never a copy of it.
 */
export async function setItemEnabled(
  actions: PluginActions,
  pluginId: string,
  kind: PluginItemKind,
  name: string,
  enabled: boolean,
): Promise<void> {
  const { host, view } = actions;
  findItem(view, pluginId, kind, name);
  if (findPlugin(view, pluginId).origin === 'installed') {
    await host.installer.setItemEnabled(pluginId, `${kind}:${name}`, enabled);
    return;
  }
  switch (kind) {
    case 'memory':
      await (await actions.memory()).setSettings({ paused: !enabled });
      return;
    case 'skill':
      await setSkillHarnessEnabled(skillProfilePaths(host.dataDir, host.agentDir), name, enabled);
      return;
    case 'agent':
      await setAgentHarnessEnabled(host.dataDir, name, enabled);
      return;
    case 'command': {
      const store = await CommandStore.load(host.dataDir);
      const command = store.get(name);
      await store.update(name, { ...command, enabled }, command.revision);
      return;
    }
    case 'mcp':
      await (await actions.mcp()).setEnabled(name, enabled);
      return;
  }
}
