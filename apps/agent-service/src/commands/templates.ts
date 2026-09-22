import type { CommandInput, CommandParameter, ServiceCommandFull } from '@ai/agent-contracts';

/**
 * Command template + validation port (T6b). The desktop resolves command
 * templates with the Mustache library; the service carries no new
 * dependencies, so this module ports the ACCEPTED subset exactly:
 * `{{input|files|selection|clipboard|argument.key}}` with optional inner
 * whitespace. Anything else (sections, comments, triple-stash, unclosed
 * tags) throws like the desktop validator. Rendering substitutes values
 * without escaping, matching the desktop identity-escape render. All
 * validation failures throw TypeError so HTTP answers 400, never 500.
 */

export interface VariableReference {
  name: string;
  from: number;
  to: number;
}

const TAG = /\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g;
const NAME = /^(input|files|selection|clipboard|argument\.[a-zA-Z][a-zA-Z0-9_]*)$/;

export function templateReferences(instructions: string): VariableReference[] {
  const refs: VariableReference[] = [];
  const stripped = instructions.replace(TAG, (tag, offset: number) => {
    const triple = tag.startsWith('{{{');
    const name = (triple ? tag.slice(3, -3) : tag.slice(2, -2)).trim();
    if (triple || !NAME.test(name))
      throw new TypeError(`Unsupported variable or template syntax: ${name || tag}.`);
    refs.push({ name, from: offset, to: offset + tag.length });
    return `\0${refs.length - 1}\0`;
  });
  const dangling = stripped.indexOf('{{');
  if (dangling >= 0)
    throw new TypeError(
      `Unsupported variable or template syntax: ${stripped.slice(dangling + 2, dangling + 22)}.`,
    );
  return refs;
}

export function availableVariables(command: {
  input: CommandInput;
  parameters: CommandParameter[];
}): string[] {
  return [
    ...(command.input.source !== 'none' ? ['input'] : []),
    ...(command.input.files ? ['files'] : []),
    ...(command.input.selection ? ['selection'] : []),
    ...(command.input.clipboard ? ['clipboard'] : []),
    ...command.parameters.map((parameter) => `argument.${parameter.key}`),
  ];
}

export function parameterError(
  parameter: CommandParameter,
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

/** Structural command rules shared by create/update/preview (desktop parity). */
export function validateCommandShape(command: ServiceCommandFull): void {
  if (!command.name.trim()) throw new TypeError('Enter a command name.');
  if (!command.instructions.trim()) throw new TypeError('Enter instructions.');
  const keys = command.parameters.map((parameter) => parameter.key);
  if (new Set(keys).size !== keys.length) throw new TypeError('Each parameter needs a unique key.');
  if (command.input.source === 'selection' && !command.input.selection)
    throw new TypeError('Enable selected text for this input source.');
  if (command.input.source === 'clipboard' && !command.input.clipboard)
    throw new TypeError('Enable clipboard for this input source.');
  if (command.input.source === 'none' && command.input.required)
    throw new TypeError('A command without text input cannot require text.');
  for (const parameter of command.parameters) {
    if (!parameter.label.trim()) throw new TypeError('Enter a parameter label.');
    if (
      parameter.type === 'number' &&
      parameter.min !== undefined &&
      parameter.max !== undefined &&
      parameter.min > parameter.max
    ) {
      throw new TypeError(`${parameter.label}: minimum must not exceed maximum.`);
    }
    if (parameter.type === 'enum') {
      if (parameter.options.some((option) => !option.value.trim() || !option.label.trim()))
        throw new TypeError('Enter a value and label for every option.');
      if (
        new Set(parameter.options.map((option) => option.value)).size !== parameter.options.length
      )
        throw new TypeError('Option values must be unique.');
    }
    if (parameter.default !== undefined) {
      const error = parameterError(parameter, parameter.default);
      if (error) throw new TypeError(`Default value: ${error}`);
    }
  }
  const variables = availableVariables(command);
  for (const reference of templateReferences(command.instructions)) {
    if (!variables.includes(reference.name))
      throw new TypeError(`Enable or define {{${reference.name}}} before saving.`);
  }
}

export function defaultArguments(
  command: ServiceCommandFull,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    command.parameters.flatMap((parameter) =>
      parameter.default === undefined ? [] : [[parameter.key, parameter.default]],
    ),
  );
}

export interface ResolveInput {
  text: string;
  source: string;
  selection: string;
  clipboard: string;
  files: { id: string; name: string; type: string }[];
  arguments: Record<string, string | number | boolean>;
}

/**
 * Resolves instructions against run input (desktop `resolveInstructions`
 * parity). Throws 400-class errors when the input cannot run the command.
 */
export function resolveCommandInstructions(
  command: ServiceCommandFull,
  input: ResolveInput,
): string {
  validateCommandShape(command);
  if (command.input.required && !input.text.trim())
    throw new TypeError('Add the required text before running.');
  if (!command.input.files && input.files.length)
    throw new TypeError('This command does not accept files.');
  if (input.source === 'selection' && !command.input.selection)
    throw new TypeError('Selected text is not enabled.');
  if (input.source === 'clipboard' && !command.input.clipboard)
    throw new TypeError('Clipboard input is not enabled.');
  if (
    Object.keys(input.arguments).some(
      (key) => !command.parameters.some((parameter) => parameter.key === key),
    )
  )
    throw new TypeError('A parameter has changed. Review your input.');
  for (const parameter of command.parameters) {
    const error = parameterError(parameter, input.arguments[parameter.key]);
    if (error) throw new TypeError(error);
  }
  const references = templateReferences(command.instructions);
  if (references.some((reference) => reference.name === 'selection') && !input.selection.trim())
    throw new TypeError('Capture selected text before running.');
  if (references.some((reference) => reference.name === 'clipboard') && !input.clipboard.trim())
    throw new TypeError('Capture clipboard text before running.');
  if (references.some((reference) => reference.name === 'files') && !input.files.length)
    throw new TypeError('Attach a file before running.');
  const values: Record<string, string> = {
    input: input.text,
    selection: input.selection,
    clipboard: input.clipboard,
    files: input.files.map((file) => `${file.name} (${file.type}, resource ${file.id})`).join('\n'),
  };
  for (const [key, value] of Object.entries(input.arguments))
    values[`argument.${key}`] = String(value);
  return command.instructions.replace(TAG, (tag) => {
    const name = (tag.startsWith('{{{') ? tag.slice(3, -3) : tag.slice(2, -2)).trim();
    return values[name] ?? '';
  });
}
