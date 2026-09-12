import Mustache from 'mustache';
import type { ArgumentValues, CommandDefinition, Parameter } from './command-schema';
import type { TaskInput } from './task-schema';

export interface VariableReference {
  name: string;
  from: number;
  to: number;
}

export function templateReferences(instructions: string): VariableReference[] {
  return Mustache.parse(instructions).flatMap((token) => {
    if (token[0] === 'text') return [];
    if (
      token[0] !== 'name' ||
      !/^(input|files|selection|clipboard|argument\.[a-zA-Z][a-zA-Z0-9_]*)$/.test(token[1])
    ) {
      throw new Error(`Unsupported variable or template syntax: ${token[1]}`);
    }
    return [{ name: token[1], from: token[2], to: token[3] }];
  });
}

export function availableVariables(command: CommandDefinition): string[] {
  return [
    ...(command.input.source !== 'none' ? ['input'] : []),
    ...(command.input.files ? ['files'] : []),
    ...(command.input.selection ? ['selection'] : []),
    ...(command.input.clipboard ? ['clipboard'] : []),
    ...command.parameters.map((parameter) => `argument.${parameter.key}`),
  ];
}

export function renameArgument(instructions: string, previous: string, next: string): string {
  // Only replace actual references; invalid syntax remains visible for the author to fix.
  let references: VariableReference[];
  try {
    references = templateReferences(instructions);
  } catch {
    return instructions;
  }
  for (const reference of references.reverse()) {
    if (reference.name === `argument.${previous}`)
      instructions = `${instructions.slice(0, reference.from)}{{argument.${next}}}${instructions.slice(reference.to)}`;
  }
  return instructions;
}

export function parameterError(
  parameter: Parameter,
  value: string | number | boolean | undefined,
): string {
  const missing = value === undefined || (typeof value === 'string' && !value.trim());
  if (missing) return parameter.required ? `${parameter.label} is required.` : '';
  switch (parameter.type) {
    case 'text':
      return typeof value !== 'string' || value.length > parameter.maxLength
        ? `${parameter.label} must be text of at most ${parameter.maxLength} characters.`
        : '';
    case 'number':
      return typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (parameter.min !== undefined && value < parameter.min) ||
        (parameter.max !== undefined && value > parameter.max)
        ? `${parameter.label} must be a number${parameter.min !== undefined ? ` ≥ ${parameter.min}` : ''}${parameter.max !== undefined ? ` ≤ ${parameter.max}` : ''}.`
        : '';
    case 'boolean':
      return typeof value === 'boolean' ? '' : `${parameter.label} must be on or off.`;
    case 'enum':
      return typeof value === 'string' && parameter.options.some((option) => option.value === value)
        ? ''
        : `Choose an available option for ${parameter.label}.`;
  }
}

export function validateCommand(command: CommandDefinition): void {
  if (!command.name.trim()) throw new Error('Enter a command name.');
  if (!command.instructions.trim()) throw new Error('Enter instructions.');
  const keys = command.parameters.map((parameter) => parameter.key);
  if (new Set(keys).size !== keys.length) throw new Error('Each parameter needs a unique key.');
  if (command.input.source === 'selection' && !command.input.selection)
    throw new Error('Enable selected text for this input source.');
  if (command.input.source === 'clipboard' && !command.input.clipboard)
    throw new Error('Enable clipboard for this input source.');
  if (command.input.source === 'none' && command.input.required)
    throw new Error('A command without text input cannot require text.');
  for (const parameter of command.parameters) {
    if (!parameter.label.trim()) throw new Error('Enter a parameter label.');
    if (
      parameter.type === 'number' &&
      parameter.min !== undefined &&
      parameter.max !== undefined &&
      parameter.min > parameter.max
    ) {
      throw new Error(`${parameter.label}: minimum must not exceed maximum.`);
    }
    if (parameter.type === 'enum') {
      if (parameter.options.some((option) => !option.value.trim() || !option.label.trim()))
        throw new Error('Enter a value and label for every option.');
      if (
        new Set(parameter.options.map((option) => option.value)).size !== parameter.options.length
      )
        throw new Error('Option values must be unique.');
    }
    if (parameter.default !== undefined) {
      const error = parameterError(parameter, parameter.default);
      if (error) throw new Error(`Default value: ${error}`);
    }
  }
  const variables = availableVariables(command);
  for (const reference of templateReferences(command.instructions)) {
    if (!variables.includes(reference.name))
      throw new Error(`Enable or define {{${reference.name}}} before saving.`);
  }
}

export function defaultArguments(command: CommandDefinition): ArgumentValues {
  return Object.fromEntries(
    command.parameters.flatMap((parameter) =>
      parameter.default === undefined ? [] : [[parameter.key, parameter.default]],
    ),
  );
}

export function resolveInstructions(command: CommandDefinition, input: TaskInput): string {
  validateCommand(command);
  if (command.input.required && !input.text.trim())
    throw new Error('Add the required text before running.');
  if (!command.input.files && input.files.length)
    throw new Error('This command does not accept files.');
  if (input.source === 'selection' && !command.input.selection)
    throw new Error('Selected text is not enabled.');
  if (input.source === 'clipboard' && !command.input.clipboard)
    throw new Error('Clipboard input is not enabled.');
  if (
    Object.keys(input.arguments).some(
      (key) => !command.parameters.some((parameter) => parameter.key === key),
    )
  )
    throw new Error('A parameter has changed. Review your input.');
  for (const parameter of command.parameters) {
    const error = parameterError(parameter, input.arguments[parameter.key]);
    if (error) throw new Error(error);
  }
  const references = templateReferences(command.instructions);
  if (references.some((reference) => reference.name === 'selection') && !input.selection.trim())
    throw new Error('Capture selected text before running.');
  if (references.some((reference) => reference.name === 'clipboard') && !input.clipboard.trim())
    throw new Error('Capture clipboard text before running.');
  if (references.some((reference) => reference.name === 'files') && !input.files.length)
    throw new Error('Attach a file before running.');
  return Mustache.render(
    command.instructions,
    {
      input: input.text,
      selection: input.selection,
      clipboard: input.clipboard,
      argument: input.arguments,
      files: input.files
        .map((file) => `${file.name} (${file.type}, resource ${file.id})`)
        .join('\n'),
    },
    undefined,
    { escape: (value: string) => value },
  );
}
