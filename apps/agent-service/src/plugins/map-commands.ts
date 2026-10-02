import { createHash } from 'node:crypto';
import {
  parse,
  ServiceCommandFullSchema,
  type CommandParameter,
  type CommandTool,
  type ServiceCommandFull,
} from '@atd/agent-contracts';
import {
  installedItemName,
  substituteBody,
  type CommandComponent,
  type InstalledPlugin,
  type PluginDiagnostic,
  type SubstitutionContext,
} from '@atd/plugin-kit';
import { validateCommandShape } from '../commands/templates.js';
import { mapToolNames } from './map.js';

/** The command tools a run gets when the source names none: what a Claude command inherits. */
const INHERITED_TOOLS: CommandTool[] = ['read', 'write', 'edit', 'bash'];
/** The service command limits (commands.ts): name, parameters, instructions. */
const MAX_NAME = 120;
const MAX_PARAMETERS = 20;
const MAX_INSTRUCTIONS = 20000;
const PARAMETER_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/** The deterministic id of a plugin command: `plg_` + a hash of its qualified name. */
export function pluginCommandId(qualifiedName: string): string {
  return `plg_${createHash('sha256').update(qualifiedName).digest('hex').slice(0, 32)}`;
}

/**
 * Source `allowed-tools` as service command tools. `grep`/`find`/`ls` come with `read`
 * (contracts `snapshotToolsFor`), and the web tools every run keeps need no entry. An empty
 * source list inherits the usual file and shell tools, as a Claude command does.
 */
export function mapCommandTools(allowedTools: readonly string[]): CommandTool[] {
  if (!allowedTools.length) return [...INHERITED_TOOLS];
  const mapped = mapToolNames(allowedTools).flatMap((tool): CommandTool[] => {
    if (tool === 'grep' || tool === 'find' || tool === 'ls') return ['read'];
    if (tool === 'read' || tool === 'write' || tool === 'edit' || tool === 'bash') return [tool];
    return tool === 'command' ? ['command'] : [];
  });
  return [...new Set(mapped)];
}

function problem(component: CommandComponent, message: string): PluginDiagnostic {
  return {
    level: 'warning',
    code: 'invalid-component',
    message: `Command "${component.name}" is skipped: ${message}.`,
    component: { kind: 'command', name: component.name },
  };
}

/** A text parameter for one argument reference; its key is what the template names. */
function textParameter(
  key: string,
  label: string,
  description: string,
  fallback?: string,
): CommandParameter {
  return {
    type: 'text',
    key,
    label: label.slice(0, 120) || key,
    description: description.slice(0, 500),
    required: false,
    multiline: false,
    maxLength: 10000,
    ...(fallback === undefined ? {} : { default: fallback.slice(0, 10000) }),
  };
}

/**
 * Renders a command body into the service template syntax (commands/templates.ts): all arguments
 * become `{{input}}`, the Nth positional argument `{{argument.argN}}` and a declared argument
 * `{{argument.<name>}}`, each backed by a declared text parameter. Literal text is substituted
 * like any model-visible body. The template language has no escape, so literal `{{` cannot be
 * kept and makes the command unusable. Answers the fields, or why the command is skipped.
 */
function renderSegments(
  plugin: InstalledPlugin,
  component: CommandComponent,
  context: SubstitutionContext,
): Pick<ServiceCommandFull, 'instructions' | 'parameters' | 'input'> | string {
  const parameters = new Map<string, CommandParameter>();
  const declared = new Map(component.arguments.map((argument) => [argument.name, argument]));
  let usesInput = false;
  let instructions = '';
  for (const segment of component.segments) {
    if (segment.type === 'text') {
      const text = substituteBody(plugin.plugin.format, segment.text, context);
      if (text.includes('{{')) return 'its text contains "{{", which command templates cannot keep';
      instructions += text;
    } else if (segment.type === 'arguments') {
      usesInput = true;
      instructions += '{{input}}';
    } else if (segment.type === 'argument') {
      const key = `arg${segment.index}`;
      const source = component.arguments[segment.index - 1];
      if (!parameters.has(key))
        parameters.set(
          key,
          textParameter(
            key,
            source?.name ?? `Argument ${segment.index}`,
            source?.description ?? '',
            segment.fallback,
          ),
        );
      instructions += `{{argument.${key}}}`;
    } else {
      const key =
        PARAMETER_KEY.test(segment.name) && segment.name.length <= 64 ? segment.name : null;
      if (!key) return `its argument "${segment.name}" is not a valid parameter name`;
      if (!parameters.has(key))
        parameters.set(
          key,
          textParameter(key, segment.name, declared.get(segment.name)?.description ?? ''),
        );
      instructions += `{{argument.${key}}}`;
    }
  }
  instructions = instructions.trim();
  if (!instructions) return 'its body is empty';
  if (instructions.length > MAX_INSTRUCTIONS) return 'its body is too long';
  if (parameters.size > MAX_PARAMETERS) return 'it declares too many arguments';
  return {
    instructions,
    parameters: [...parameters.values()],
    input: {
      source: usesInput ? 'manual' : 'none',
      required: false,
      files: false,
      selection: false,
      clipboard: false,
    },
  };
}

/**
 * A plugin command as a read-only service command (B2): deterministic id, qualified name,
 * inherited model and memory, and `enabled` as resolved. The source `model` hint is not carried:
 * a fixed command model names a saved connection, which a plugin cannot know.
 */
export function mapCommand(
  plugin: InstalledPlugin,
  component: CommandComponent,
  context: SubstitutionContext,
  enabled: boolean,
): { command: ServiceCommandFull | null; diagnostics: PluginDiagnostic[] } {
  const name = installedItemName(plugin, component.name);
  if (name.length > MAX_NAME)
    return {
      command: null,
      diagnostics: [problem(component, `its name is longer than ${MAX_NAME} characters`)],
    };
  const rendered = renderSegments(plugin, component, context);
  if (typeof rendered === 'string')
    return { command: null, diagnostics: [problem(component, rendered)] };
  try {
    const command = parse(ServiceCommandFullSchema, {
      id: pluginCommandId(name),
      revision: 1,
      name,
      description: (component.description || component.argumentHint || '').slice(0, 500),
      ...rendered,
      enabled,
      shortcut: '',
      templateId: null,
      model: { mode: 'inherit' },
      tools: mapCommandTools(component.allowedTools),
      memory: 'inherit',
      migratedAt: null,
      pluginId: plugin.id,
    });
    validateCommandShape(command);
    return { command, diagnostics: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'it is not a valid command';
    return { command: null, diagnostics: [problem(component, message)] };
  }
}
