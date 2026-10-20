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
import { CommandStore } from './store.js';
import { validateCommandSave } from './templates.js';
import { createDetail, updateDetail } from './tool-detail.js';
import { mergeShortcuts, ShortcutsField, shortcutResult } from './tool-shortcuts.js';

/**
 * The `command` tool: the Agent lists, reads and saves the user's saved commands in the service
 * command store (`commands.json`, the store behind `/v1/commands`). list/get are read-only;
 * every save is confirmed through the gate (`{ tool: 'command' }`) after it validated
 * (`validateCommandSave`), so the user approves exactly what will be stored, where its answer goes
 * included. The argument shape (`operation`, `commandId`,
 * `expectedRevision`, `fields`) is the one the desktop transcript labels rows by.
 */

const Fields = ServiceCommandFullSchema.properties;

/** The stored instructions field, described for the model that writes it. */
const InstructionsField = {
  ...Fields.instructions,
  description: `The prompt the command runs. It may use {{input}}, {{files}}, {{selection}}, {{clipboard}} and {{argument.<key>}} for declared parameters. A variable it uses must have a value on every run, or the run stops to ask for it ({{files}} needs an attached file each time), so the text the command works on goes in {{input}} alone, which input.source fills; never write a fallback order between variables. It may also carry these tokens, each after a space or at the start: /skill:<name> loads that skill, @agent:<name> allows that subagent, @mcp:<serverId> suggests that MCP server's tools, @task:<taskId> includes an excerpt of that conversation. At most ${MAX_RUN_SKILLS} skills and ${MAX_RUN_REFERENCES} other tokens.`,
};

/** The input field, described for the model that writes it. */
const InputField = {
  ...Fields.input,
  description:
    'Where a run takes its input. source: manual (text the user types in the panel), selection (text selected in another app), clipboard, screenshot (an image the user captures when the command runs; it needs files: true, and the image reaches the model as image input) or none. Use selection for a command that works on text the user points at, such as translating, rewriting or explaining it; manual is for text the user writes for the command, and a manual required input always opens the panel to ask for it, also from a shortcut or the toolbar. required: the user must supply text before running. files, selection and clipboard enable file attachments and the {{files}}, {{selection}} and {{clipboard}} variables.',
};

/** The reasoning level field, described for the model that writes it. */
const ThinkingLevelField = Type.Optional({
  ...Fields.thinkingLevel,
  description:
    "How much the model reasons before it answers when the command runs, whichever model runs it: inherit uses the connection's default level; off, minimal, low, medium, high, xhigh and max ask for that level, which the run lowers to what the model supports. Lower is faster and cheaper, higher more thorough. Set it only when the user asks for a level; omit it to keep the current level, and a new command inherits.",
});

/** The output field, described for the model that writes it. */
const OutputField = Type.Optional({
  ...Fields.output,
  description:
    "What happens with the answer when a run finishes; it always also stays in the conversation. action: panel (only the conversation), replaceSelection (written over the selected text), insertAfterSelection (written right after it), insertAtCursor (typed at the cursor of the app the command ran from) or copy (put on the clipboard). replaceSelection and insertAfterSelection need a command that reads the selection (input.source selection or input.selection true). Write-backs apply to runs from the command's shortcut or the selection toolbar; a command that reads the selection, run from its shortcut with nothing selected, asks the user for the text and puts an answer meant for the selection at the cursor, and where the app cannot take text the answer shows in a card to copy. review: for the three write-backs, true holds the answer in the conversation until the user applies it, so runs from the shortcut or the toolbar open the panel instead of writing the answer back in place; leave it false unless the user asks to check answers before they land. Omit output to keep the current one; a new command keeps the answer in the conversation. A save whose output acts on the selection of a command that does not read it is refused, also when an input change strands the stored output, so send output whenever you change input.",
});

/**
 * What the Agent may author; identity, enabled state, model and placement stay with the stored
 * command: a create takes the default placement of its input source, an update keeps the current
 * one. The output is the Agent's to set because where the answer goes is part of what the user
 * asks a command to do; an omitted output keeps the stored one (the default for a create), and a
 * save refuses an output the input cannot serve (`validateCommandSave`) instead of resetting it.
 * The model is the user's choice in Settings, but the reasoning level is a property of the task
 * the command does, so the Agent may set it, for the command and for each of its shortcuts; a
 * shortcut's model override is the user's too and survives an update by shortcut id.
 */
const CommandFieldsSchema = Type.Object(
  {
    name: Fields.name,
    description: Fields.description,
    instructions: InstructionsField,
    input: InputField,
    output: OutputField,
    parameters: Fields.parameters,
    tools: Fields.tools,
    memory: Fields.memory,
    thinkingLevel: ThinkingLevelField,
    shortcuts: ShortcutsField,
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
  "Manage the user's saved commands: list them, get one, or save (create or update) one. Saving asks the user to confirm. Instructions carry variables and /skill:, @agent:, @mcp: and @task: tokens (see the instructions field); a command has no separate skill or subagent setting. A save may set where the answer goes (see the output field) and the command's global shortcuts (see the shortcuts field): up to eight, each an entry point that may fix some parameter values or change the answer's destination or the reasoning level, and the rest follows the command; a key combination already used by the app, the selection toolbar or another shortcut is refused, so ask the user for another combination. To update, get the command first and pass its id and revision.";

/** The save result the model reads; shortcuts add where the user sees whether each registered. */
function savedResult(saved: ServiceCommandFull): string {
  const { id, revision, name, shortcuts } = saved;
  if (!shortcuts.length) return JSON.stringify({ id, revision, name });
  return JSON.stringify({
    id,
    revision,
    name,
    shortcuts: shortcutResult(shortcuts),
    note: 'The desktop app registers each shortcut that has keys. If another application already uses a combination, Settings > Commands marks that shortcut unavailable.',
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
    const draft = { ...call.fields, shortcuts: mergeShortcuts([], call.fields.shortcuts) };
    const next = CommandStore.compose(draft);
    await store.assertShortcutsFree(next);
    await approve({ title: `Create the command "${next.name}"?`, detail: createDetail(next) });
    return store.create({ ...draft, id: next.id });
  }
  const previous = store.get(call.commandId);
  if (expected !== previous.revision)
    throw new Error(
      'This command changed. Read the latest revision, then apply your change again.',
    );
  const next = parse(ServiceCommandFullSchema, {
    ...previous,
    ...call.fields,
    shortcuts: mergeShortcuts(previous.shortcuts, call.fields.shortcuts),
  });
  validateCommandSave(next);
  await store.assertShortcutsFree(next);
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

/** The parent's deferred `command` tool; saves go through the service gate. */
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
    exposure: 'deferred',
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
