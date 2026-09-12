import type { CommandDefinition } from '../../../electron/agent/command-schema';

export type ContextVariable = 'input' | 'files' | 'selection' | 'clipboard';

export const contextVariables: { name: ContextVariable; detail: string }[] = [
  { name: 'input', detail: 'Main text · chosen when the command runs' },
  { name: 'files', detail: 'File attachments' },
  { name: 'selection', detail: 'Selected text · captured before the panel opens' },
  { name: 'clipboard', detail: 'Clipboard text · only captured when requested' },
];

export function parameterVariables(command: CommandDefinition) {
  return command.parameters.map((parameter) => ({
    name: `argument.${parameter.key}`,
    detail: `${parameter.label} · ${parameter.type}${parameter.default !== undefined ? ` · Default: ${String(parameter.default)}` : ''}`,
  }));
}
