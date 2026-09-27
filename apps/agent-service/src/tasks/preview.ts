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
} from '@ai/agent-contracts';
import { CommandStore } from '../commands/store.js';
import { defaultArguments, resolveCommandInstructions } from '../commands/templates.js';
import { ConnectionStore } from '../credentials/connections.js';
import type { Ledger } from '../ledger.js';
import { loadRunContextWindow, resolveRunModel, resolveRunThinkingLevel } from './run-selection.js';

export interface PreviewContext {
  dataDir: string;
  ledger: Ledger;
}

/**
 * Read-only run preview (T6b). Shows the exact snapshot a submit with the
 * same inputs would freeze: resolved instructions, pinned model ref,
 * tools, memory flag, thinking level and context window. No ledger write, no run, no
 * network. Input problems answer 400 (TypeError); unknown command or
 * connection answers 404.
 */
export function registerPreviewRoute(app: FastifyInstance, ctx: PreviewContext): void {
  app.post('/v1/tasks/preview', async (request) => {
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
  const command = resolveCommand(commands, body);
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
  const selection = policy && policy.useDefaultModel !== true ? policy.model : undefined;
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
  });
  return { snapshot, commandId: command?.id ?? null, warnings };
}

function resolveCommand(
  commands: CommandStore,
  body: PreviewTaskRequest,
): ServiceCommandFull | null {
  const command = body.command ?? (body.commandId ? commands.get(body.commandId) : null);
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
