import { Type, type Static } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Identifier, parse, ServiceCommandFullSchema } from '@ai/agent-contracts';
import type { Gate } from '../harness/gate.js';
import type { ChildTool } from '../subagents/child-tools.js';
import { CommandStore } from './store.js';
import { validateCommandShape } from './templates.js';
import { createDetail, updateDetail } from './tool-detail.js';

/**
 * The `command` tool: the Agent lists, reads and saves the user's saved commands in the service
 * command store (`commands.json`, the store behind `/v1/commands`). list/get are read-only;
 * every save is confirmed through the gate (`{ tool: 'command' }`) after it validated, so the
 * user approves exactly what will be stored. The argument shape (`operation`, `commandId`,
 * `expectedRevision`, `fields`) is the one the desktop transcript labels rows by.
 */

const Fields = ServiceCommandFullSchema.properties;

/** What the Agent may author; identity, state, shortcut and model stay with the stored command. */
const CommandFieldsSchema = Type.Object(
  {
    name: Fields.name,
    description: Fields.description,
    instructions: Fields.instructions,
    input: Fields.input,
    parameters: Fields.parameters,
    tools: Fields.tools,
    memory: Fields.memory,
  },
  { additionalProperties: false },
);

const Revision = Type.Integer({ minimum: 1 });

/** The validated call: one variant per operation. */
const CommandCallSchema = Type.Union([
  Type.Object({ operation: Type.Literal('list') }, { additionalProperties: false }),
  Type.Object(
    { operation: Type.Literal('get'), commandId: Identifier },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      operation: Type.Literal('save'),
      commandId: Type.Optional(Type.Union([Identifier, Type.Null()])),
      expectedRevision: Type.Optional(Type.Union([Revision, Type.Null()])),
      fields: CommandFieldsSchema,
    },
    { additionalProperties: false },
  ),
]);
type CommandCall = Static<typeof CommandCallSchema>;
type SaveCall = Extract<CommandCall, { operation: 'save' }>;

/**
 * Parameters sent to the model. Providers require an object root, so the union above is flattened
 * here and every call is validated against it before it runs.
 */
export const CommandToolParametersSchema = Type.Object(
  {
    operation: Type.Union([Type.Literal('list'), Type.Literal('get'), Type.Literal('save')], {
      description:
        'list: summaries of every saved command. get: one full command. save: create or update.',
    }),
    commandId: Type.Optional(
      Type.Union([Identifier, Type.Null()], {
        description:
          'get: the command to read. save: the command to update; null or absent creates one.',
      }),
    ),
    expectedRevision: Type.Optional(
      Type.Union([Revision, Type.Null()], {
        description:
          'save of an existing command: the revision you read with get. null for a new command.',
      }),
    ),
    fields: Type.Optional(CommandFieldsSchema),
  },
  { additionalProperties: false },
);

const DESCRIPTION =
  "Manage the user's saved commands: list them, get one, or save (create or update) one. Saving asks the user to confirm. Instructions may use {{input}}, {{files}}, {{selection}}, {{clipboard}} and {{argument.<key>}} for declared parameters. To update, get the command first and pass its id and revision.";

/** Approves a validated save; throws when it is not approved. */
type ApproveSave = (request: { title: string; detail: string }) => Promise<void>;

/** Runs one call against the store; answers the model-facing JSON text. */
export async function runCommandCall(
  dataDir: string,
  args: unknown,
  approve: ApproveSave,
): Promise<string> {
  const call = parse(CommandCallSchema, args);
  const store = await CommandStore.load(dataDir);
  if (call.operation === 'list') {
    const summaries = store
      .list()
      .map(({ id, revision, name, description }) => ({ id, revision, name, description }));
    // An empty JSON array reads as nothing in the transcript; say it in words instead.
    return summaries.length ? JSON.stringify(summaries) : 'No saved commands.';
  }
  if (call.operation === 'get') return JSON.stringify(store.get(call.commandId));
  const saved = await save(store, call, approve);
  return JSON.stringify({ id: saved.id, revision: saved.revision, name: saved.name });
}

async function save(store: CommandStore, call: SaveCall, approve: ApproveSave) {
  const expected = call.expectedRevision ?? null;
  if (!call.commandId) {
    if (expected !== null)
      throw new Error('A new command has no revision yet. Omit expectedRevision.');
    const next = CommandStore.compose(call.fields);
    await approve({ title: `Create the command "${next.name}"?`, detail: createDetail(next) });
    return store.create({ ...call.fields, id: next.id });
  }
  const previous = store.get(call.commandId);
  if (expected !== previous.revision)
    throw new Error(
      'This command changed. Read the latest revision, then apply your change again.',
    );
  const next = parse(ServiceCommandFullSchema, { ...previous, ...call.fields });
  // Validate before asking, so the user never approves a save the store would refuse.
  validateCommandShape(next);
  await approve({
    title: `Update the command "${next.name}"?`,
    detail: updateDetail(previous, next),
  });
  return store.update(previous.id, next, previous.revision);
}

/** Asks the gate for one save of one tool call; the same confirm for parent and child. */
function gatedSave(gate: Gate, toolCallId: string, signal: AbortSignal | undefined): ApproveSave {
  return async ({ title, detail }) => {
    await gate({ toolCallId, scope: { tool: 'command' }, title, detail, signal });
  };
}

/** The parent's `command` tool; saves go through the service gate. */
export function commandToolDefinition(
  dataDir: string,
  gate: Gate,
): ToolDefinition<typeof CommandToolParametersSchema> {
  return {
    name: 'command',
    label: 'Manage commands',
    description: DESCRIPTION,
    parameters: CommandToolParametersSchema,
    executionMode: 'sequential',
    async execute(id, args, signal) {
      signal?.throwIfAborted();
      const text = await runCommandCall(dataDir, args, gatedSave(gate, id, signal ?? undefined));
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}

/**
 * A child's `command` tool: the same calls, and saves ask the same `{ tool: 'command' }` confirm
 * through the child's gate (the parent's gate, attributed to the child's execution).
 */
export function childCommandTool(
  dataDir: string,
  gate: Gate,
  audit: (decision: string) => void,
): ChildTool {
  return {
    name: 'command',
    label: 'Manage commands',
    description: DESCRIPTION,
    parameters: CommandToolParametersSchema,
    async execute(id, args, signal) {
      signal?.throwIfAborted();
      const text = await runCommandCall(dataDir, args, gatedSave(gate, id, signal));
      audit('allow');
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
}
