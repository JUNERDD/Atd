import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import {
  CommandArgumentsRequestSchema,
  CommandCreateSchema,
  CommandOrderRequestSchema,
  CommandRunRequestSchema,
  CommandUpdateRequestSchema,
  errorMessage,
  Identifier,
  parse,
  type CommandArgumentValues,
  type ServiceCommandFull,
  type SubmitTaskResponse,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { findPluginCommand, listPluginCommands, updatePluginCommand } from '../plugins/commands.js';
import {
  forgetLastArguments,
  recordLastArguments,
  withLastArguments,
  withLastArgumentsOf,
} from './last-arguments.js';
import { CommandLaunchError, launchCommand, type LaunchCommandDeps } from './launch.js';
import { CommandStore } from './store.js';
import type { Logger } from '../logging.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface CommandRouteContext {
  dataDir: string;
  /** What `POST /v1/commands/:id/run` launches a command with (launch.ts). */
  launch: LaunchCommandDeps;
  /** Reports remembered-argument writes that fail after the response was sent. */
  log: Logger;
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
 * The user's commands are listed in their saved order, which `PUT /v1/commands/order` sets.
 * Installed plugins' commands (plugins/commands.ts) are listed after the user's, carry their
 * `pluginId`, accept only an `enabled` change and cannot be deleted. `POST /v1/commands/:id/run`
 * launches one (launch.ts), answering like a task submit, and remembers its argument values for
 * the command's next run; `PUT /v1/commands/:id/arguments` remembers values without a run (an
 * options card or menu changed one). Every command these routes answer carries those values as
 * `lastArguments` (last-arguments.ts).
 */
export function registerCommandRoutes(app: FastifyInstance, ctx: CommandRouteContext): void {
  const store = () => CommandStore.load(ctx.dataDir);
  const withLast = (command: ServiceCommandFull) => withLastArgumentsOf(ctx.dataDir, command);

  app.get('/v1/commands', RENDERER_ROUTE, async () => ({
    commands: await withLastArguments(ctx.dataDir, [
      ...(await store()).list(),
      ...(await listPluginCommands(ctx.dataDir)),
    ]),
  }));

  app.get<{ Params: { id: string } }>('/v1/commands/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(Identifier, request.params.id);
    const command = (await pluginCommand(ctx.dataDir, id))?.value ?? (await store()).get(id);
    return { command: await withLast(command) };
  });

  app.post('/v1/commands', RENDERER_ROUTE, async (request) => ({
    command: await withLast(await (await store()).create(parse(CommandCreateSchema, request.body))),
  }));

  // Declared beside `/v1/commands/:id`; Fastify matches the static segment first.
  app.put('/v1/commands/order', RENDERER_ROUTE, async (request) => {
    const { ids } = parse(CommandOrderRequestSchema, request.body);
    return {
      commands: await withLastArguments(ctx.dataDir, [
        ...(await (await store()).reorder(ids)),
        ...(await listPluginCommands(ctx.dataDir)),
      ]),
    };
  });

  app.put<{ Params: { id: string } }>('/v1/commands/:id', RENDERER_ROUTE, async (request) => {
    const id = parse(Identifier, request.params.id);
    const body = parse(CommandUpdateRequestSchema, request.body);
    const plugin = await pluginCommand(ctx.dataDir, id);
    if (!plugin)
      return {
        command: await withLast(
          await (await store()).update(id, body.command, body.expectedRevision),
        ),
      };
    const command = await updatePluginCommand(
      ctx.dataDir,
      plugin,
      body.command,
      body.expectedRevision,
    );
    // The store announces its own writes; a plugin item switch is announced here.
    CommandStore.announce(ctx.dataDir);
    return { command: await withLast(command) };
  });

  app.post<{ Params: { id: string } }>('/v1/commands/:id/run', RENDERER_ROUTE, async (request) => {
    const commandId = parse(Identifier, request.params.id);
    const body = parse(CommandRunRequestSchema, request.body);
    let response: SubmitTaskResponse;
    try {
      response = await launchCommand(ctx.launch, { ...body, commandId });
    } catch (error) {
      throw error instanceof CommandLaunchError ? launchFailure(error, commandId) : error;
    }
    // Recorded here rather than in launchCommand, which automations share: only a run from the
    // app sets what the next one starts from. It runs after the answer is on its way, so it never
    // delays a run; it is a convenience, so a failed write keeps the earlier values and never
    // turns an accepted run into an error.
    if (!response.duplicate)
      void rememberArguments(ctx.dataDir, commandId, body.input.arguments).catch(
        (error: unknown) => {
          ctx.log.warn('Remembering command arguments failed.', {
            commandId,
            error: errorMessage(error),
          });
        },
      );
    return response;
  });

  app.put<{ Params: { id: string } }>(
    '/v1/commands/:id/arguments',
    RENDERER_ROUTE,
    async (request) => {
      const id = parse(Identifier, request.params.id);
      const body = parse(CommandArgumentsRequestSchema, request.body);
      const command = (await pluginCommand(ctx.dataDir, id))?.value ?? (await store()).get(id);
      await recordLastArguments(ctx.dataDir, command, body.arguments);
      return { command: await withLast(command) };
    },
  );

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
    // Reads skip ids no command has, so a record left by a failed drop is only dead weight.
    void forgetLastArguments(ctx.dataDir, id).catch((error: unknown) => {
      ctx.log.warn('Dropping remembered command arguments failed.', {
        commandId: id,
        error: errorMessage(error),
      });
    });
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

/** Remembers a run's argument values for the next run of command `id`, the user's or a plugin's. */
async function rememberArguments(
  dataDir: string,
  id: string,
  values: CommandArgumentValues,
): Promise<void> {
  const own = (await CommandStore.load(dataDir)).list().find((command) => command.id === id);
  const command = own ?? (await findPluginCommand(dataDir, id))?.value;
  if (command) await recordLastArguments(dataDir, command, values);
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
