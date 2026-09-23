import type { TFunction } from 'i18next';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import {
  availableVariables,
  TemplateSyntaxError,
  templateReferences,
} from '../../../electron/agent/command-validation';

/**
 * What stops a command's instructions from being used, in the app's language, or '' when nothing
 * does. The editor shows it inline and Save shows it before the main-process checks, whose own
 * messages for the same problems are English (and Mustache's name raw offsets).
 */
export function instructionProblem(
  command: Pick<CommandDefinition, 'instructions' | 'input' | 'parameters'>,
  t: TFunction<'commands'>,
): string {
  const available = availableVariables(command);
  try {
    const unknown = templateReferences(command.instructions).filter(
      (reference) => !available.includes(reference.name),
    );
    return unknown.length
      ? t('instruction.referenceError', {
          variables: unknown.map((reference) => `{{${reference.name}}}`).join(', '),
        })
      : '';
  } catch (error) {
    return error instanceof TemplateSyntaxError && error.tag
      ? t('instruction.unsupportedTag', { tag: error.tag })
      : t('instruction.syntaxError');
  }
}
