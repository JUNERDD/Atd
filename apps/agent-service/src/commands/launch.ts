import { randomUUID } from 'node:crypto';
import {
  instructionCapabilities,
  instructionReferenceKey,
  MAX_INPUT_CHIPS,
  parse,
  parseInstructionTokens,
  SubmitTaskRequestSchema,
  type InputChip,
  type InputChipRange,
  type InstructionReference,
  type InstructionToken,
  type ModelSelection,
  type PreviewTaskResponse,
  type RunReference,
  type ServiceCommandFull,
  type ServiceToolId,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
  type TaskInput,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import { findPluginCommand } from '../plugins/commands.js';
import { stageTaskReferences } from '../references/staging.js';
import type { RunnerManager } from '../runner-manager.js';
import { ensureSkillProfile, skillProfilePaths } from '../skills/profile.js';
import { stageTaskSkills } from '../skills/staging.js';
import type { ServicePaths } from '../storage.js';
import { resolvePreview } from '../tasks/preview.js';
import { CONTEXT_BUDGET, runInputSize } from '../tasks/run-budget.js';
import type { InternalSubmitOptions } from '../tasks/submit-options.js';
import { CommandStore } from './store.js';

/**
 * Launches a saved command as one service-side step: the single invocation path a command run
 * takes whoever starts it (the panel, an automation), per the plan's C3/C10 rule that new
 * triggers convert into the same invocation instead of copying the client's launch sequence.
 */

/** Why a saved command could not be launched: it is gone, turned off, or its input is invalid. */
export class CommandLaunchError extends Error {
  constructor(
    readonly code: 'notFound' | 'disabled' | 'invalidInput',
    message: string,
  ) {
    super(message);
    this.name = 'CommandLaunchError';
  }
}

export interface LaunchCommandDeps {
  paths: ServicePaths;
  ledger: Ledger;
  manager: RunnerManager;
}

export interface LaunchCommandRequest {
  commandId: string;
  operationId: string;
  /** Absent creates a new task. */
  taskId?: string;
  /**
   * What the command reads: the `{{input}}` text, argument values, files and captures, and the
   * folders the run may read. Its chips are replaced by the template's (`launchCommand`).
   */
  input: TaskInput;
  /**
   * Run-time picks over the command's saved settings, as the panel's pickers set them. A model
   * picked here wins over the command's fixed model, as everywhere a run's model is selected
   * (`runModelSelection`); without one, a fixed model applies, else the default connection's.
   */
  policy?: {
    model?: ModelSelection;
    thinkingLevel?: ThinkingLevel;
    tools?: ServiceToolId[];
    memory?: boolean;
  };
  sideChatOf?: string;
  /**
   * Text around the rendered template, joined to it with blank lines: an automation's context
   * before it, its previous answer and trigger data after it. Plain text that never becomes a chip
   * or stages anything, and counts against the run's input budget. The panel's route sends none.
   */
  frame?: { before?: string; after?: string };
}

/**
 * Accepts one run of a saved command, in order:
 *
 * 1. A repeated `operationId` answers its original run before anything is staged again.
 * 2. The command is the user's own, else an installed plugin's (user commands win, as the command
 *    routes serve them); a missing one is `notFound`, a turned-off one `disabled`.
 * 3. The preview (tasks/preview.ts) renders the template with the input and the command's
 *    argument defaults, and resolves the model, thinking level, tools and memory flag as the
 *    submit freezes them. Input the template cannot run with is `invalidInput`.
 * 4. The template's own tokens (instruction-tokens.ts) become the run's transcript chips and are
 *    staged as its skills and references. The input renders into the text too, but tokens it
 *    brings stay plain text: `{{input}}` can never add a skill or a reference to a run, and
 *    neither can the `frame` around the template.
 * 5. The submit marks the text as command material (`fromCommand`), which memory never learns
 *    from, and a task the run creates is titled after the command unless `internal` names one.
 *
 * Other failures pass through: an unknown connection (`LedgerNotFound`), a busy task
 * (`ConflictError`), draining, or a commands file that cannot be read.
 */
export async function launchCommand(
  deps: LaunchCommandDeps,
  request: LaunchCommandRequest,
  internal: InternalSubmitOptions = {},
): Promise<SubmitTaskResponse> {
  const known = deps.ledger.operation(request.operationId);
  if (known) return { taskId: known.taskId, runId: known.runId, duplicate: true };
  const command = await savedCommand(deps.paths.root, request.commandId);
  const { snapshot } = await preview(deps, command, request);
  const rendered = snapshot.instructions || request.input.text;
  if (!rendered.trim() && !request.input.files.length)
    throw new CommandLaunchError('invalidInput', 'Enter a message or attach a file.');
  const { text, span } = framed(rendered, request.frame);
  const tokens = parseInstructionTokens(command.instructions);
  const { skills, references } = instructionCapabilities(tokens);
  // Staging is per task, so a run that stages anything names its new task's id up front.
  const taskId = request.taskId ?? (skills.length || references.length ? randomUUID() : undefined);
  const thinkingLevel = request.policy?.thinkingLevel ?? snapshot.thinkingLevel;
  const submit = checked({
    operationId: request.operationId,
    ...(taskId ? { taskId } : {}),
    input: {
      ...request.input,
      text,
      chips: commandChips(text, span, tokens, deps.ledger),
      folders: request.input.folders ?? [],
    },
    // The preview applied the command's fixed model, which the submit cannot see on its own.
    model: request.policy?.model ?? {
      connectionId: snapshot.model.connectionId,
      modelId: snapshot.model.modelId,
    },
    ...(thinkingLevel ? { thinkingLevel } : {}),
    tools: snapshot.tools,
    memory: snapshot.memory,
    ...(request.sideChatOf ? { sideChatOf: request.sideChatOf } : {}),
    fromCommand: true,
  });
  if (
    request.frame &&
    runInputSize({ ...snapshot, input: submit.input, instructions: '' }) > CONTEXT_BUDGET
  )
    throw new CommandLaunchError('invalidInput', 'The framed command exceeds the input budget.');
  if (taskId) await stageTokens(deps.paths, taskId, skills, references);
  return deps.manager.submit(submit, { ...internal, title: internal.title ?? command.name });
}

/** The saved command `id`, refused when it is missing or turned off. */
async function savedCommand(dataDir: string, id: string): Promise<ServiceCommandFull> {
  const own = (await CommandStore.load(dataDir)).list().find((item) => item.id === id);
  const command = own ?? (await findPluginCommand(dataDir, id))?.value;
  if (!command) throw new CommandLaunchError('notFound', `Command ${id} was not found.`);
  if (!command.enabled)
    throw new CommandLaunchError('disabled', 'This command is disabled. Enable it first.');
  return command;
}

/** The preview of the run; its input problems (TypeError) are `invalidInput`. */
async function preview(
  deps: LaunchCommandDeps,
  command: ServiceCommandFull,
  request: LaunchCommandRequest,
): Promise<PreviewTaskResponse> {
  const { policy } = request;
  try {
    return await resolvePreview(
      { dataDir: deps.paths.root, ledger: deps.ledger },
      { command, input: request.input, ...(policy ? { policy } : {}) },
    );
  } catch (error) {
    if (error instanceof TypeError) throw new CommandLaunchError('invalidInput', error.message);
    throw error;
  }
}

/**
 * The submit as the HTTP route would accept it: in-process callers skip that route's parse, and
 * the request carries the caller's input and the chips the template's tokens made.
 */
function checked(request: SubmitTaskRequest): SubmitTaskRequest {
  try {
    return parse(SubmitTaskRequestSchema, request);
  } catch (error) {
    if (error instanceof TypeError) throw new CommandLaunchError('invalidInput', error.message);
    throw error;
  }
}

/** Where the rendered template sits in a run's text. */
interface Span {
  from: number;
  to: number;
}

/** The rendered template with the frame's text before and after it, joined with blank lines. */
function framed(
  rendered: string,
  frame: LaunchCommandRequest['frame'],
): { text: string; span: Span } {
  const before = frame?.before ? `${frame.before}\n\n` : '';
  const after = frame?.after ? `\n\n${frame.after}` : '';
  const span = { from: before.length, to: before.length + rendered.length };
  return { text: `${before}${rendered}${after}`, span };
}

/**
 * Transcript chips for a command run's rendered `text`: its tokens that the template holds, found
 * within the template's `span`, in document order (so ranges ascend without overlap), capped like
 * composer chips. A conversation chip shows that task's title, or its id when the task is gone.
 */
function commandChips(
  text: string,
  span: Span,
  template: readonly InstructionToken[],
  ledger: Ledger,
): InputChipRange[] {
  const keys = new Set(template.map((token) => instructionReferenceKey(token.reference)));
  return parseInstructionTokens(text)
    .filter((token) => token.from >= span.from && token.to <= span.to)
    .filter((token) => keys.has(instructionReferenceKey(token.reference)))
    .slice(0, MAX_INPUT_CHIPS)
    .map((token) => ({ from: token.from, to: token.to, chip: chipOf(token.reference, ledger) }));
}

function chipOf(reference: InstructionReference, ledger: Ledger): InputChip {
  if (reference.kind !== 'task') return reference;
  const title = ledger.data.tasks.find((task) => task.id === reference.taskId)?.title;
  return {
    kind: 'task',
    taskId: reference.taskId,
    title: (title || reference.taskId).slice(0, 1024),
  };
}

/**
 * Stages the template's skills and references for the task's next run, which consumes them once
 * when it freezes (run-freeze.ts). Template validation keeps both within the run caps.
 */
async function stageTokens(
  paths: ServicePaths,
  taskId: string,
  skills: readonly string[],
  references: RunReference[],
): Promise<void> {
  if (skills.length) {
    const profile = skillProfilePaths(paths.root, paths.agentDir);
    await ensureSkillProfile(profile);
    await stageTaskSkills(
      profile,
      taskId,
      skills.map((name) => ({ name })),
    );
  }
  if (references.length) await stageTaskReferences(paths.root, taskId, references);
}
