import {
  actsOnSelection,
  formatCaptureSelection,
  isImageMime,
  MAX_ATTACHMENTS,
  readsSelection,
} from '@atd/agent-contracts';
import type { PreparedCommand } from '../client/agent/bridge';
import { argumentOverrides } from '../client/agent/command-arguments';
import { isCaptureContext, type Screenshot } from '../client/agent/screenshot-input';
import type { FileRef, TaskInput } from '../client/agent/task-schema';
import type { CaptureTextRun } from '../client/capture-bridge';
import type { NativeCommands } from './native-commands';

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

/**
 * The command of a run on text picked in a screenshot (`captureText.run`), prepared as a command
 * launched on text the page holds (`prepareWithText`): the picked paragraphs, in the capture
 * grammar's blocks, stand in for the selection; the values picked in its options menu go over the
 * remembered ones; a command that also takes a screenshot reads the one the text is in. The
 * screenshot and its screen context are attached whatever the command's input accepts, which the
 * run tells the service (`screenshotText`). The answer goes where the options menu picked, else
 * where the command's saved output says, keeping its review setting; a pick that acts on a
 * selection the command does not read keeps the saved one.
 */
export async function prepareCaptureText(
  commands: NativeCommands,
  run: CaptureTextRun,
): Promise<PreparedCommand> {
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
