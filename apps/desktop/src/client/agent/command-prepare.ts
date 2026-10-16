import {
  actsOnSelection,
  commandShortcut,
  MAX_ATTACHMENTS,
  shortcutRunSettings,
  type CommandShortcut,
  type ShortcutRunSettings,
} from '@atd/agent-contracts';
import type { CommandCatalog } from './agent-requests';
import type { ComposedInput, PreparedCommand } from './bridge';
import type { ArgumentValues, CommandDefinition } from './command-schema';
import { commandValues } from './command-arguments';
import { readyToRun, templateReferences } from './command-validation';
import { withScreenshot } from './screenshot-input';
import { emptyInput, type TaskInput } from './task-schema';
import { errorMessage } from './validation';

/**
 * A capture of the selection found nothing selected (or only whitespace). Thrown by the catalog's
 * `capture`, so `prepareCommand` can tell it from the other failures without reading its message.
 */
export class SelectionMissingError extends Error {}

/**
 * Whether a prepared command runs at once instead of opening its input step, by the command
 * shortcut's rule: no capture it consumes failed, and its input already resolves the instructions.
 */
export function runsAsIs(prepared: PreparedCommand): boolean {
  return !prepared.notice && readyToRun(prepared.command, prepared.input);
}

/**
 * The shortcut that launched `prepared`, as its command copy holds it; undefined for every other
 * launch (the toolbar, the launcher, a run button).
 */
export function launchShortcut(
  prepared: Pick<PreparedCommand, 'command' | 'shortcutId'>,
): CommandShortcut | undefined {
  return prepared.shortcutId === undefined
    ? undefined
    : commandShortcut(prepared.command, prepared.shortcutId);
}

/**
 * The output, model and reasoning level a run of `prepared` starts from before its own picks:
 * the launching shortcut's overrides, else the command's (`shortcutRunSettings`).
 */
export function launchSettings(
  prepared: Pick<PreparedCommand, 'command' | 'shortcutId'>,
): ShortcutRunSettings {
  return shortcutRunSettings(prepared.command, launchShortcut(prepared));
}

/**
 * `input` with `captured` as the text `source` holds, and as the input's own text (with when it
 * was captured) when `source` is the input's source. Text the page or the island holds in place of
 * the selection follows the same rule as a capture.
 */
export function withCapture(
  input: TaskInput,
  source: 'selection' | 'clipboard',
  captured: { text: string; capturedAt: string },
): TaskInput {
  const next = { ...input };
  next[source] = captured.text;
  if (input.source === source) {
    next.text = captured.text;
    next.capturedAt = captured.capturedAt;
  }
  return next;
}

/**
 * Builds the draft input for a command from its sources. A failed capture only surfaces as a
 * notice when the trigger expected captured text (the global shortcut) and the command consumes
 * that source, as its input source or a `{{selection}}` / `{{clipboard}}` reference. An enabled
 * but unused source stays optional, so it cannot block the run or mask the failure that matters;
 * the first consumed failure (selection before clipboard, then the screenshot) is the one reported.
 * When that failure is an empty selection and nothing else consumed failed, the launch records it
 * (`selectionMissing`), so it can ask for the text instead.
 * A screenshot command takes one capture; a cancelled one prepares the input without an image and
 * no notice, and the input page offers to take it again. The arguments start from the parameter
 * defaults, then the command's remembered values, then the values `shortcut` pins, then
 * `overrides` (`commandValues`); the answer goes where `shortcut` sends it, else where the
 * command's saved output says (`withOutputAction` picks another for the run). `shortcut` is the
 * command's own shortcut that launched it, which the launch carries (`shortcutId`) to the run.
 */
export async function prepareCommand(
  command: CommandDefinition,
  sources: Pick<CommandCatalog, 'capture' | 'screenshot'>,
  expectCapture: boolean,
  overrides?: ArgumentValues,
  shortcut?: CommandShortcut,
): Promise<PreparedCommand> {
  if (!command.enabled) throw new Error('This command is disabled. Enable it in settings.');
  let input: TaskInput = {
    ...emptyInput(),
    source: command.input.source,
    arguments: commandValues(command, overrides, shortcut?.arguments),
  };
  const referenced = new Set(
    templateReferences(command.instructions).map((reference) => reference.name),
  );
  /** The consumed captures that failed, in the order they were taken. */
  const failures: unknown[] = [];
  for (const source of ['selection', 'clipboard'] as const) {
    if (!command.input[source]) continue;
    try {
      input = withCapture(input, source, await sources.capture(source));
    } catch (error) {
      const consumed = input.source === source || referenced.has(source);
      if (expectCapture && consumed) failures.push(error);
    }
  }
  if (input.source === 'screenshot') {
    try {
      const shot = await sources.screenshot();
      if (shot) input = withScreenshot(input, shot);
    } catch (error) {
      if (expectCapture) failures.push(error);
    }
  }
  const [first] = failures;
  return {
    command: structuredClone(command),
    input,
    output: { ...shortcutRunSettings(command, shortcut).output },
    notice: first === undefined ? '' : errorMessage(first),
    ...(shortcut ? { shortcutId: shortcut.id } : {}),
    ...(failures.length === 1 && first instanceof SelectionMissingError
      ? { selectionMissing: true as const }
      : {}),
  };
}

/**
 * `prepared` with its missing selection no longer reported (no notice, no `selectionMissing`):
 * the input step, or the text composed on the island, stands in for it. A launch whose selection
 * was not missing is returned as it is.
 */
export function withoutSelectionNotice(prepared: PreparedCommand): PreparedCommand {
  if (!prepared.selectionMissing) return prepared;
  const { command, input, output, target, shortcutId } = prepared;
  return {
    command,
    input,
    output,
    notice: '',
    ...(target ? { target } : {}),
    ...(shortcutId === undefined ? {} : { shortcutId }),
  };
}

/**
 * A launch whose selection was missing, with what the person composed in its place on the
 * island: `text` stands in for the selection (`withCapture`, captured now), and `files` join the
 * input's files, each once, up to the attachment limit. Nothing was selected, so an answer meant
 * to go over or after the selection goes in at the cursor for this run (the shell refuses a
 * selection write on a target that recorded no selection), and the launch is marked `composed`.
 */
export function withComposedInput(
  prepared: PreparedCommand,
  { text, files }: ComposedInput,
): PreparedCommand {
  const settled = withoutSelectionNotice(prepared);
  const input = withCapture(settled.input, 'selection', {
    text,
    capturedAt: new Date().toISOString(),
  });
  const byId = new Map(input.files.map((file) => [file.id, file]));
  for (const file of files) if (!byId.has(file.id)) byId.set(file.id, file);
  const { action } = settled.output;
  return {
    ...settled,
    composed: true,
    input: { ...input, files: [...byId.values()].slice(0, MAX_ATTACHMENTS) },
    output: { ...settled.output, action: actsOnSelection(action) ? 'insertAtCursor' : action },
  };
}
