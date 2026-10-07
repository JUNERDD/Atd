import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_RUN_TOOLS,
  parse,
  PreviewTaskRequestSchema,
  RunSnapshotSchema,
  type PreviewTaskRequest,
  type PreviewTaskResponse,
  type ServiceCommandFull,
  snapshotToolsFor,
} from '@atd/agent-contracts';
import { CommandStore } from '../commands/store.js';
import { findPluginCommand } from '../plugins/commands.js';
import { defaultArguments, resolveCommandInstructions } from '../commands/templates.js';
import { ConnectionStore } from '../credentials/connections.js';
import type { Ledger } from '../ledger.js';
import {
  loadRunContextWindow,
  resolveRunModel,
  resolveRunThinkingLevel,
  selectRunModel,
} from './run-selection.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface PreviewContext {
  dataDir: string;
  ledger: Ledger;
}

/**
 * Read-only run preview (T6b). Shows the exact snapshot a submit with the
 * same inputs would freeze: resolved instructions, pinned model ref,
 * tools, memory flag, thinking level, context window and, for a command,
 * `fromCommand`. No ledger write, no run, no network. Input problems
 * answer 400 (TypeError); unknown command or connection answers 404.
 */
export function registerPreviewRoute(app: FastifyInstance, ctx: PreviewContext): void {
  app.post('/v1/tasks/preview', RENDERER_ROUTE, async (request) => {
    const body = parse(PreviewTaskRequestSchema, request.body);
    return resolvePreview(ctx, body);
  });
}

export async function resolvePreview(
  ctx: PreviewContext,
  body: PreviewTaskRequest,
): Promise<PreviewTaskResponse> {
  const commands = await CommandStore.load(ctx.dataDir);
  const connections = await ConnectionStore.load(ctx.dataDir);
  const command = await resolveCommand(ctx.dataDir, commands, body);
  const args = command
    ? { ...defaultArguments(command), ...body.input.arguments }
    : body.input.arguments;
  const input = { ...body.input, arguments: args };
  const instructions = command ? resolveInstructions(command, input) : '';
  const warnings: string[] = [];
  for (const file of input.files) {
    if (!ctx.ledger.data.resources.some((resource) => resource.id === file.id))
      warnings.push(`Attachment ${file.name} was not uploaded.`);
  }
  const policy = body.policy;
  // A preview has no task, so only the policy's pick and the command's fixed model can select.
  const selection = selectRunModel(connections, {
    requested: policy?.model ?? null,
    command: command?.model ?? null,
  });
  const model = resolveRunModel(connections, selection, warnings);
  // Without a command, mirror what RunnerManager.freezeSnapshot freezes for a new task.
  const tools =
    body.policy?.tools ?? (command ? snapshotToolsFor(command.tools) : [...DEFAULT_RUN_TOOLS]);
  const memory = body.policy?.memory ?? (command ? command.memory !== 'off' : true);
  const thinkingLevel = resolveRunThinkingLevel(
    connections,
    model,
    body.policy?.thinkingLevel ??
      (command?.model.mode === 'fixed' ? command.model.thinkingLevel : undefined),
  );
  const contextWindow = (await loadRunContextWindow(connections, selection))(model);
  const snapshot = parse(RunSnapshotSchema, {
    input,
    instructions,
    model,
    tools,
    memory,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(command ? { fromCommand: true } : {}),
  });
  return { snapshot, commandId: command?.id ?? null, warnings };
}

/** The command to preview: the one sent, or a saved one by id, a user's first, then a plugin's. */
async function resolveCommand(
  dataDir: string,
  commands: CommandStore,
  body: PreviewTaskRequest,
): Promise<ServiceCommandFull | null> {
  const id = body.commandId;
  const saved = id
    ? (commands.list().find((item) => item.id === id) ??
      (await findPluginCommand(dataDir, id))?.value ??
      commands.get(id))
    : null;
  const command = body.command ?? saved;
  if (command && !command.enabled)
    throw new TypeError('Invalid preview: this command is disabled. Enable it first.');
  return command;
}

function resolveInstructions(
  command: ServiceCommandFull,
  input: PreviewTaskRequest['input'],
): string {
  try {
    return resolveCommandInstructions(command, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The input is invalid.';
    throw new TypeError(`Invalid preview: ${message}`);
  }
}
