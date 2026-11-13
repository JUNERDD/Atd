import {
  landsOnScreenshot,
  newTaskTitle,
  type AgentTask,
  type CaptureAnswerAction,
  type PermissionTier,
  type RunComputer,
  type RunSnapshot,
  type RunTrigger,
  type SubmitTaskRequest,
  type TaskOrigin,
} from '@atd/agent-contracts';
import { screenshotTaskInstruction } from '../commands/output-instruction.js';
import { needsSummaryTitle } from './title-policy.js';

/**
 * What service code may set on an accepted run besides the HTTP request. The renderer-facing
 * `SubmitTaskRequestSchema` cannot carry these, so no client can forge an origin, a tier or a
 * trigger. `origin`, `permissionTier` and `title` apply only when the run creates its task.
 */
export interface InternalSubmitOptions {
  origin?: TaskOrigin;
  permissionTier?: PermissionTier;
  title?: string;
  /** Frozen as `RunSnapshot.trigger`, which makes the run unattended. */
  trigger?: RunTrigger;
  /**
   * Frozen as `RunSnapshot.instructions`, which reaches the model as hidden run material: what
   * only this run needs to be told (a command's output directive). A follow-up does not carry it
   * over; one on a screenshot-text answer is told that answer's format (`requestedOptions`).
   */
  instructions?: string;
  /**
   * Frozen as `RunSnapshot.lite`: the run takes the lightweight session (lite-session.ts). Set by
   * `launchCommand` for eligible saved commands (commands/lite.ts) and by `requestedOptions` for
   * eligible inline screenshot-text asks; an ordinary follow-up does not carry it.
   */
  lite?: true;
  /**
   * Frozen as `RunSnapshot.computer` with the automation grant or trial a request body cannot
   * carry. Only automation launches set it; a follow-up keeps the binding ids and drops the rest.
   */
  computer?: RunComputer;
  /**
   * Frozen as `RunSnapshot.captureOutput` when the run lands on an open screenshot
   * (`landsOnScreenshot`), enabling the `mark_screenshot` tool.
   */
  captureOutput?: CaptureAnswerAction;
  /** Frozen as `RunSnapshot.fromCapture` when the run started on a screenshot or capture text. */
  fromCapture?: true;
}

/**
 * A side-chat link is set when its task is created and never changes. A new task is not in the
 * ledger yet, so naming an existing task also rules out the new task itself.
 */
export function checkSideChatOf(
  sideChatOf: string | undefined,
  previous: AgentTask | null,
  tasks: readonly AgentTask[],
): void {
  if (sideChatOf === undefined) return;
  if (previous) throw new TypeError('Invalid data: sideChatOf only applies to a new task.');
  if (!tasks.some((item) => item.id === sideChatOf))
    throw new TypeError('Invalid data: sideChatOf needs an existing task.');
}

/**
 * `internal` with what the request asks service code to tell the run: a run or follow-up carrying
 * `SubmitTaskRequest.screenshotText` receives its answer-format instruction in hidden run material
 * (`screenshotTaskInstruction`), with the selected `[<id>]` blocks appended on new Ask tasks,
 * `run` repeats, and `reread` follow-ups. Free-form inline screenshot-text asks (`!fromCommand`,
 * `output !== 'panel'`) also take `lite` while the conversation has used only `lite` runs and the
 * request stages no tools, computer bindings, folders or chips; saved commands leave `lite` solely
 * to `launchCommand`. Service code that sets its own instructions sends no `screenshotText`.
 */
export function requestedOptions(
  request: SubmitTaskRequest,
  previous: AgentTask | null,
  internal: InternalSubmitOptions,
): InternalSubmitOptions {
  const screenshotText = request.screenshotText;
  if (screenshotText === undefined) return internal;
  if (!previous && screenshotText.turn === 'followUp')
    throw new TypeError('Invalid data: screenshotText followUp only applies to an existing task.');
  const isRun = !previous || screenshotText.turn === 'run';
  if (screenshotText.paragraphs === 0) {
    if (screenshotText.scope !== 'all')
      throw new TypeError('Invalid data: 0-paragraph screenshotText requires scope "all".');
    if (
      screenshotText.output === 'replaceSelection' ||
      screenshotText.output === 'insertAfterSelection'
    )
      throw new TypeError(
        `Invalid data: ${screenshotText.output} requires recognized screenshot text.`,
      );
  } else if (isRun && request.input.selection.trim() === '') {
    throw new TypeError('Invalid data: screenshotText run needs selection.');
  }
  const lite =
    !request.fromCommand &&
    screenshotText.output !== 'panel' &&
    (!previous || previous.runs.every((item) => item.snapshot.lite === true)) &&
    !request.tools?.length &&
    !request.computer &&
    !request.input.folders?.length &&
    !request.input.chips?.length;
  return {
    ...internal,
    instructions: screenshotTaskInstruction(
      screenshotText,
      request.input.selection,
      !previous,
      request.input.files.length > 0,
    ),
    ...(lite ? { lite: true } : {}),
    ...(landsOnScreenshot(screenshotText.output) ? { captureOutput: screenshotText.output } : {}),
    fromCapture: true,
  };
}

/**
 * The ledger record of a task a run creates. Everything that labels the task is part of the
 * creating write, including whether its initial input needs a background summary. Short plain
 * requests retain their direct title without entering a loading state.
 */
export function newTaskRecord(fields: {
  id: string;
  now: string;
  snapshot: RunSnapshot;
  /** The shared settings' default tier, used when the options name none. */
  tier: PermissionTier;
  summaryTitles: boolean;
  sideChatOf: string | undefined;
  internal: InternalSubmitOptions;
}): AgentTask {
  const { id, now, snapshot, tier, summaryTitles, sideChatOf, internal } = fields;
  return {
    id,
    title: internal.title ?? newTaskTitle(snapshot.input, snapshot.instructions),
    ...(summaryTitles &&
    internal.title === undefined &&
    internal.origin === undefined &&
    sideChatOf === undefined &&
    needsSummaryTitle(snapshot.input)
      ? { titleGeneration: 'pending' as const }
      : {}),
    createdAt: now,
    updatedAt: now,
    sessionFile: null,
    runs: [],
    rootTaskId: null,
    parentExecutionId: null,
    // A task keeps the tier it was created with; later default changes leave it alone.
    permissionTier: internal.permissionTier ?? tier,
    ...(internal.origin ? { origin: internal.origin } : {}),
    ...(sideChatOf ? { sideChatOf } : {}),
  };
}
