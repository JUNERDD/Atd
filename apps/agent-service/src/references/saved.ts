import {
  errorMessage,
  type CommandParameter,
  type MemoryTarget,
  type MemoryUnit,
  type ServiceCommandFull,
} from '@atd/agent-contracts';
import { CommandStore } from '../commands/store.js';
import { LedgerNotFound } from '../ledger.js';
import { framed } from '../memory/framing.js';
import { logMemoryEvents, MemoryAuthority } from '../memory/index.js';
import { findPluginCommand } from '../plugins/commands.js';
import { oneLine } from './conversation.js';
import type { ReferenceContext } from './material.js';

/** What a resolved command or memory reference adds to the run material, with its audit record. */
export interface SavedHint {
  text: string;
  audit: Record<string, unknown>;
}

/** Why a reference did not resolve, and how the unavailable list names it. */
export interface SavedNote {
  label: string;
  reason: string;
}

/** How the material names each memory target; the Memory settings group entries the same way. */
const TARGET_LABELS = {
  memory: 'a saved preference',
  user: 'the user profile',
  failure: 'a correction or learning',
} as const satisfies Record<MemoryTarget, string>;

/** Resolves the run's saved-item references, reading the memory store at most once. */
export interface SavedItems {
  command(commandId: string): Promise<SavedHint | SavedNote>;
  memory(target: MemoryTarget, entryId: string): Promise<SavedHint | SavedNote>;
}

export function savedItems(
  context: Pick<ReferenceContext, 'dataDir' | 'agentDir' | 'log' | 'run' | 'toolCeiling'>,
): SavedItems {
  let units: Promise<MemoryUnit[] | string> | null = null;
  return {
    command: (commandId) => resolveCommand(context, commandId),
    memory(target, entryId) {
      units ??= MemoryAuthority.authorityFor(context.agentDir, logMemoryEvents(context.log))
        .then((authority) => authority.units())
        .catch((error: unknown) => `the memory store could not be read (${errorMessage(error)})`);
      return resolveMemory(context, units, target, entryId);
    },
  };
}

/** The command `id` as the command routes answer it: the user's own wins over a plugin's. */
async function readCommand(dataDir: string, id: string): Promise<ServiceCommandFull | null> {
  const store = await CommandStore.load(dataDir);
  try {
    return store.get(id);
  } catch (error) {
    if (!(error instanceof LedgerNotFound)) throw error;
  }
  return (await findPluginCommand(dataDir, id))?.value ?? null;
}

function parameterLine(parameter: CommandParameter): string {
  const required = parameter.required ? ', required' : '';
  const description = parameter.description ? ` - ${oneLine(parameter.description)}` : '';
  return `- {{argument.${parameter.key}}} (${parameter.type}${required}): ${oneLine(parameter.label)}${description}`;
}

/**
 * A referenced command is context, never a run of it: the model reads its definition and follows
 * it where this message asks, filling its variables from the message. The user's own commands can
 * be read and changed with the `command` tool when the run has it; a plugin's are read-only.
 */
async function resolveCommand(
  context: Pick<ReferenceContext, 'dataDir' | 'toolCeiling'>,
  commandId: string,
): Promise<SavedHint | SavedNote> {
  const label = `Saved command ${commandId}`;
  let command: ServiceCommandFull | null;
  try {
    command = await readCommand(context.dataDir, commandId);
  } catch (error) {
    return { label, reason: `the saved commands could not be read (${errorMessage(error)})` };
  }
  if (!command) return { label, reason: 'it no longer exists' };
  const description = command.description ? `: ${oneLine(command.description)}` : '';
  const parameters = command.parameters.length
    ? [`Its parameters:\n${command.parameters.map(parameterLine).join('\n')}`]
    : [];
  const ownership = command.pluginId
    ? [`It comes from the plugin ${command.pluginId} and is read-only.`]
    : context.toolCeiling.includes('command')
      ? ['Read or change it with the command tool and this id when the user asks to.']
      : [];
  const text = [
    `Saved command "${oneLine(command.name)}" (id ${command.id})${description}. It was not run: follow its instructions where this message asks for them, taking its template variables from this message.`,
    `<command-instructions>\n${command.instructions}\n</command-instructions>`,
    ...parameters,
    ...ownership,
  ].join('\n');
  return {
    text,
    audit: {
      reference: 'command',
      target: commandId,
      decision: 'included',
      chars: command.instructions.length,
      ...(command.pluginId ? { pluginId: command.pluginId } : {}),
    },
  };
}

/**
 * A referenced memory by its stable id, as it reads now: an edit made since it was picked is what
 * the run reads, while one turned off since is never read. A run with memory off reads none,
 * referenced or not.
 */
async function resolveMemory(
  context: Pick<ReferenceContext, 'run'>,
  units: Promise<MemoryUnit[] | string>,
  target: MemoryTarget,
  entryId: string,
): Promise<SavedHint | SavedNote> {
  const label = `Memory entry (${TARGET_LABELS[target]})`;
  if (!context.run.snapshot.memory) return { label, reason: 'memory is off for this message' };
  const list = await units;
  if (typeof list === 'string') return { label, reason: list };
  const unit = list.find((item) => item.id === entryId);
  if (!unit) return { label, reason: 'it was changed or removed since it was picked' };
  if (!unit.enabled) return { label, reason: 'it is turned off in Memory settings' };
  return {
    text: `Memory entry, ${TARGET_LABELS[unit.type]}:\n<memory-entry>\n${framed(unit.body)}\n</memory-entry>`,
    audit: {
      reference: 'memory',
      target: `${target}:${entryId}`,
      decision: 'included',
      chars: unit.body.length,
    },
  };
}
