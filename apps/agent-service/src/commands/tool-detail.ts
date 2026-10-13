import {
  writesBack,
  type CommandInput,
  type CommandOutput,
  type CommandOutputAction,
  type CommandParameter,
  type CommandThinkingLevel,
  type ServiceCommandFull,
} from '@atd/agent-contracts';

/**
 * What the user approves when the Agent saves a command: every authored field for a create, a
 * change summary for an update. Both say where the answer goes, so a write-back is approved
 * knowingly.
 */

const DETAIL_LIMIT = 2000;
const PREVIEW_LIMIT = 160;

const INPUT_SOURCES = {
  manual: 'typed text',
  selection: 'selected text',
  clipboard: 'clipboard',
  screenshot: 'screenshot',
  none: 'no text',
} as const;

const OUTPUT_ACTIONS = {
  panel: 'kept in the conversation',
  replaceSelection: 'written over the selected text',
  insertAfterSelection: 'inserted after the selected text',
  insertAtCursor: 'inserted at the cursor',
  copy: 'copied to the clipboard',
} as const satisfies Record<CommandOutputAction, string>;

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

function outputSummary(output: CommandOutput): string {
  const where = OUTPUT_ACTIONS[output.action];
  return writesBack(output.action) && output.review ? `${where} · after you review it` : where;
}

function parameterLine(parameter: CommandParameter): string {
  return `${parameter.label} · {{argument.${parameter.key}}} · ${parameter.type}`;
}

function toolList(tools: readonly string[]): string {
  return tools.length ? tools.join(', ') : 'none';
}

function levelText(level: CommandThinkingLevel): string {
  return level === 'inherit' ? 'connection default' : level;
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
      `Answer: ${outputSummary(command.output)}`,
      `Shortcut: ${command.shortcut || 'none'}`,
      'Parameters:',
      ...(command.parameters.length
        ? command.parameters.map((parameter) => `- ${parameterLine(parameter)}`)
        : ['- none']),
      `Tools: ${toolList(command.tools)}`,
      `Memory: ${command.memory}`,
      `Reasoning: ${levelText(command.thinkingLevel)}`,
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
  if (outputSummary(previous.output) !== outputSummary(next.output))
    lines.push(`Answer: ${outputSummary(previous.output)} → ${outputSummary(next.output)}`);
  if (previous.shortcut !== next.shortcut)
    lines.push(`Shortcut: ${previous.shortcut || 'none'} → ${next.shortcut || 'none'}`);
  if (JSON.stringify(previous.parameters) !== JSON.stringify(next.parameters))
    lines.push('Parameters:', ...parameterChanges(previous.parameters, next.parameters));
  if (JSON.stringify(previous.tools) !== JSON.stringify(next.tools))
    lines.push(`Tools: ${toolList(previous.tools)} → ${toolList(next.tools)}`);
  if (previous.memory !== next.memory) lines.push(`Memory: ${previous.memory} → ${next.memory}`);
  if (previous.thinkingLevel !== next.thinkingLevel)
    lines.push(
      `Reasoning: ${levelText(previous.thinkingLevel)} → ${levelText(next.thinkingLevel)}`,
    );
  if (previous.instructions !== next.instructions)
    lines.push(`Instructions: ${preview(previous.instructions)} → ${preview(next.instructions)}`);
  return clip(lines.join('\n') || 'No changes to the command definition.', DETAIL_LIMIT);
}
