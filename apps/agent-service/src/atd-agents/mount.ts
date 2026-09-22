import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { SkillName, parse } from '@ai/agent-contracts';
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

/** HTTP mounts for the ~/.atd/agents markdown specialist catalog. */
export function registerAtdAgentRoutes(app: FastifyInstance): void {
  app.get('/v1/agents', async () => {
    const { agents } = await listAtdAgents();
    return { agents };
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
