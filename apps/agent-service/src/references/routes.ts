import type { FastifyInstance } from 'fastify';
import {
  parse,
  StageReferencesRequestSchema,
  type StageReferencesResponse,
} from '@ai/agent-contracts';
import { stageTaskReferences } from './staging.js';

/**
 * `POST /v1/references/stage`, mounted with the management routes beside the
 * MCP stage route: staging validates the request shape only; whether each
 * reference still resolves is decided when the run freezes.
 */
export function registerReferenceStageRoute(app: FastifyInstance, ctx: { dataDir: string }): void {
  app.post('/v1/references/stage', async (request): Promise<StageReferencesResponse> => {
    const body = parse(StageReferencesRequestSchema, request.body);
    const staging = await stageTaskReferences(ctx.dataDir, body.taskId, body.references);
    return { taskId: body.taskId, references: staging.references, stagedAt: staging.stagedAt };
  });
}
