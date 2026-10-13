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
 * The argument values each command last ran with from the app, or that the person last changed
 * in its options without running it, so the next run starts from them
 * (`ServiceCommandFull.lastArguments`). Only the command run route and the arguments route
 * record them: automations launch commands too but never change what a person's next run starts
 * from. The file is a
 * convenience cache, never a source of truth: a missing, oversized or unreadable file reads as
 * empty and a malformed record is skipped, so it can never block listing or running a command.
 * Values are checked against the command's parameters when recorded and again when read, so a
 * parameter that was removed or changed since simply falls back to its default. Each value also
 * keeps the default its parameter had when it was recorded and is used only while that default
 * stays the same: editing a default is an explicit choice of where runs start, so it replaces the
 * remembered value until a run or the options pick another one.
 *
 * A deleted command's record is dropped by the delete route (`forget`); a command removed any
 * other way (the Agent's `command` tool, an uninstalled plugin) leaves its record, which reads
 * ignore because they only look up listed commands, and the oldest records beyond
 * `MAX_RECORDS` are pruned on the next write.
 */

/** The file's path is persisted data and stays fixed; its format is versioned (`ArgumentsFile`). */
function argumentsFile(dataDir: string): string {
  return path.join(dataDir, 'command-arguments.json');
}

/** The default each remembered value was recorded over, by parameter key; `null` for none. */
const DefaultsSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean(), Type.Null()]),
);
const RecordSchema = Type.Object(
  {
    values: CommandArgumentValuesSchema,
    defaults: DefaultsSchema,
    usedAt: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
type ArgumentsRecord = Static<typeof RecordSchema>;
/** Compiled once: every command list read checks each stored record. */
const RecordValidator = Compile(RecordSchema);

/**
 * Version 1 files predate `defaults`: their values cannot tell whether a default changed since,
 * so they read as empty and runs start from the defaults again.
 */
interface ArgumentsFile {
  version: 2;
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
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || raw.version !== 2)
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

/** The default of `parameter` as a record keeps it. */
function defaultOf(parameter: CommandParameter): Static<typeof DefaultsSchema>[string] {
  return parameter.default ?? null;
}

/**
 * The values of `record` a run of a command with `parameters` starts from: those `accepted`, each
 * only while its parameter's default is still the one it was recorded over.
 */
function remembered(
  parameters: readonly CommandParameter[],
  record: ArgumentsRecord,
): CommandArgumentValues {
  const current = parameters.filter(
    (parameter) =>
      Object.hasOwn(record.defaults, parameter.key) &&
      Object.is(record.defaults[parameter.key], defaultOf(parameter)),
  );
  return accepted(current, record.values);
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
    const data: ArgumentsFile = { version: 2, commands: Object.fromEntries(kept) };
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

/** Whether two records of values or defaults hold the same keys with the same values. */
function sameValues(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
  );
}

/**
 * Remembers the argument values a run of `command` from the app used, keeping only those its
 * parameters declare and accept (none left drops its record) with the defaults they were picked
 * over, and tells clients the command list changed so they prefill the next run. A command
 * without parameters records nothing.
 *
 * A run with the values and defaults already remembered, the usual rerun, writes nothing and
 * announces nothing, so it never makes every window refetch the command list. Its `usedAt` stays
 * at the last change, which only matters for pruning beyond `MAX_RECORDS`.
 */
export async function recordLastArguments(
  dataDir: string,
  command: Pick<ServiceCommandFull, 'id' | 'parameters'>,
  values: CommandArgumentValues,
): Promise<void> {
  if (!command.parameters.length) return;
  const kept = accepted(command.parameters, values);
  const defaults = Object.fromEntries(
    command.parameters.flatMap((parameter) =>
      Object.hasOwn(kept, parameter.key) ? [[parameter.key, defaultOf(parameter)]] : [],
    ),
  );
  let changed = false;
  await change(dataDir, (records) => {
    const stored = Object.hasOwn(records, command.id) ? records[command.id] : undefined;
    const empty = !Object.keys(kept).length;
    changed = empty
      ? stored !== undefined
      : !stored || !sameValues(stored.values, kept) || !sameValues(stored.defaults, defaults);
    if (!changed) return false;
    if (empty) delete records[command.id];
    else records[command.id] = { values: kept, defaults, usedAt: new Date().toISOString() };
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
 * current parameters and defaults (`remembered`), and removed where nothing valid remains (a
 * client may send it back). Answers new objects; the inputs are left as they are.
 */
export async function withLastArguments(
  dataDir: string,
  commands: readonly ServiceCommandFull[],
): Promise<ServiceCommandFull[]> {
  const records = await readRecords(argumentsFile(dataDir));
  return commands.map(({ lastArguments: _sent, ...command }) => {
    const record = Object.hasOwn(records, command.id) ? records[command.id] : undefined;
    const values = record ? remembered(command.parameters, record) : {};
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
