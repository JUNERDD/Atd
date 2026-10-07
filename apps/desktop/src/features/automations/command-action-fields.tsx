import { useTranslation } from 'react-i18next';
import type { AutomationAction, AutomationTrigger } from '@atd/agent-contracts';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { Textarea } from '@atd/ui/components/textarea';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { FieldError } from '../commands/field-error';
import { ParameterField } from '../commands/parameter-field';
import {
  commandAction,
  commandMemory,
  needsPresence,
  takesInput,
  type CommandAction,
  type DraftPatch,
} from './automation-draft';
import { commandProblem } from './automation-problems';
import { errorId, problemText, type AutomationProblemsView } from './use-automation-problems';

/**
 * A command action's fields: the command (one that reads the selection, the clipboard or a
 * screenshot is listed but cannot be chosen, since nobody is there to give it), the text for its
 * input when it takes text, and its parameter values, which start at the command's defaults.
 * Choosing a command also sets the runs' memory to the command's own setting. A chosen command
 * the service would refuse (turned off, or working on files without a folder trigger) says why
 * at once, as the service would on save.
 */
export function CommandActionFields({
  action,
  trigger,
  onChange,
  patch,
  commands,
  problems,
}: {
  action: CommandAction;
  /** The automation's trigger: only a folder trigger hands a command files. */
  trigger: AutomationTrigger;
  onChange: (action: AutomationAction) => void;
  patch: DraftPatch;
  commands: readonly CommandDefinition[];
  problems: AutomationProblemsView;
}) {
  const { t, i18n } = useTranslation('automations');
  const collator = new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' });
  const sorted = [...commands].sort((a, b) => collator.compare(a.name, b.name));
  const command = commands.find(({ id }) => id === action.commandId);
  // Once commands are read, a chosen one that is gone or refused says why before Save does.
  const refusal = action.commandId && commands.length ? commandProblem(command, trigger) : null;
  const commandError = problems.text('command') || (refusal ? problemText(refusal, t) : '');
  const inputError = problems.text('input');
  const argumentsError = problems.text('arguments');
  return (
    <div className="automation-field-stack">
      <div className="settings-field">
        <Label htmlFor="automation-command">{t('action.command')}</Label>
        <Select
          value={action.commandId}
          disabled={!commands.length && !action.commandId}
          onValueChange={(id) => {
            const next = commands.find((item) => item.id === id);
            if (!next) return;
            // Values of another command's parameters mean nothing to this one, and runs use
            // memory as the command's own setting says, as its runs from the panel do.
            patch((draft) => ({
              ...draft,
              action: { ...commandAction(next), input: action.input },
              policy: { ...draft.policy, memory: commandMemory(next) },
            }));
          }}
        >
          <SelectTrigger
            id="automation-command"
            className="w-full"
            aria-invalid={Boolean(commandError) || undefined}
            aria-describedby={commandError ? errorId('command') : undefined}
          >
            <SelectValue
              placeholder={
                commands.length ? t('action.commandPlaceholder') : t('action.noCommands')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {sorted.map((item) => (
              <SelectItem key={item.id} value={item.id} disabled={needsPresence(item)}>
                {needsPresence(item) ? t('action.needsPresence', { name: item.name }) : item.name}
              </SelectItem>
            ))}
            {/* A command deleted since stays chosen, named as gone, until another is picked. */}
            {action.commandId && !command && commands.length > 0 && (
              <SelectItem value={action.commandId} disabled>
                {t('action.deletedCommand')}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {commandError && <FieldError id={errorId('command')}>{commandError}</FieldError>}
      </div>
      {command && takesInput(command) && (
        <div className="settings-field">
          <Label htmlFor="automation-input">
            {t('action.input')}
            {command.input.required && <span className="text-muted-foreground"> *</span>}
          </Label>
          <Textarea
            id="automation-input"
            value={action.input}
            maxLength={20000}
            placeholder={t('action.inputPlaceholder')}
            aria-invalid={Boolean(inputError) || undefined}
            aria-describedby={inputError ? errorId('input') : 'automation-input-note'}
            onChange={(event) => onChange({ ...action, input: event.target.value })}
          />
          {inputError ? (
            <FieldError id={errorId('input')}>{inputError}</FieldError>
          ) : (
            <p id="automation-input-note" className="settings-field-note">
              {t('action.inputNote')}
            </p>
          )}
        </div>
      )}
      {command && command.parameters.length > 0 && (
        <fieldset className="settings-field automation-parameters">
          <legend className="settings-section-title">{t('action.parameters')}</legend>
          {command.parameters.map((parameter) => (
            <ParameterField
              key={parameter.key}
              parameter={parameter}
              value={action.arguments[parameter.key]}
              onChange={(value) => {
                const values = { ...action.arguments };
                if (value === undefined) delete values[parameter.key];
                else values[parameter.key] = value;
                onChange({ ...action, arguments: values });
              }}
            />
          ))}
          {argumentsError && <FieldError id={errorId('arguments')}>{argumentsError}</FieldError>}
        </fieldset>
      )}
    </div>
  );
}
