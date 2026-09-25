import type { PreparedCommand } from './bridge';
import type { CommandDefinition } from './command-schema';
import { defaultArguments } from './command-validation';
import { emptyInput } from './task-schema';
import { errorMessage } from './validation';

/**
 * Builds the draft input for a command from its sources. A failed capture only surfaces as a
 * notice when the trigger expected captured text (the global shortcut); opening the command from
 * the panel leaves the field empty for manual input instead of reporting a missing selection.
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
      if (expectCapture) notice = errorMessage(error);
    }
  }
  return { command: structuredClone(command), input, notice };
}
