import Mustache from 'mustache';
import {
  instructionCapabilities,
  instructionTokenProblem,
  MAX_RUN_REFERENCES,
  MAX_RUN_SKILLS,
  parseInstructionTokens,
} from '@ai/agent-contracts';
import type { ArgumentValues, CommandDefinition, Parameter } from './command-schema';
import type { TaskInput } from './task-schema';

export interface VariableReference {
  name: string;
  from: number;
  to: number;
}

/**
 * Instructions the template parser rejects. The message stays English for main-process errors;
 * the editor shows its own copy, naming `tag` (the offending tag as written) when there is one.
 */
export class TemplateSyntaxError extends Error {
  constructor(
    message: string,
    readonly tag?: string,
  ) {
    super(message);
    this.name = 'TemplateSyntaxError';
  }
}

export function templateReferences(instructions: string): VariableReference[] {
  let tokens: ReturnType<typeof Mustache.parse>;
  try {
    tokens = Mustache.parse(instructions);
  } catch (error) {
    // Unclosed or unbalanced tags; Mustache reports them in English with an offset.
    throw new TemplateSyntaxError(error instanceof Error ? error.message : String(error));
  }
  return tokens.flatMap((token) => {
    if (token[0] === 'text') return [];
    if (
      token[0] !== 'name' ||
      !/^(input|files|selection|clipboard|argument\.[a-zA-Z][a-zA-Z0-9_]*)$/.test(token[1])
    ) {
      throw new TemplateSyntaxError(
        `Unsupported variable or template syntax: ${token[1]}`,
        instructions.slice(token[2], token[3]),
      );
    }
    return [{ name: token[1], from: token[2], to: token[3] }];
  });
}

