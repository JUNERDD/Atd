import type { TFunction } from 'i18next';
import type { CommandProblem } from '../../client/agent/command-validation';

/** A command problem in the app's language, for the editor to show under its field. */
export function problemText(problem: CommandProblem, t: TFunction<'commands'>): string {
  switch (problem.code) {
    case 'nameRequired':
      return t('validation.nameRequired');
    case 'instructionsRequired':
      return t('validation.instructionsRequired');
    case 'syntax':
      return t('instruction.syntaxError');
    case 'unsupportedTag':
      return t('instruction.unsupportedTag', problem.params);
    case 'undefinedVariables':
      return t('instruction.referenceError', problem.params);
    case 'tooManySkills':
      return t('instruction.tooManySkills', problem.params);
    case 'tooManyReferences':
      return t('instruction.tooManyReferences', problem.params);
    case 'selectionDisabled':
      return t('validation.selectionDisabled');
    case 'clipboardDisabled':
      return t('validation.clipboardDisabled');
    case 'filesDisabled':
      return t('validation.filesDisabled');
    case 'textNotAccepted':
      return t('validation.textNotAccepted');
    case 'duplicateKey':
      return t('validation.duplicateKey');
    case 'labelRequired':
      return t('validation.labelRequired');
    case 'range':
      return t('validation.range', problem.params);
    case 'optionIncomplete':
      return t('validation.optionIncomplete');
    case 'optionDuplicate':
      return t('validation.optionDuplicate');
    case 'invalidDefault':
      return t('validation.invalidDefault', problem.params);
  }
}
