import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { SkillName, parse } from '@ai/agent-contracts';
import { SERVICE_RUNTIME_AGENTS } from '../subagents/agents.js';
import { listAtdAgents, putAtdAgent } from './catalog.js';

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

/**
 * HTTP mounts for the subagent catalog: the system agents, then the ~/.atd/agents markdown
 * specialists. Only the specialists are writable.
 */
export function registerAtdAgentRoutes(app: FastifyInstance): void {
  app.get('/v1/agents', async () => {
    const { agents } = await listAtdAgents();
    return { agents: [...SYSTEM_AGENTS, ...agents.map((agent) => ({ ...agent, system: false }))] };
  });
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
}
