import type { CommandCatalog } from './agent-requests';
import type { PreparedCommand } from './bridge';
import type { CommandDefinition } from './command-schema';
import { defaultArguments, templateReferences } from './command-validation';
import { withScreenshot } from './screenshot-input';
import { emptyInput, type TaskInput } from './task-schema';
import { errorMessage } from './validation';

/**
 * Builds the draft input for a command from its sources. A failed capture only surfaces as a
 * notice when the trigger expected captured text (the global shortcut) and the command consumes
 * that source, as its input source or a `{{selection}}` / `{{clipboard}}` reference. An enabled
 * but unused source stays optional, so it cannot block the run or mask the failure that matters;
 * the first consumed failure (selection before clipboard, then the screenshot) is the one reported.
 * A screenshot command takes one capture; a cancelled one prepares the input without an image and
 * no notice, and the input page offers to take it again.
 */
export async function prepareCommand(
  command: CommandDefinition,
  sources: Pick<CommandCatalog, 'capture' | 'screenshot'>,
  expectCapture: boolean,
): Promise<PreparedCommand> {
  if (!command.enabled) throw new Error('This command is disabled. Enable it in settings.');
  let input: TaskInput = {
    ...emptyInput(),
    source: command.input.source,
    arguments: defaultArguments(command),
  };
  const referenced = new Set(
    templateReferences(command.instructions).map((reference) => reference.name),
  );
  let notice = '';
  for (const source of ['selection', 'clipboard'] as const) {
    if (!command.input[source]) continue;
    try {
      const captured = await sources.capture(source);
      input[source] = captured.text;
      if (input.source === source) {
        input.text = captured.text;
        input.capturedAt = captured.capturedAt;
      }
    } catch (error) {
      const consumed = input.source === source || referenced.has(source);
      if (expectCapture && consumed && !notice) notice = errorMessage(error);
    }
  }
  if (input.source === 'screenshot') {
    try {
      const shot = await sources.screenshot();
      if (shot) input = withScreenshot(input, shot);
    } catch (error) {
      if (expectCapture && !notice) notice = errorMessage(error);
    }
  }
  return { command: structuredClone(command), input, notice };
}
