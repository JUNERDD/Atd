import { Type, type Static } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  Identifier,
  MAX_RUN_REFERENCES,
  MAX_RUN_SKILLS,
  parse,
  ServiceCommandFullSchema,
  type ServiceCommandFull,
} from '@atd/agent-contracts';
import type { Gate } from '../harness/gate.js';
import type { ChildTool } from '../subagents/child-tools.js';
import { withCanonicalShortcut } from './shortcuts.js';
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

/** The stored instructions field, described for the model that writes it. */
const InstructionsField = {
  ...Fields.instructions,
  description: `The prompt the command runs. It may use {{input}}, {{files}}, {{selection}}, {{clipboard}} and {{argument.<key>}} for declared parameters, and these tokens, each after a space or at the start: /skill:<name> loads that skill, @agent:<name> allows that subagent, @mcp:<serverId> suggests that MCP server's tools, @task:<taskId> includes an excerpt of that conversation. At most ${MAX_RUN_SKILLS} skills and ${MAX_RUN_REFERENCES} other tokens.`,
};

/** The input field, described for the model that writes it. */
const InputField = {
  ...Fields.input,
  description:
    'Where a run takes its input. source: manual (typed text), selection (text selected in another app), clipboard, screenshot (an image the user captures when the command runs; it needs files: true, and the image reaches the model as image input) or none. required: the user must supply text before running. files, selection and clipboard enable file attachments and the {{files}}, {{selection}} and {{clipboard}} variables.',
};

/** What the Agent may author; identity, enabled state and model stay with the stored command. */
const CommandFieldsSchema = Type.Object(
  {
    name: Fields.name,
    description: Fields.description,
    instructions: InstructionsField,
    input: InputField,
    parameters: Fields.parameters,
    tools: Fields.tools,
    memory: Fields.memory,
    shortcut: Type.Optional(
      Type.String({
        maxLength: 100,
        description:
          'Global shortcut as an Electron accelerator, e.g. CommandOrControl+Alt+S (Alt is Option on macOS). An empty string removes it; omit it to keep the current one.',
      }),
    ),
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
  "Manage the user's saved commands: list them, get one, or save (create or update) one. Saving asks the user to confirm. Instructions carry variables and /skill:, @agent:, @mcp: and @task: tokens (see the instructions field); a command has no separate skill or subagent setting. A save may set the command's global shortcut; one already used by the app or another command is refused, so ask the user for another combination. To update, get the command first and pass its id and revision.";

/** The save result the model reads; a shortcut adds where the user sees whether it registered. */
function savedResult(saved: ServiceCommandFull): string {
  const { id, revision, name, shortcut } = saved;
  if (!shortcut) return JSON.stringify({ id, revision, name });
  return JSON.stringify({
    id,
    revision,
    name,
    shortcut,
    note: 'The desktop app registers the shortcut. If another application already uses it, Settings > Commands marks it unavailable.',
  });
}

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
  return savedResult(await save(store, call, approve));
}

/** Refuses what the store would refuse before asking the user to approve the save. */
async function save(store: CommandStore, call: SaveCall, approve: ApproveSave) {
  const expected = call.expectedRevision ?? null;
  if (!call.commandId) {
    if (expected !== null)
      throw new Error('A new command has no revision yet. Omit expectedRevision.');
    const next = CommandStore.compose(call.fields);
    await store.assertShortcutFree(next);
    await approve({ title: `Create the command "${next.name}"?`, detail: createDetail(next) });
    return store.create({ ...call.fields, id: next.id });
  }
  const previous = store.get(call.commandId);
  if (expected !== previous.revision)
    throw new Error(
      'This command changed. Read the latest revision, then apply your change again.',
    );
  const next = withCanonicalShortcut(
    parse(ServiceCommandFullSchema, { ...previous, ...call.fields }),
  );
  validateCommandShape(next);
  await store.assertShortcutFree(next);
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
