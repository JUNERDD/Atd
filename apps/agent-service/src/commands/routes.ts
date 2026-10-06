import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  CommandCreateSchema,
  CommandRunRequestSchema,
  CommandUpdateRequestSchema,
  Identifier,
  parse,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { findPluginCommand, listPluginCommands, updatePluginCommand } from '../plugins/commands.js';
import { CommandLaunchError, launchCommand, type LaunchCommandDeps } from './launch.js';
import { CommandStore } from './store.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface CommandRouteContext {
  dataDir: string;
  /** What `POST /v1/commands/:id/run` launches a command with (launch.ts). */
  launch: LaunchCommandDeps;
}

const RevisionQuery = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Live command routes (T6b). The store loads per request; each mutation
 * serializes through its own chain and lands via atomic write. Revisions guard every mutation (409 on drift).
 * Installed plugins' commands (plugins/commands.ts) are listed after the user's, carry their
 * `pluginId`, accept only an `enabled` change and cannot be deleted. `POST /v1/commands/:id/run`
 * launches one (launch.ts), answering like a task submit.
 */
export function registerCommandRoutes(app: FastifyInstance, ctx: CommandRouteContext): void {
  const store = () => CommandStore.load(ctx.dataDir);

  app.get('/v1/commands', RENDERER_ROUTE, async () => ({
    commands: [...(await store()).list(), ...(await listPluginCommands(ctx.dataDir))],
  }));

  app.get<{ Params: { id: string } }>('/v1/commands/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(Identifier, request.params.id);
    return { command: (await pluginCommand(ctx.dataDir, id))?.value ?? (await store()).get(id) };
  });

  app.post('/v1/commands', RENDERER_ROUTE, async (request) => ({
    command: await (await store()).create(parse(CommandCreateSchema, request.body)),
  }));

  app.put<{ Params: { id: string } }>('/v1/commands/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(Identifier, request.params.id);
    const body = parse(CommandUpdateRequestSchema, request.body);
    const plugin = await pluginCommand(ctx.dataDir, id);
    if (!plugin)
      return { command: await (await store()).update(id, body.command, body.expectedRevision) };
    const command = await updatePluginCommand(
      ctx.dataDir,
      plugin,
      body.command,
      body.expectedRevision,
    );
    // The store announces its own writes; a plugin item switch is announced here.
    CommandStore.announce(ctx.dataDir);
    return { command };
  });

  app.post<{ Params: { id: string } }>('/v1/commands/:id/run', RENDERER_ROUTE, async (request) => {
    const commandId = parse(Identifier, request.params.id);
    const body = parse(CommandRunRequestSchema, request.body);
    try {
      return await launchCommand(ctx.launch, { ...body, commandId });
    } catch (error) {
      throw error instanceof CommandLaunchError ? launchFailure(error, commandId) : error;
    }
  });

  app.delete<{ Params: { id: string } }>('/v1/commands/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(Identifier, request.params.id);
    if (await pluginCommand(ctx.dataDir, id))
      throw new TypeError(
        'Invalid request: commands from a plugin cannot be deleted; turn them off or uninstall the plugin.',
      );
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

/** A refused launch as the server's error handler answers it: 404, 409 or 400. */
function launchFailure(error: CommandLaunchError, id: string): Error {
  switch (error.code) {
    case 'notFound':
      return new LedgerNotFound('Command', id);
    case 'disabled':
      return new ConflictError(error.message);
    case 'invalidInput':
      return new TypeError(error.message);
  }
}

/** The plugin command `id`, unless the user's store holds that id (user commands win). */
async function pluginCommand(dataDir: string, id: string) {
  const store = await CommandStore.load(dataDir);
  try {
    store.get(id);
    return null;
  } catch (error) {
    if (!(error instanceof LedgerNotFound)) throw error;
  }
  return findPluginCommand(dataDir, id);
}
