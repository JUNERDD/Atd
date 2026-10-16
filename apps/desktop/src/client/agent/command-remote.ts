import {
  createCommand,
  deleteCommand,
  listCommands,
  rememberCommandArguments,
  reorderCommands,
  updateCommand,
  type AgentClientOptions,
} from '@atd/agent-client';
import type { CommandCreate, ServiceCommandFull } from '@atd/agent-contracts';
import type { ArgumentValues, CommandDefinition } from './command-schema';

/**
 * Maps a service command to the desktop editor shape (drops migratedAt, keeps pluginId and the
 * computed lastArguments).
 */
export function toDesktopCommand(command: ServiceCommandFull): CommandDefinition {
  return {
    id: command.id,
    revision: command.revision,
    name: command.name,
    description: command.description,
    instructions: command.instructions,
    enabled: command.enabled,
    shortcuts: structuredClone(command.shortcuts),
    templateId: command.templateId,
    input: { ...command.input },
    placement: { ...command.placement },
    output: { ...command.output },
    parameters: command.parameters.map((parameter) => ({ ...parameter })),
    model: { ...command.model },
    thinkingLevel: command.thinkingLevel,
    tools: [...command.tools],
    memory: command.memory,
    ...(command.pluginId === undefined ? {} : { pluginId: command.pluginId }),
    ...(command.lastArguments === undefined ? {} : { lastArguments: { ...command.lastArguments } }),
  };
}

/** The command as a write sends it: the service computes `lastArguments`, so it never goes back. */
export function toServiceCommand({
  lastArguments: _computed,
  ...command
}: CommandDefinition): ServiceCommandFull {
  return {
    ...command,
    shortcuts: structuredClone(command.shortcuts),
    parameters: command.parameters.map((parameter) => ({ ...parameter })),
    tools: [...command.tools],
  };
}

export function toCommandCreate(command: CommandDefinition): CommandCreate {
  return {
    id: command.id,
    name: command.name,
    description: command.description,
    instructions: command.instructions,
    enabled: command.enabled,
    shortcuts: structuredClone(command.shortcuts),
    templateId: command.templateId,
    input: { ...command.input },
    placement: { ...command.placement },
    output: { ...command.output },
    parameters: command.parameters.map((parameter) => ({ ...parameter })),
    model: { ...command.model },
    thinkingLevel: command.thinkingLevel,
    tools: [...command.tools],
    memory: command.memory,
  };
}

export async function fetchCommands(options: AgentClientOptions): Promise<CommandDefinition[]> {
  const listed = await listCommands(options);
  return listed.commands.map(toDesktopCommand);
}

/** Saves the order of the user's commands; answers the whole list in its new order. */
export async function reorderRemote(
  options: AgentClientOptions,
  ids: string[],
): Promise<CommandDefinition[]> {
  const listed = await reorderCommands(options, { ids });
  return listed.commands.map(toDesktopCommand);
}

/**
 * Remembers `values` as where command `id`'s next run starts, without running it. With
 * `shortcutId`, the keys that shortcut pins keep what was remembered for them.
 */
export async function rememberRemote(
  options: AgentClientOptions,
  id: string,
  values: ArgumentValues,
  shortcutId?: string,
): Promise<CommandDefinition> {
  const remembered = await rememberCommandArguments(options, id, {
    arguments: values,
    ...(shortcutId === undefined ? {} : { shortcutId }),
  });
  return toDesktopCommand(remembered.command);
}

/** revision 0 → POST; otherwise PUT with the expected live revision. */
export async function saveRemote(
  options: AgentClientOptions,
  command: CommandDefinition,
  expectedRevision: number,
): Promise<CommandDefinition> {
  if (expectedRevision === 0) {
    const created = await createCommand(options, toCommandCreate(command));
    return toDesktopCommand(created.command);
  }
  const updated = await updateCommand(options, command.id, {
    command: toServiceCommand({ ...command, revision: Math.max(command.revision, 1) }),
    expectedRevision,
  });
  return toDesktopCommand(updated.command);
}

export function deleteRemote(
  options: AgentClientOptions,
  id: string,
  revision: number,
): Promise<{ deleted: true; id: string }> {
  return deleteCommand(options, id, revision);
}
