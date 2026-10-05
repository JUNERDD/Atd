import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { SkillHarnessRequestSchema, SubagentPermissionsSchema, parse } from '@atd/agent-contracts';
import { isItemName, parseQualifiedName } from '@atd/plugin-kit';
import type { ServiceConfig } from '../config.js';
import { ConflictError } from '../errors.js';
import { currentPluginComponents } from '../plugins/components.js';
import { CORE_PLUGIN, USER_PLUGIN } from '../plugins/host-plugins.js';
import { PluginHost } from '../plugins/host.js';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';
import { deleteAtdAgent, listAtdAgents, putAtdAgent } from './catalog.js';
import {
  forgetAgentHarness,
  readAgentHarness,
  setAgentHarnessEnabled,
  setAgentHarnessPermissions,
} from './harness.js';
import { defaultPermissions, effectivePermissions, overrideToStore } from './permissions.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

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
 * `diagnostics` are the `~/.atd/agents` files that did not load, with why (atd-agents/catalog.ts).
 */
async function listCatalog(root: string) {
  const [{ agents, diagnostics }, harness, plugins] = await Promise.all([
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
  return {
    agents: [...hosted, ...installed].map(({ defaults, ...agent }) => ({
      ...agent,
      ...effectivePermissions(defaults, harness.permissions.get(agent.name)),
      defaults,
    })),
    diagnostics,
  };
}

async function catalogAgent(root: string, name: string) {
  const agent = (await listCatalog(root)).agents.find((entry) => entry.name === name);
  if (!agent) throw new Error(`Agent "${name}" is not in the subagent catalog.`);
  return agent;
}

/**
 * HTTP mounts for the subagent catalog: the system agents, then the ~/.atd/agents markdown
 * specialists. Only the specialists' files are writable or deletable; any catalog agent can be turned off for
 * later runs, which then neither register it nor resolve a reference to it, and any can carry a
 * permission override that later runs apply (run-freeze.ts).
 */
export function registerAtdAgentRoutes(app: FastifyInstance, config: ServiceConfig): void {
  app.get('/v1/agents', RENDERER_ROUTE, async () => listCatalog(config.paths.root));
  // Writes a `~/.atd/agents` file; plugin subagents are read-only, so names stay bare here.
  app.put<{ Params: { name: string } }>('/v1/agents/:name', RENDERER_ROUTE, async (request) => {
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
  // Deletes a `~/.atd/agents` specialist and what Settings kept for it; system and plugin
  // subagents are read-only. Runs already accepted keep the agents they registered.
  app.delete<{ Params: { name: string } }>('/v1/agents/:name', RENDERER_ROUTE, async (request) => {
    const name = catalogName(request.params.name);
    const { readOnly } = await catalogAgent(config.paths.root, name);
    if (readOnly) throw new ConflictError(`Agent "${name}" is read-only and cannot be deleted.`);
    if (!(await deleteAtdAgent(name))) throw new Error(`Agent "${name}" has no file to delete.`);
    await forgetAgentHarness(config.paths.root, name);
    return { name, deleted: true };
  });
  // A plugin subagent's switch is its plugin item (installer state); the others', the harness.
  app.post<{ Params: { name: string } }>(
    '/v1/agents/:name/enabled',
    RENDERER_ROUTE,
    async (request) => {
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
    },
  );
  // Saves the permissions later runs give one agent; an override equal to its defaults is removed.
  app.put<{ Params: { name: string } }>(
    '/v1/agents/:name/permissions',
    RENDERER_ROUTE,
    async (request) => {
      const name = catalogName(request.params.name);
      const requested = parse(SubagentPermissionsSchema, request.body);
      const { defaults } = await catalogAgent(config.paths.root, name);
      const override = overrideToStore(requested, defaults);
      await setAgentHarnessPermissions(config.paths.root, name, override);
      return { name, ...effectivePermissions(defaults, override ?? undefined) };
    },
  );
  // Restores one agent's default permissions for later runs.
  app.delete<{ Params: { name: string } }>(
    '/v1/agents/:name/permissions',
    RENDERER_ROUTE,
    async (request) => {
      const name = catalogName(request.params.name);
      const { defaults } = await catalogAgent(config.paths.root, name);
      await setAgentHarnessPermissions(config.paths.root, name, null);
      return { name, ...effectivePermissions(defaults, undefined) };
    },
  );
}
