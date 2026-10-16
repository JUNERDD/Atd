import type { TFunction } from 'i18next';
import { commandShortcut } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import type { CommandProblem } from '../../client/agent/command-validation';
import type { ShortcutProblem } from '../../client/agent/shortcut-validation';
import type { ShortcutNames } from './shortcut-names';

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

/**
 * A shortcut problem in the app's language, for the editor to show on the shortcut's row.
 * `command` is the draft holding the shortcut; `commands` the saved ones a conflict may name.
 */
export function shortcutProblemText(
  problem: ShortcutProblem,
  { t, tSettings, names, command, commands }: ShortcutProblemLabels,
): string {
  switch (problem.code) {
    case 'invalidKeys':
      return t('shortcut.problem.invalidKeys');
    case 'pinnedValue':
      return t('shortcut.problem.pinnedValue', problem.params);
    case 'outputUnavailable':
      return t('shortcut.problem.outputUnavailable');
    case 'conflict': {
      const { holder } = problem;
      if (holder.kind === 'app')
        return t('shortcut.problem.heldByAction', {
          action: tSettings(`shortcuts.actions.${holder.action}.label`),
        });
      if (holder.kind === 'selectionToolbar') return t('shortcut.problem.heldBySelectionToolbar');
      const own = holder.id === command.id && commandShortcut(command, holder.shortcutId);
      return own
        ? t('shortcut.problem.heldBySameCommand', { name: names.title(command, own) })
        : t('shortcut.problem.heldByCommand', { name: names.holder(holder, commands) });
    }
  }
}

/** What `shortcutProblemText` names things with. */
export interface ShortcutProblemLabels {
  t: TFunction<'commands'>;
  tSettings: TFunction<'settings'>;
  names: ShortcutNames;
  command: CommandDefinition;
  commands: readonly CommandDefinition[];
}
