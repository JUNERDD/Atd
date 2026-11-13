import {
  actsOnSelection,
  defaultCommandPlacement,
  formatCaptureSelection,
  isImageMime,
  MAX_ATTACHMENTS,
  readsSelection,
} from '@atd/agent-contracts';
import type { PreparedCommand } from '../client/agent/bridge';
import { argumentOverrides } from '../client/agent/command-arguments';
import type { CommandDefinition } from '../client/agent/command-schema';
import { newCommand } from '../client/agent/command-templates';
import { isCaptureContext, type Screenshot } from '../client/agent/screenshot-input';
import { emptyInput, type FileRef, type TaskInput } from '../client/agent/task-schema';
import type { CaptureTextRun } from '../client/capture-bridge';
import i18n from '../i18n';
import type { NativeCommands } from './native-commands';

/** Synthetic command id used by `CaptureTextRunner` when running Ask Atd on screenshot text. */
export const ASK_CAPTURE_COMMAND_ID = '@ask';

/**
 * The screenshot the shell imported for a run on its text: its image, and the screen context
 * beside it when there is one. Null when the files hold no image.
 */
function screenshotOf(files: readonly FileRef[], capturedAt: string): Screenshot | null {
  const file = files.find((candidate) => isImageMime(candidate.type));
  if (!file) return null;
  return { file, context: files.find(isCaptureContext) ?? null, capturedAt };
}

/** `input` with `files` attached after its own, each once, up to the attachment limit. */
function withFiles(input: TaskInput, files: readonly FileRef[]): TaskInput {
  const byId = new Map(input.files.map((file) => [file.id, file]));
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  return { ...input, files: [...byId.values()].slice(0, MAX_ATTACHMENTS) };
}

/** Builds the synthetic command launch for a free-form Ask on a screenshot or its recognized text. */
function prepareAskCaptureText(run: CaptureTextRun, question: string): PreparedCommand {
  const picked = run.arguments?.output ?? 'annotate';
  const action =
    run.paragraphs.length === 0 &&
    (picked === 'replaceSelection' || picked === 'insertAfterSelection')
      ? 'annotate'
      : picked;
  const command: CommandDefinition = {
    ...newCommand(ASK_CAPTURE_COMMAND_ID),
    name: i18n.t('tasks:commandOutput.ask.title'),
    instructions: question,
    input: { source: 'selection', required: true, files: true, selection: true, clipboard: false },
    placement: defaultCommandPlacement('selection'),
    output: { action: 'annotate', review: false },
  };
  return {
    command,
    input: withFiles(
      { ...emptyInput(), text: question, selection: formatCaptureSelection(run.paragraphs) },
      run.files,
    ),
    output: { action, review: false },
    notice: '',
  };
}

/**
 * The command or Ask of a run on text picked in a screenshot (`captureText.run`):
 * - For `run.question`, builds a free-form Ask payload with `input.text` as the question,
 *   `[<id>]` / `[<id> @ x1,y1,x2,y2]` paragraph blocks in `input.selection`, the screenshot +
 *   context in `input.files`, and `output.action` set to `run.arguments?.output ?? 'annotate'`.
 * - For `run.commandId`, prepares the saved command as `prepareWithText`, attaching the
 *   screenshot and context whatever the command accepts and honoring a compatible picked output.
 */
export async function prepareCaptureText(
  commands: NativeCommands,
  run: CaptureTextRun,
): Promise<PreparedCommand> {
  if (run.question !== undefined) return prepareAskCaptureText(run, run.question);
  if (!run.commandId) throw new Error('A capture text run requires a command or question.');
  const command = commands.find(run.commandId);
  const capturedAt = new Date().toISOString();
  const prepared = await commands.prepareWithText(
    command.id,
    formatCaptureSelection(run.paragraphs),
    run.arguments && argumentOverrides(command, run.arguments),
    screenshotOf(run.files, capturedAt),
  );
  const picked = run.arguments?.output;
  const usable = picked && !(actsOnSelection(picked) && !readsSelection(command.input));
  return {
    ...prepared,
    input: withFiles(prepared.input, run.files),
    output: usable ? { ...prepared.output, action: picked } : prepared.output,
  };
}
