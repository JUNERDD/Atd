import type { PreparedCommand } from './bridge';
import type { CommandDefinition } from './command-schema';
import { defaultArguments, templateReferences } from './command-validation';
import { emptyInput } from './task-schema';
import { errorMessage } from './validation';

/**
 * Builds the draft input for a command from its sources. A failed capture only surfaces as a
 * notice when the trigger expected captured text (the global shortcut) and the command consumes
 * that source, as its input source or a `{{selection}}` / `{{clipboard}}` reference. An enabled
 * but unused source stays optional, so it cannot block the run or mask the failure that matters;
 * the first consumed failure (selection before clipboard) is the one reported.
 */
export async function prepareCommand(
  command: CommandDefinition,
  capture: (source: 'selection' | 'clipboard') => Promise<{ text: string; capturedAt: string }>,
  expectCapture: boolean,
): Promise<PreparedCommand> {
  if (!command.enabled) throw new Error('This command is disabled. Enable it in settings.');
  const input = {
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
      const captured = await capture(source);
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
  return { command: structuredClone(command), input, notice };
}
