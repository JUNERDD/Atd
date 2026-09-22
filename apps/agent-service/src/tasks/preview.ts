import type { FastifyInstance } from 'fastify';
import {
  parse,
  PreviewTaskRequestSchema,
  RunSnapshotSchema,
  type PreviewTaskRequest,
  type PreviewTaskResponse,
  type ServiceCommandFull,
  type ServiceModel,
} from '@ai/agent-contracts';
import { CommandStore } from '../commands/store.js';
import { defaultArguments, resolveCommandInstructions } from '../commands/templates.js';
import { ConnectionStore } from '../credentials/connections.js';
import { LedgerNotFound, type Ledger } from '../ledger.js';

export interface PreviewContext {
  dataDir: string;
  ledger: Ledger;
}

/**
 * Read-only run preview (T6b). Shows the exact snapshot a submit with the
 * same inputs would freeze: resolved instructions, pinned model ref,
 * tools, memory flag and thinking level. No ledger write, no run, no
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
  const model = resolveModel(connections, body, warnings);
  const tools = body.policy?.tools ??
    command?.tools ?? ['read', 'write', 'edit', 'bash', 'command'];
  const memory = body.policy?.memory ?? (command ? command.memory !== 'off' : false);
  const thinkingLevel =
    body.policy?.thinkingLevel ??
    (command?.model.mode === 'fixed' ? command.model.thinkingLevel : undefined);
  const snapshot = parse(RunSnapshotSchema, {
    input,
    instructions,
    model,
    tools,
    memory,
    ...(thinkingLevel ? { thinkingLevel } : {}),
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

function resolveModel(
  connections: ConnectionStore,
  body: PreviewTaskRequest,
  warnings: string[],
): ServiceModel {
  const policy = body.policy;
  const selection = policy && policy.useDefaultModel !== true ? policy.model : undefined;
  if (selection) {
    const connection = connections.data.connections.find(
      (item) => item.connectionId === selection.connectionId,
    );
    if (!connection) throw new LedgerNotFound('Connection', selection.connectionId);
    return {
      connectionId: connection.connectionId,
      modelId: selection.modelId,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      configurationId: connection.configurationId,
    };
  }
  const defaultId = connections.data.defaultConnectionId;
  const connection = connections.data.connections.find((item) => item.connectionId === defaultId);
  if (!connection) {
    warnings.push('No default connection; the run would use temporary credentials.');
    return tempModel();
  }
  const modelId = connection.defaultModel || 'default-model';
  if (!connection.defaultModel)
    warnings.push(`Connection ${connection.connectionId} has no default model.`);
  return {
    connectionId: connection.connectionId,
    modelId,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    configurationId: connection.configurationId,
  };
}

/** Temp-credential fallback mirroring the runner acceptance default. */
function tempModel(): ServiceModel {
  const provider = process.env.AI_AGENT_TEMP_PROVIDER?.trim() || 'openai-compatible';
  return {
    connectionId: 'temp',
    modelId: process.env.AI_AGENT_TEMP_MODEL?.trim() || 'default-model',
    provider,
    baseUrl: process.env.AI_AGENT_TEMP_BASE_URL?.trim() ?? '',
  };
}
