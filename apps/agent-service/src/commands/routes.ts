import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  CommandCreateSchema,
  CommandUpdateRequestSchema,
  Identifier,
  parse,
} from '@ai/agent-contracts';
import { CommandStore } from './store.js';

export interface CommandRouteContext {
  dataDir: string;
}

const RevisionQuery = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Live command routes (T6b). The store loads per request like the T2
 * migration precedent; each mutation serializes through its own chain and
 * lands via atomic write. Revisions guard every mutation (409 on drift).
 */
export function registerCommandRoutes(app: FastifyInstance, ctx: CommandRouteContext): void {
  const store = () => CommandStore.load(ctx.dataDir);

  app.get('/v1/commands', async () => ({
    commands: (await store()).list(),
  }));

  app.get<{ Params: { id: string } }>('/v1/commands/:id', async (request) => ({
    command: (await store()).get(parse(Identifier, request.params.id)),
  }));

  app.post('/v1/commands', async (request) => ({
    command: await (await store()).create(parse(CommandCreateSchema, request.body)),
  }));

  app.put<{ Params: { id: string } }>('/v1/commands/:id', async (request) => {
    const id = parse(Identifier, request.params.id);
    const body = parse(CommandUpdateRequestSchema, request.body);
    return { command: await (await store()).update(id, body.command, body.expectedRevision) };
  });

  app.delete<{ Params: { id: string } }>('/v1/commands/:id', async (request) => {
    const id = parse(Identifier, request.params.id);
    // Query values arrive as strings; coerce before the integer check so
    // `?revision=2` validates while `?revision=next` still answers 400.
    const raw = (request.query as { revision?: unknown }).revision;
    const query = parse(RevisionQuery, {
      revision: typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw,
    });
    await (await store()).remove(id, query.revision);
    return { deleted: true as const, id };
  });
}
