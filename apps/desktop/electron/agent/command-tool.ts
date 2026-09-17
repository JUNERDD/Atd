import { randomUUID } from 'node:crypto';
import {
  CommandSchema,
  type CommandDefinition,
  type CommandFields,
  type Parameter,
} from './command-schema';
import { newCommand } from './command-templates';
import { validateCommand } from './command-validation';
import type { CommandRequest } from './native-schema';
import type { AgentStore } from './store';
import type { CommandService } from './command-service';
import type { PermissionRequest } from './task-schema';
import { parse } from './validation';

const DETAIL_LIMIT = 2000;
const PREVIEW_LIMIT = 160;

function clip(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

const INPUT_SOURCES = {
  manual: 'typed text',
  selection: 'selected text',
  clipboard: 'clipboard',
  none: 'no text',
} as const;

function inputSummary(input: CommandFields['input']) {
  return [
    INPUT_SOURCES[input.source],
    input.required ? 'required' : 'optional',
    ...(input.files ? ['files'] : []),
    ...(input.selection && input.source !== 'selection' ? ['selected text'] : []),
    ...(input.clipboard && input.source !== 'clipboard' ? ['clipboard'] : []),
  ].join(' · ');
}

function parameterLine(parameter: Parameter) {
  return `${parameter.label} · {{argument.${parameter.key}}} · ${parameter.type}`;
}

function toolList(tools: string[]) {
  return tools.length ? tools.join(', ') : 'none';
}

function preview(value: string) {
  return clip(value.replace(/\s+/g, ' ').trim(), PREVIEW_LIMIT);
}

function createDetail(fields: CommandFields) {
  return [
    `Name: ${fields.name}`,
    `Description: ${fields.description || 'none'}`,
    `Input: ${inputSummary(fields.input)}`,
    'Parameters:',
    ...(fields.parameters.length
      ? fields.parameters.map((parameter) => `- ${parameterLine(parameter)}`)
      : ['- none']),
    `Tools: ${toolList(fields.tools)}`,
    `Memory: ${fields.memory}`,
    '',
    'Instructions:',
    fields.instructions,
  ].join('\n');
}

function parameterChanges(previous: Parameter[], next: Parameter[]) {
  const before = new Map(previous.map((parameter) => [parameter.key, parameter]));
  const after = new Map(next.map((parameter) => [parameter.key, parameter]));
  const lines: string[] = [];
  for (const [key, parameter] of before) {
    const updated = after.get(key);
    if (!updated) lines.push(`- removed ${parameterLine(parameter)}`);
    else if (JSON.stringify(updated) !== JSON.stringify(parameter))
      lines.push(`- changed ${parameterLine(updated)}`);
  }
  for (const parameter of next)
    if (!before.has(parameter.key)) lines.push(`- added ${parameterLine(parameter)}`);
  return lines;
}

function updateDetail(previous: CommandDefinition, next: CommandDefinition) {
  const lines: string[] = [];
  if (previous.name !== next.name) lines.push(`Name: ${previous.name} → ${next.name}`);
  if (previous.description !== next.description)
    lines.push(`Description: ${previous.description} → ${next.description}`);
  if (JSON.stringify(previous.input) !== JSON.stringify(next.input))
    lines.push(`Input: ${inputSummary(previous.input)} → ${inputSummary(next.input)}`);
  if (JSON.stringify(previous.parameters) !== JSON.stringify(next.parameters))
    lines.push('Parameters:', ...parameterChanges(previous.parameters, next.parameters));
  if (JSON.stringify(previous.tools) !== JSON.stringify(next.tools))
    lines.push(`Tools: ${toolList(previous.tools)} → ${toolList(next.tools)}`);
  if (previous.memory !== next.memory) lines.push(`Memory: ${previous.memory} → ${next.memory}`);
  if (previous.instructions !== next.instructions)
    lines.push(`Instructions: ${preview(previous.instructions)} → ${preview(next.instructions)}`);
  return clip(lines.join('\n') || 'No changes to the command definition.', DETAIL_LIMIT);
}

/** Applies Agent command edits; every write is confirmed and validated before it reaches the store. */
export class CommandTool {
  constructor(
    private readonly store: AgentStore,
    private readonly commands: CommandService,
    private readonly ask: (request: PermissionRequest) => Promise<string | boolean>,
  ) {}

  async execute(request: CommandRequest): Promise<unknown> {
    if (request.action === 'commandList')
      return this.store.data.commands.map(({ id, revision, name, description }) => ({
        id,
        revision,
        name,
        description,
      }));
    if (request.action === 'commandGet')
      return structuredClone(this.commands.find(request.commandId));
    return this.save(request);
  }

  private async save(request: Extract<CommandRequest, { action: 'commandSave' }>) {
    const previous = request.commandId ? this.commands.find(request.commandId) : null;
    if (!previous && request.expectedRevision !== null)
      throw new Error('A new command has no revision yet. Omit expectedRevision.');
    if (previous && request.expectedRevision !== previous.revision)
      throw new Error(
        'This command changed. Read the latest revision, then apply your change again.',
      );
    const next: CommandDefinition = previous
      ? { ...structuredClone(previous), ...request.fields }
      : { ...newCommand(randomUUID()), ...request.fields };
    validateCommand(next);
    parse(CommandSchema, next);
    const accepted = await this.ask({
      id: randomUUID(),
      taskId: request.taskId,
      runId: request.runId,
      kind: 'confirmation',
      title: previous ? `Update the command "${next.name}"?` : `Create the command "${next.name}"?`,
      detail: previous ? updateDetail(previous, next) : clip(createDetail(next), DETAIL_LIMIT),
      options: [],
    });
    if (accepted !== true) throw new Error('The user declined this action.');
    const saved = await this.commands.save(next, request.expectedRevision ?? 0);
    return { id: saved.id, revision: saved.revision, name: saved.name };
  }
}
