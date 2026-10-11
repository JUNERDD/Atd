import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  CommandArgumentValuesSchema,
  type CommandArgumentValues,
  type CommandParameter,
  type ServiceCommandFull,
} from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { atomicWrite } from '../config.js';
import { CommandStore } from './store.js';
import { parameterError } from './templates.js';

/**
 * The argument values each command last ran with from the app, so the next run starts from them
 * (`ServiceCommandFull.lastArguments`). Only the command run route records them: automations
 * launch commands too but never change what a person's next run starts from. The file is a
 * convenience cache, never a source of truth: a missing, oversized or unreadable file reads as
 * empty and a malformed record is skipped, so it can never block listing or running a command.
 * Values are checked against the command's parameters when recorded and again when read, so a
 * parameter that was removed or changed since simply falls back to its default.
 *
 * A deleted command's record is dropped by the delete route (`forget`); a command removed any
 * other way (the Agent's `command` tool, an uninstalled plugin) leaves its record, which reads
 * ignore because they only look up listed commands, and the oldest records beyond
 * `MAX_RECORDS` are pruned on the next write.
 */

/** The file's path and format are persisted data and stay fixed. */
function argumentsFile(dataDir: string): string {
  return path.join(dataDir, 'command-arguments.json');
}

const RecordSchema = Type.Object(
  { values: CommandArgumentValuesSchema, usedAt: Type.String({ maxLength: 64 }) },
  { additionalProperties: false },
);
type ArgumentsRecord = Static<typeof RecordSchema>;
/** Compiled once: every command list read checks each stored record. */
const RecordValidator = Compile(RecordSchema);

interface ArgumentsFile {
  version: 1;
  commands: Record<string, ArgumentsRecord>;
}

/** Most records kept: as many as the store holds commands, the most recently used first. */
const MAX_RECORDS = 500;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Pending writes per file, so concurrent runs' read-modify-writes apply one after another. */
const chains = new Map<string, Promise<void>>();

/** The stored records; anything that does not read as the format counts as no record. */
async function readRecords(file: string): Promise<Record<string, ArgumentsRecord>> {
  let raw: unknown;
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) return {};
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || raw.version !== 1)
    return {};
  const commands = 'commands' in raw ? raw.commands : undefined;
  if (typeof commands !== 'object' || commands === null || Array.isArray(commands)) return {};
  return Object.fromEntries(
    Object.entries(commands).filter((entry): entry is [string, ArgumentsRecord] =>
      RecordValidator.Check(entry[1]),
    ),
  );
}

/** The values `parameters` still declare and accept; an empty object when none remain. */
function accepted(
  parameters: readonly CommandParameter[],
  values: CommandArgumentValues,
): CommandArgumentValues {
  return Object.fromEntries(
    parameters.flatMap((parameter) => {
      const value = values[parameter.key];
      return value !== undefined && !parameterError(parameter, value)
        ? [[parameter.key, value]]
        : [];
    }),
  );
}

/** Applies `update` to the records of `dataDir` after any write already pending there. */
function change(
  dataDir: string,
  update: (records: Record<string, ArgumentsRecord>) => boolean,
): Promise<void> {
  const file = argumentsFile(dataDir);
  const operation = (chains.get(file) ?? Promise.resolve()).then(async () => {
    const records = await readRecords(file);
    if (!update(records)) return;
    const kept = Object.entries(records)
      .sort(([, a], [, b]) => b.usedAt.localeCompare(a.usedAt))
      .slice(0, MAX_RECORDS);
    const data: ArgumentsFile = { version: 1, commands: Object.fromEntries(kept) };
    await atomicWrite(file, data);
  });
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  chains.set(file, settled);
  void settled.then(() => {
    if (chains.get(file) === settled) chains.delete(file);
  });
  return operation;
}

/** Whether two sets of argument values hold the same keys with the same values. */
function sameValues(a: CommandArgumentValues, b: CommandArgumentValues): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/**
 * Remembers the argument values a run of `command` from the app used, keeping only those its
 * parameters declare and accept (none left drops its record), and tells clients the command list
 * changed so they prefill the next run. A command without parameters records nothing.
 *
 * A run with the values already remembered, the usual rerun, writes nothing and announces
 * nothing, so it never makes every window refetch the command list. Its `usedAt` stays at the
 * last change, which only matters for pruning beyond `MAX_RECORDS`.
 */
export async function recordLastArguments(
  dataDir: string,
  command: Pick<ServiceCommandFull, 'id' | 'parameters'>,
  values: CommandArgumentValues,
): Promise<void> {
  if (!command.parameters.length) return;
  const kept = accepted(command.parameters, values);
  let changed = false;
  await change(dataDir, (records) => {
    const stored = Object.hasOwn(records, command.id) ? records[command.id] : undefined;
    const empty = !Object.keys(kept).length;
    changed = empty ? stored !== undefined : !stored || !sameValues(stored.values, kept);
    if (!changed) return false;
    if (empty) delete records[command.id];
    else records[command.id] = { values: kept, usedAt: new Date().toISOString() };
    return true;
  });
  if (changed) CommandStore.announce(dataDir);
}

/** Drops the record of a deleted command. */
export async function forgetLastArguments(dataDir: string, id: string): Promise<void> {
  await change(dataDir, (records) => {
    if (!Object.hasOwn(records, id)) return false;
    delete records[id];
    return true;
  });
}

/**
 * `commands` with `lastArguments` set from the records, revalidated against each command's
 * current parameters, and removed where nothing valid remains (a client may send it back).
 * Answers new objects; the inputs are left as they are.
 */
export async function withLastArguments(
  dataDir: string,
  commands: readonly ServiceCommandFull[],
): Promise<ServiceCommandFull[]> {
  const records = await readRecords(argumentsFile(dataDir));
  return commands.map(({ lastArguments: _sent, ...command }) => {
    const record = Object.hasOwn(records, command.id) ? records[command.id] : undefined;
    const values = record ? accepted(command.parameters, record.values) : {};
    return Object.keys(values).length ? { ...command, lastArguments: values } : command;
  });
}

/** One command with its `lastArguments` (`withLastArguments`). */
export async function withLastArgumentsOf(
  dataDir: string,
  command: ServiceCommandFull,
): Promise<ServiceCommandFull> {
  const [attached] = await withLastArguments(dataDir, [command]);
  return attached ?? command;
}
