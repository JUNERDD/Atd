import type { HostPlugin, HostPluginItem, PluginItemKind } from '@ai/plugin-kit';
import { listAtdAgents } from '../atd-agents/catalog.js';
import { readAgentHarness } from '../atd-agents/harness.js';
import { isBuiltinSkill } from '../builtins/manifest.js';
import { CommandStore } from '../commands/store.js';
import { logMemoryEvents, MemoryAuthority } from '../memory/authority.js';
import { readMemoryPause } from '../memory/pause.js';
import { loadServerRecords } from '../mcp/servers.js';
import { discoverAtdSkills } from '../skills/atd-skills.js';
import { readDisabledSkillNames } from '../skills/harness.js';
import { skillProfilePaths } from '../skills/profile.js';
import { discoverUserAgentSkills } from '../skills/user-agents.js';
import type { Logger } from '../logging.js';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';

/** The plugins the service synthesizes from its own stores. Installed ids never contain `:`. */
export const CORE_PLUGIN = 'builtin:core';
export const USER_PLUGIN = 'user';
export const SHARED_PLUGIN = 'shared:agents-skills';
export const HOST_PLUGIN_IDS: readonly string[] = [CORE_PLUGIN, USER_PLUGIN, SHARED_PLUGIN];

/**
 * Personal's memory item: the single Hermes authority (D5). Memory is part of the user's own
 * extensions rather than an extension of its own, listed once it holds entries; the item's switch
 * is the persisted memory pause.
 */
export const MEMORY_ITEM = 'hermes';

/** Key of one item in `HostCatalog.descriptions`. */
export function hostItemKey(pluginId: string, kind: PluginItemKind, name: string): string {
  return `${pluginId}\0${kind}\0${name}`;
}

/**
 * The host plugins with their items as each host store reports them. Item switches are the stores'
 * own: the skill and agent harnesses, each command's `enabled`, each MCP record's `disabled`.
 * Personal commands are listed by command id, since command names need not be unique.
 */
export interface HostCatalog {
  plugins: HostPlugin[];
  descriptions: ReadonlyMap<string, string>;
  /** Display titles of items whose name is not what users read: Personal commands (by id). */
  titles: ReadonlyMap<string, string>;
}

/**
 * A store read that only lists items: when it fails, the plugin view shows none of them and the
 * store's own section reports the error. Runs never depended on these reads, so a broken
 * `commands.json` or `servers.json` must not stop them now that every run resolves plugins.
 */
async function listed<T>(read: Promise<T>, fallback: T, store: string, log: Logger): Promise<T> {
  try {
    return await read;
  } catch (error) {
    log.warn('A store could not be listed in the plugin view.', { store, error: String(error) });
    return fallback;
  }
}

export async function loadHostPlugins(
  dataDir: string,
  agentDir: string,
  log: Logger,
): Promise<HostCatalog> {
  const profile = skillProfilePaths(dataDir, agentDir);
  const [atd, shared, skillsOff, agents, harness, commands, servers, memoryPaused, memories] =
    await Promise.all([
      discoverAtdSkills(),
      discoverUserAgentSkills(),
      readDisabledSkillNames(profile),
      listed(listAtdAgents(), { agents: [], diagnostics: [] }, 'agents', log),
      readAgentHarness(dataDir),
      listed(
        CommandStore.load(dataDir).then((store) => store.list()),
        [],
        'commands',
        log,
      ),
      listed(loadServerRecords(dataDir), [], 'mcp', log),
      listed(readMemoryPause(agentDir), false, 'memory pause', log),
      listed(
        MemoryAuthority.authorityFor(agentDir, logMemoryEvents(log)).then(
          async (memory) => (await memory.list()).length,
        ),
        0,
        'memory',
        log,
      ),
    ]);
  const descriptions = new Map<string, string>();
  const titles = new Map<string, string>();
  const add = (
    pluginId: string,
    kind: PluginItemKind,
    name: string,
    enabled: boolean,
    description: string,
  ): HostPluginItem => {
    descriptions.set(hostItemKey(pluginId, kind, name), description);
    return { kind, name, enabled };
  };
  const skillItem = (pluginId: string, skill: { name: string; description: string }) =>
    add(pluginId, 'skill', skill.name, !skillsOff.has(skill.name), skill.description);
  const core: HostPlugin = {
    id: CORE_PLUGIN,
    name: 'Core',
    description: 'Skills and subagents that ship with the app.',
    toggleable: false,
    items: [
      ...atd.skills
        .filter((skill) => isBuiltinSkill(skill.name))
        .map((skill) => skillItem(CORE_PLUGIN, skill)),
      ...SERVICE_RUNTIME_AGENTS.map((agent) =>
        add(
          CORE_PLUGIN,
          'agent',
          agent.name,
          !harness.disabled.has(agent.name),
          agent.definition.description,
        ),
      ),
    ],
  };
  const user: HostPlugin = {
    id: USER_PLUGIN,
    name: 'Personal',
    description: 'Your own skills, subagents, commands, MCP servers and memory.',
    toggleable: false,
    items: [
      ...atd.skills
        .filter((skill) => !isBuiltinSkill(skill.name))
        .map((skill) => skillItem(USER_PLUGIN, skill)),
      ...agents.agents.map((agent) =>
        add(USER_PLUGIN, 'agent', agent.name, !harness.disabled.has(agent.name), agent.description),
      ),
      ...commands.map((command) => {
        titles.set(hostItemKey(USER_PLUGIN, 'command', command.id), command.name);
        return add(USER_PLUGIN, 'command', command.id, command.enabled, command.description);
      }),
      ...servers.map((server) =>
        add(
          USER_PLUGIN,
          'mcp',
          server.serverId,
          !server.disabled,
          server.stdio?.command ?? server.http?.url ?? '',
        ),
      ),
      // Listed once there is something remembered; on while learning runs (memory/pause.ts).
      ...(memories > 0
        ? [add(USER_PLUGIN, 'memory', MEMORY_ITEM, !memoryPaused, 'What the agent remembers.')]
        : []),
    ],
  };
  const sharedPlugin: HostPlugin = {
    id: SHARED_PLUGIN,
    name: 'Shared skills',
    description: 'Skills in ~/.agents/skills, shared with other agent apps.',
    toggleable: true,
    items: shared.skills.map((skill) => skillItem(SHARED_PLUGIN, skill)),
  };
  return { plugins: [core, user, sharedPlugin], descriptions, titles };
}
