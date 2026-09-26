import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { SkillHarnessRequestSchema, SkillName, parse } from '@ai/agent-contracts';
import type { ServiceConfig } from '../config.js';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';
import { listAtdAgents, putAtdAgent } from './catalog.js';
import { readDisabledAgentNames, setAgentHarnessEnabled } from './enablement.js';

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

/**
 * The service subagents every session registers, as read-only catalog rows. Their tools are
 * whatever the parent's ceiling admits, so no list of their own.
 */
const SYSTEM_AGENTS = SERVICE_RUNTIME_AGENTS.map(({ name, definition }) => ({
  name,
  description: definition.description,
  tools: [],
  model: null,
  systemPrompt: definition.systemPrompt,
  system: true,
}));

/** The whole catalog, system agents first, each with its enablement for later runs. */
async function listCatalog(root: string) {
  const [{ agents }, disabled] = await Promise.all([listAtdAgents(), readDisabledAgentNames(root)]);
  return [...SYSTEM_AGENTS, ...agents.map((agent) => ({ ...agent, system: false }))].map(
    (agent) => ({ ...agent, enabled: !disabled.has(agent.name) }),
  );
}

/**
 * HTTP mounts for the subagent catalog: the system agents, then the ~/.atd/agents markdown
 * specialists. Only the specialists are writable; any catalog agent can be turned off for later
 * runs, which then neither register it nor resolve a reference to it (run-freeze.ts).
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
    const catalog = await listCatalog(config.paths.root);
    if (!catalog.some((agent) => agent.name === name))
      throw new Error(`Agent "${name}" is not in the subagent catalog.`);
    await setAgentHarnessEnabled(config.paths.root, name, enabled);
    return { name, enabled };
  });
}
