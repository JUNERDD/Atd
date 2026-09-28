import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { SkillHarnessRequestSchema, SubagentPermissionsSchema, parse } from '@ai/agent-contracts';
import { isItemName, parseQualifiedName } from '@ai/plugin-kit';
import type { ServiceConfig } from '../config.js';
import { currentPluginComponents } from '../plugins/components.js';
import { CORE_PLUGIN, USER_PLUGIN } from '../plugins/host-plugins.js';
import { PluginHost } from '../plugins/host.js';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';
import { listAtdAgents, putAtdAgent } from './catalog.js';
import { readAgentHarness, setAgentHarnessEnabled, setAgentHarnessPermissions } from './harness.js';
import { defaultPermissions, effectivePermissions, overrideToStore } from './permissions.js';

/**
 * A catalog name: `service.<name>` for the system agents, a bare file name for the
 * `~/.atd/agents` specialists, `<plugin>:<item>` for an installed plugin's subagents.
 */
function catalogName(raw: string): string {
  const system = raw.startsWith('service.') && isItemName(raw.slice('service.'.length));
  if (system || parseQualifiedName(raw)) return raw;
  throw new TypeError(`Invalid agent name "${raw.slice(0, 200)}".`);
}

const PutAtdAgentBodySchema = Type.Object(
  {
    description: Type.String({ minLength: 1, maxLength: 2048 }),
    tools: Type.Array(
      Type.Union([
        Type.Literal('read'),
        Type.Literal('write'),
        Type.Literal('edit'),
        Type.Literal('bash'),
        Type.Literal('command'),
      ]),
      { maxItems: 8 },
    ),
    model: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    systemPrompt: Type.String({ minLength: 1, maxLength: 16000 }),
  },
  { additionalProperties: false },
);

/** The service subagents every session registers, as read-only catalog rows. */
const SYSTEM_AGENTS = SERVICE_RUNTIME_AGENTS.map(({ name, definition }) => ({
  name,
  description: definition.description,
  model: null,
  systemPrompt: definition.systemPrompt,
  system: true,
  pluginId: CORE_PLUGIN,
  readOnly: true,
  defaults: defaultPermissions(definition.tools),
}));

/**
 * The whole catalog: system agents, `~/.atd/agents` specialists, then installed plugins'
 * subagents, each with the plugin that contributes it, its enablement and the permissions later
 * runs use (its defaults, or the Settings override that replaces them). A plugin subagent is
 * enabled when effective (its item and its plugin, D4); the others follow the agent harness.
 */
async function listCatalog(root: string) {
  const [{ agents }, harness, plugins] = await Promise.all([
    listAtdAgents(),
    readAgentHarness(root),
    currentPluginComponents(root, ['agent']),
  ]);
  const specialists = agents.map(({ tools, ...agent }) => ({
    ...agent,
    system: false,
    pluginId: USER_PLUGIN,
    readOnly: false,
    defaults: defaultPermissions(tools),
  }));
  const hosted = [...SYSTEM_AGENTS, ...specialists].map((agent) => ({
    ...agent,
    enabled: !harness.disabled.has(agent.name),
  }));
  const installed = plugins.components.agents.map(({ item, value }) => ({
    name: value.name,
    description: value.description,
    model: null,
    systemPrompt: value.systemPrompt,
    system: false,
    pluginId: value.pluginId,
    readOnly: true,
    defaults: defaultPermissions(value.tools ?? undefined),
    enabled: item.enabled,
  }));
  return [...hosted, ...installed].map(({ defaults, ...agent }) => ({
    ...agent,
    ...effectivePermissions(defaults, harness.permissions.get(agent.name)),
    defaults,
  }));
}

async function catalogAgent(root: string, name: string) {
  const agent = (await listCatalog(root)).find((entry) => entry.name === name);
  if (!agent) throw new Error(`Agent "${name}" is not in the subagent catalog.`);
  return agent;
}

/**
 * HTTP mounts for the subagent catalog: the system agents, then the ~/.atd/agents markdown
 * specialists. Only the specialists' files are writable; any catalog agent can be turned off for
 * later runs, which then neither register it nor resolve a reference to it, and any can carry a
 * permission override that later runs apply (run-freeze.ts).
 */
export function registerAtdAgentRoutes(app: FastifyInstance, config: ServiceConfig): void {
  app.get('/v1/agents', async () => ({ agents: await listCatalog(config.paths.root) }));
  // Writes a `~/.atd/agents` file; plugin subagents are read-only, so names stay bare here.
  app.put<{ Params: { name: string } }>('/v1/agents/:name', async (request) => {
    const name = request.params.name;
    if (!isItemName(name)) throw new TypeError(`Invalid agent name "${name.slice(0, 200)}".`);
    const body = parse(PutAtdAgentBodySchema, request.body);
    return putAtdAgent({
      name,
      description: body.description,
      tools: body.tools,
      model: body.model,
      systemPrompt: body.systemPrompt,
    });
  });
  // A plugin subagent's switch is its plugin item (installer state); the others', the harness.
  app.post<{ Params: { name: string } }>('/v1/agents/:name/enabled', async (request) => {
    const name = catalogName(request.params.name);
    const { enabled } = parse(SkillHarnessRequestSchema, request.body);
    const { pluginId } = await catalogAgent(config.paths.root, name);
    if (pluginId === CORE_PLUGIN || pluginId === USER_PLUGIN)
      await setAgentHarnessEnabled(config.paths.root, name, enabled);
    else {
      const { components } = await currentPluginComponents(config.paths.root, ['agent']);
      const item = components.agents.find(({ value }) => value.name === name)?.item;
      if (!item) throw new Error(`Agent "${name}" is not in the subagent catalog.`);
      const host = await PluginHost.for(config.paths.root);
      await host.installer.setItemEnabled(item.pluginId, `agent:${item.localName}`, enabled);
    }
    return { name, enabled };
  });
  // Saves the permissions later runs give one agent; an override equal to its defaults is removed.
  app.put<{ Params: { name: string } }>('/v1/agents/:name/permissions', async (request) => {
    const name = catalogName(request.params.name);
    const requested = parse(SubagentPermissionsSchema, request.body);
    const { defaults } = await catalogAgent(config.paths.root, name);
    const override = overrideToStore(requested, defaults);
    await setAgentHarnessPermissions(config.paths.root, name, override);
    return { name, ...effectivePermissions(defaults, override ?? undefined) };
  });
  // Restores one agent's default permissions for later runs.
  app.delete<{ Params: { name: string } }>('/v1/agents/:name/permissions', async (request) => {
    const name = catalogName(request.params.name);
    const { defaults } = await catalogAgent(config.paths.root, name);
    await setAgentHarnessPermissions(config.paths.root, name, null);
    return { name, ...effectivePermissions(defaults, undefined) };
  });
}
