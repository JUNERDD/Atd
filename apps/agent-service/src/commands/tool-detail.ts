import type { CommandInput, CommandParameter, ServiceCommandFull } from '@ai/agent-contracts';

/**
 * What the user approves when the Agent saves a command: every authored field for a create, a
 * change summary for an update. Ported from the desktop command tool the service replaced
 * (`electron/agent/command-tool.ts` before the local service), so confirms read the same.
 */

const DETAIL_LIMIT = 2000;
const PREVIEW_LIMIT = 160;

const INPUT_SOURCES = {
  manual: 'typed text',
  selection: 'selected text',
  clipboard: 'clipboard',
  none: 'no text',
} as const;

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function inputSummary(input: CommandInput): string {
  return [
    INPUT_SOURCES[input.source],
    input.required ? 'required' : 'optional',
    ...(input.files ? ['files'] : []),
    ...(input.selection && input.source !== 'selection' ? ['selected text'] : []),
    ...(input.clipboard && input.source !== 'clipboard' ? ['clipboard'] : []),
  ].join(' · ');
}

function parameterLine(parameter: CommandParameter): string {
  return `${parameter.label} · {{argument.${parameter.key}}} · ${parameter.type}`;
}

function toolList(tools: readonly string[]): string {
  return tools.length ? tools.join(', ') : 'none';
}

function preview(value: string): string {
  return clip(value.replace(/\s+/g, ' ').trim(), PREVIEW_LIMIT);
}

export function createDetail(command: ServiceCommandFull): string {
  return clip(
    [
      `Name: ${command.name}`,
      `Description: ${command.description || 'none'}`,
      `Input: ${inputSummary(command.input)}`,
      `Shortcut: ${command.shortcut || 'none'}`,
      'Parameters:',
      ...(command.parameters.length
        ? command.parameters.map((parameter) => `- ${parameterLine(parameter)}`)
        : ['- none']),
      `Tools: ${toolList(command.tools)}`,
      `Memory: ${command.memory}`,
      '',
      'Instructions:',
      command.instructions,
    ].join('\n'),
    DETAIL_LIMIT,
  );
}

function parameterChanges(previous: CommandParameter[], next: CommandParameter[]): string[] {
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

export function updateDetail(previous: ServiceCommandFull, next: ServiceCommandFull): string {
  const lines: string[] = [];
  if (previous.name !== next.name) lines.push(`Name: ${previous.name} → ${next.name}`);
  if (previous.description !== next.description)
    lines.push(`Description: ${previous.description} → ${next.description}`);
  if (JSON.stringify(previous.input) !== JSON.stringify(next.input))
    lines.push(`Input: ${inputSummary(previous.input)} → ${inputSummary(next.input)}`);
  if (previous.shortcut !== next.shortcut)
    lines.push(`Shortcut: ${previous.shortcut || 'none'} → ${next.shortcut || 'none'}`);
  if (JSON.stringify(previous.parameters) !== JSON.stringify(next.parameters))
    lines.push('Parameters:', ...parameterChanges(previous.parameters, next.parameters));
  if (JSON.stringify(previous.tools) !== JSON.stringify(next.tools))
    lines.push(`Tools: ${toolList(previous.tools)} → ${toolList(next.tools)}`);
  if (previous.memory !== next.memory) lines.push(`Memory: ${previous.memory} → ${next.memory}`);
  if (previous.instructions !== next.instructions)
    lines.push(`Instructions: ${preview(previous.instructions)} → ${preview(next.instructions)}`);
  return clip(lines.join('\n') || 'No changes to the command definition.', DETAIL_LIMIT);
}
