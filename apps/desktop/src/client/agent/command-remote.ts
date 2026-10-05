import {
  createCommand,
  deleteCommand,
  listCommands,
  updateCommand,
  type AgentClientOptions,
} from '@atd/agent-client';
import type { CommandCreate, ServiceCommandFull } from '@atd/agent-contracts';
import type { CommandDefinition } from './command-schema';

/** Maps a service command to the desktop editor shape (drops migratedAt, keeps pluginId). */
export function toDesktopCommand(command: ServiceCommandFull): CommandDefinition {
  return {
    id: command.id,
    revision: command.revision,
    name: command.name,
    description: command.description,
    instructions: command.instructions,
    enabled: command.enabled,
    shortcut: command.shortcut,
    templateId: command.templateId,
    input: { ...command.input },
    placement: { ...command.placement },
    parameters: command.parameters.map((parameter) => ({ ...parameter })),
    model: { ...command.model },
    tools: [...command.tools],
    memory: command.memory,
    ...(command.pluginId === undefined ? {} : { pluginId: command.pluginId }),
  };
}

export function toServiceCommand(command: CommandDefinition): ServiceCommandFull {
  return {
    ...command,
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
    shortcut: command.shortcut,
    templateId: command.templateId,
    input: { ...command.input },
    placement: { ...command.placement },
    parameters: command.parameters.map((parameter) => ({ ...parameter })),
    model: { ...command.model },
    tools: [...command.tools],
    memory: command.memory,
  };
}

export async function fetchCommands(options: AgentClientOptions): Promise<CommandDefinition[]> {
  const listed = await listCommands(options);
  return listed.commands.map(toDesktopCommand);
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