export function availableVariables(
  command: Pick<CommandDefinition, 'input' | 'parameters'>,
): string[] {
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

/** An editor field a command problem belongs to; the editor shows the problem under it. */
export type CommandField = 'name' | 'instructions' | 'input' | 'parameters';

/**
 * Why a command cannot be saved, as data rather than text: the editor translates `code` (with
 * `params`) and shows it under `field`, while `validateCommand` throws it as English for the
 * native host and the run path.
 */
export type CommandProblem =
  | { field: 'name'; code: 'nameRequired' }
  | { field: 'instructions'; code: 'instructionsRequired' | 'syntax' }
  | { field: 'instructions'; code: 'unsupportedTag'; params: { tag: string } }
  | { field: 'instructions'; code: 'undefinedVariables'; params: { variables: string } }
  | { field: 'instructions'; code: 'tooManySkills' | 'tooManyReferences'; params: { max: number } }
  | { field: 'input'; code: 'selectionDisabled' | 'clipboardDisabled' | 'textNotAccepted' }
  | {
      field: 'parameters';
      code: 'duplicateKey' | 'labelRequired' | 'optionIncomplete' | 'optionDuplicate';
    }
  | { field: 'parameters'; code: 'range' | 'invalidDefault'; params: { label: string } };

/** Each field's first problem; a field without one is absent. */
export type CommandProblems = Partial<Record<CommandField, CommandProblem>>;

/**
 * What stops the instructions' template from being used: too many staged items, syntax the
 * parser rejects, or variables the command does not offer. Empty instructions pass here, so the
 * editor can show this while the user types without flagging a new command at once.
 */
export function templateProblem(
  command: Pick<CommandDefinition, 'instructions' | 'input' | 'parameters'>,
): CommandProblem | null {
  if (instructionTokenProblem(command.instructions)) {
    const { skills } = instructionCapabilities(parseInstructionTokens(command.instructions));
    return skills.length > MAX_RUN_SKILLS
      ? { field: 'instructions', code: 'tooManySkills', params: { max: MAX_RUN_SKILLS } }
      : { field: 'instructions', code: 'tooManyReferences', params: { max: MAX_RUN_REFERENCES } };
  }
  const available = availableVariables(command);
  let references: VariableReference[];
  try {
    references = templateReferences(command.instructions);
  } catch (error) {
    return error instanceof TemplateSyntaxError && error.tag
      ? { field: 'instructions', code: 'unsupportedTag', params: { tag: error.tag } }
      : { field: 'instructions', code: 'syntax' };
  }
  const unknown = references.filter((reference) => !available.includes(reference.name));
  if (!unknown.length) return null;
  const variables = unknown.map((reference) => `{{${reference.name}}}`).join(', ');
  return { field: 'instructions', code: 'undefinedVariables', params: { variables } };
}

function inputProblem({ input }: CommandDefinition): CommandProblem | null {
  if (input.source === 'selection' && !input.selection)
    return { field: 'input', code: 'selectionDisabled' };
  if (input.source === 'clipboard' && !input.clipboard)
    return { field: 'input', code: 'clipboardDisabled' };
  if (input.source === 'none' && input.required) return { field: 'input', code: 'textNotAccepted' };
  return null;
}

function parametersProblem({ parameters }: CommandDefinition): CommandProblem | null {
  const keys = parameters.map((parameter) => parameter.key);
  if (new Set(keys).size !== keys.length) return { field: 'parameters', code: 'duplicateKey' };
  for (const parameter of parameters) {
    const { label } = parameter;
    if (!label.trim()) return { field: 'parameters', code: 'labelRequired' };
    if (
      parameter.type === 'number' &&
      parameter.min !== undefined &&
      parameter.max !== undefined &&
      parameter.min > parameter.max
    )
      return { field: 'parameters', code: 'range', params: { label } };
    if (parameter.type === 'enum') {
      if (parameter.options.some((option) => !option.value.trim() || !option.label.trim()))
        return { field: 'parameters', code: 'optionIncomplete' };
      if (new Set(parameter.options.map(({ value }) => value)).size !== parameter.options.length)
        return { field: 'parameters', code: 'optionDuplicate' };
    }
    if (parameter.default !== undefined && parameterError(parameter, parameter.default))
      return { field: 'parameters', code: 'invalidDefault', params: { label } };
  }
  return null;
}

/** Every problem that stops `command` from being saved, at most one per field. */
export function commandProblems(command: CommandDefinition): CommandProblems {
  const found: (CommandProblem | null)[] = [
    command.name.trim() ? null : { field: 'name', code: 'nameRequired' },
    command.instructions.trim()
      ? templateProblem(command)
      : { field: 'instructions', code: 'instructionsRequired' },
    inputProblem(command),
    parametersProblem(command),
  ];
  const problems: CommandProblems = {};
  for (const problem of found) if (problem) problems[problem.field] = problem;
  return problems;
}

/** English text of a problem, for callers without the renderer's translations. */
function englishProblem(problem: CommandProblem): string {
  switch (problem.code) {
    case 'nameRequired':
      return 'Enter a command name.';
    case 'instructionsRequired':
      return 'Enter instructions.';
    case 'syntax':
      return 'Check the variable syntax.';
    case 'unsupportedTag':
      return `Unsupported variable or template syntax: ${problem.params.tag}`;
    case 'undefinedVariables':
      return `Enable or define ${problem.params.variables} before saving.`;
    case 'tooManySkills':
      return `Instructions can load at most ${problem.params.max} skills.`;
    case 'tooManyReferences':
      return `Instructions can mention at most ${problem.params.max} subagents, MCP servers and conversations.`;
    case 'selectionDisabled':
      return 'Enable selected text for this input source.';
    case 'clipboardDisabled':
      return 'Enable clipboard for this input source.';
    case 'textNotAccepted':
      return 'A command without text input cannot require text.';
    case 'duplicateKey':
      return 'Each parameter needs a unique key.';
    case 'labelRequired':
      return 'Enter a parameter label.';
    case 'range':
      return `${problem.params.label}: minimum must not exceed maximum.`;
    case 'optionIncomplete':
      return 'Enter a value and label for every option.';
    case 'optionDuplicate':
      return 'Option values must be unique.';
    case 'invalidDefault':
      return `${problem.params.label}: the default value is not valid.`;
  }
}

/** Throws the first problem of `command` in English; the editor uses `commandProblems` instead. */
export function validateCommand(command: CommandDefinition): void {
  const problem = Object.values(commandProblems(command))[0];
  if (problem) throw new Error(englishProblem(problem));
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

/**
 * Reports whether a prepared command can start without the user supplying more input. Shortcut
 * launches use this to run immediately (Raycast-style) or to open the command input instead.
 */
export function readyToRun(command: CommandDefinition, input: TaskInput): boolean {
  try {
    resolveInstructions(command, input);
    return true;
  } catch {
    return false;
  }
}
