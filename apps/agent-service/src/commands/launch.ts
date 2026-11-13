import { randomUUID } from 'node:crypto';
import {
  commandShortcut,
  instructionCapabilities,
  landsOnScreenshot,
  parse,
  parseInstructionTokens,
  shortcutRunSettings,
  SubmitTaskRequestSchema,
  type CommandOutput,
  type CommandScreenshotText,
  type ComputerRunRequest,
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
import { commandFingerprint } from './fingerprint.js';
import { commandChips, framed } from './launch-text.js';
import { isLiteRun } from './lite.js';
import { outputInstruction } from './output-instruction.js';
import { CommandStore } from './store.js';

/**
 * Launches a saved command as one service-side step: the single invocation path a command run
 * takes whoever starts it (the panel, an automation), per the plan's C3/C10 rule that new
 * triggers convert into the same invocation instead of copying the client's launch sequence.
 */

/**
 * Why a saved command could not be launched: it is gone, turned off, the shortcut that launched it
 * is gone, or its input is invalid.
 */
export class CommandLaunchError extends Error {
  constructor(
    readonly code: 'notFound' | 'disabled' | 'shortcutGone' | 'invalidInput',
    message: string,
  ) {
    super(message);
    this.name = 'CommandLaunchError';
  }
}

/** The command changed since the caller froze its fingerprint; nothing was staged or submitted. */
export class CommandFingerprintMismatch extends Error {
  constructor() {
    super('The command changed after this run was approved.');
    this.name = 'CommandFingerprintMismatch';
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
  /** Where the answer goes for this run only, over the command's saved output. */
  output?: CommandOutput;
  /**
   * The command shortcut that launched the run; its overrides stand in for the command's output,
   * model and reasoning level where the request leaves them out. Automations send none.
   */
  shortcutId?: string;
  /**
   * Text around the rendered template, joined to it with blank lines: an automation's context
   * before it, its previous answer and trigger data after it. Plain text that never becomes a chip
   * or stages anything, and counts against the run's input budget. The panel's route sends none.
   */
  frame?: { before?: string; after?: string };
  /**
   * The fingerprint (commands/fingerprint.ts) an automation's computer grant froze; a command that
   * moved on since is refused (`CommandFingerprintMismatch`) before anything is staged.
   */
  expectedFingerprint?: string;
  /** Registered computer targets an attended run may act on (`SubmitTaskRequest.computer`). */
  computer?: ComputerRunRequest;
  /**
   * The run reads text recognized in a screenshot (`CommandRunRequest.screenshotText`): its files
   * (the screenshot and its screen context) attach whatever the command's input accepts, and its
   * output instruction says how to answer for that screenshot. The panel's route only.
   */
  screenshotText?: CommandScreenshotText;
}

/**
 * Accepts one run of a saved command, in order:
 *
 * 1. A repeated `operationId` answers its original run before anything is staged again.
 * 2. The command is the user's own, else an installed plugin's (user commands win, as the command
 *    routes serve them); a missing one is `notFound`, a turned-off one `disabled`, and one whose
 *    fingerprint is not the `expectedFingerprint` the caller froze is refused. A run from one
 *    of its shortcuts sees the command with that shortcut's output, model and reasoning level in
 *    place of the command's (`launchedAs`); a shortcut the command no longer has is
 *    `shortcutGone`, so a run never starts with part of a deleted shortcut's settings.
 * 3. The preview (tasks/preview.ts) renders the template with the input and the command's
 *    argument defaults, and resolves the model, thinking level, tools and memory flag as the
 *    submit freezes them. Input the template cannot run with is `invalidInput`.
 * 4. The template's own tokens (instruction-tokens.ts) become the run's transcript chips and are
 *    staged as its skills and references. The input renders into the text too, but tokens it
 *    brings stay plain text: `{{input}}` can never add a skill or a reference to a run, and
 *    neither can the `frame` around the template.
 * 5. The submit marks the text as command material (`fromCommand`), which memory never learns
 *    from, and a task the run creates is titled after the command unless `internal` names one.
 *    A command whose output is used verbatim also tells the model so, as the run's hidden
 *    instructions (`outputInstruction`), unless the run is unattended; a launch may pick another
 *    output for its run alone (`output`). A run on text in a screenshot (`screenshotText`) also
 *    attaches the screenshot's files whatever the command accepts, and is told how to answer for it.
 * 6. A person's run that creates its task and needs no tools, tokens, files, folders or frame
 *    takes the lightweight session (commands/lite.ts `isLiteRun`).
 *
 * Other failures pass through: an unknown connection (`LedgerNotFound`), a busy task
 * (`ConflictError`), draining, or a commands file that cannot be read.
 */
export async function launchCommand(
  deps: LaunchCommandDeps,
  request: LaunchCommandRequest,
  /** What only service code sets; whether the run is `lite` is this launch's own decision. */
  internal: Omit<InternalSubmitOptions, 'lite'> = {},
): Promise<SubmitTaskResponse> {
  const known = deps.ledger.operation(request.operationId);
  if (known) return { taskId: known.taskId, runId: known.runId, duplicate: true };
  const saved = await savedCommand(deps.paths.root, request.commandId);
  const expected = request.expectedFingerprint;
  if (expected !== undefined && commandFingerprint(saved) !== expected)
    throw new CommandFingerprintMismatch();
  const command = launchedAs(saved, request.shortcutId);
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
    ...(request.computer ? { computer: request.computer } : {}),
    fromCommand: true,
  });
  // An unattended run (`trigger`) has no app to write into and never touches the clipboard, so its
  // answer only stays in its conversation and the model is told nothing about where it goes.
  const effectiveOutput = request.output ?? command.output;
  const instructions = internal.trigger
    ? ''
    : (outputInstruction(effectiveOutput, request.screenshotText) ?? '');
  if (
    request.frame &&
    runInputSize({ ...snapshot, input: submit.input, instructions }) > CONTEXT_BUDGET
  )
    throw new CommandLaunchError('invalidInput', 'The framed command exceeds the input budget.');
  if (taskId) await stageTokens(deps.paths, taskId, skills, references);
  const joined = request.taskId
    ? deps.ledger.data.tasks.find((item) => item.id === request.taskId)
    : undefined;
  const lite = isLiteRun({
    taskId: request.taskId,
    input: request.input,
    tools: snapshot.tools,
    tokens,
    framed: request.frame !== undefined,
    computer: request.computer !== undefined,
    internal,
    screenshotText:
      request.screenshotText !== undefined &&
      (request.taskId === undefined ||
        (joined !== undefined && joined.runs.every((item) => item.snapshot.lite === true))),
  });
  const captureOutput =
    !internal.trigger &&
    request.screenshotText !== undefined &&
    landsOnScreenshot(effectiveOutput.action)
      ? effectiveOutput.action
      : undefined;
  return deps.manager.submit(submit, {
    ...internal,
    title: internal.title ?? command.name,
    ...(instructions ? { instructions } : {}),
    ...(lite ? { lite } : {}),
    ...(captureOutput ? { captureOutput } : {}),
    ...(request.screenshotText !== undefined && !internal.trigger
      ? { fromCapture: true as const }
      : {}),
  });
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

/**
 * The command as a run from its shortcut `shortcutId` sees it: the shortcut's output, model and
 * reasoning level where it overrides them (`shortcutRunSettings`), so the preview, the frozen
 * settings and the output instruction all start from them, and the run's own picks still win.
 * For this run only; it is never saved. Without a shortcut, the command itself.
 */
function launchedAs(
  command: ServiceCommandFull,
  shortcutId: string | undefined,
): ServiceCommandFull {
  if (shortcutId === undefined) return command;
  const shortcut = commandShortcut(command, shortcutId);
  if (!shortcut)
    throw new CommandLaunchError(
      'shortcutGone',
      'The shortcut that started this run no longer exists. Try again from another shortcut or the command itself.',
    );
  return { ...command, ...shortcutRunSettings(command, shortcut) };
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
      { anyFiles: request.screenshotText !== undefined },
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
