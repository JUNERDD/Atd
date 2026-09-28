import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  SkillHarnessRequestSchema,
  SkillName,
  SubagentPermissionsSchema,
  parse,
} from '@ai/agent-contracts';
import type { ServiceConfig } from '../config.js';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';
import { listAtdAgents, putAtdAgent } from './catalog.js';
import { readAgentHarness, setAgentHarnessEnabled, setAgentHarnessPermissions } from './harness.js';
import { defaultPermissions, effectivePermissions, overrideToStore } from './permissions.js';

/** A catalog name: `service.*` for the system agents, a bare file name for the specialists. */
const AgentCatalogName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
});

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
  defaults: defaultPermissions(definition.tools),
}));

/**
 * The whole catalog, system agents first, each with its enablement and the permissions later runs
 * use (its defaults, or the Settings override that replaces them).
 */
async function listCatalog(root: string) {
  const [{ agents }, harness] = await Promise.all([listAtdAgents(), readAgentHarness(root)]);
  const specialists = agents.map(({ tools, ...agent }) => ({
    ...agent,
    system: false,
    defaults: defaultPermissions(tools),
  }));
  return [...SYSTEM_AGENTS, ...specialists].map(({ defaults, ...agent }) => ({
    ...agent,
    enabled: !harness.disabled.has(agent.name),
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
  app.put<{ Params: { name: string } }>('/v1/agents/:name', async (request) => {
    const name = parse(SkillName, request.params.name);
    const body = parse(PutAtdAgentBodySchema, request.body);
    return putAtdAgent({
      name,
      description: body.description,
      tools: body.tools,
      model: body.model,
      systemPrompt: body.systemPrompt,
    });
  });
  app.post<{ Params: { name: string } }>('/v1/agents/:name/enabled', async (request) => {
    const name = parse(AgentCatalogName, request.params.name);
    const { enabled } = parse(SkillHarnessRequestSchema, request.body);
    await catalogAgent(config.paths.root, name);
    await setAgentHarnessEnabled(config.paths.root, name, enabled);
    return { name, enabled };
  });
  // Saves the permissions later runs give one agent; an override equal to its defaults is removed.
  app.put<{ Params: { name: string } }>('/v1/agents/:name/permissions', async (request) => {
    const name = parse(AgentCatalogName, request.params.name);
    const requested = parse(SubagentPermissionsSchema, request.body);
    const { defaults } = await catalogAgent(config.paths.root, name);
    const override = overrideToStore(requested, defaults);
    await setAgentHarnessPermissions(config.paths.root, name, override);
    return { name, ...effectivePermissions(defaults, override ?? undefined) };
  });
  // Restores one agent's default permissions for later runs.
  app.delete<{ Params: { name: string } }>('/v1/agents/:name/permissions', async (request) => {
    const name = parse(AgentCatalogName, request.params.name);
    const { defaults } = await catalogAgent(config.paths.root, name);
    await setAgentHarnessPermissions(config.paths.root, name, null);
    return { name, ...effectivePermissions(defaults, undefined) };
  });
}
