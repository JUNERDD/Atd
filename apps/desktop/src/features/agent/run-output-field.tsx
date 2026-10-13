import { Fragment, useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandOutput } from '@atd/agent-contracts';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { PreparedCommand } from '../../client/agent/bridge';
import {
  OUTPUT_ACTION_GROUPS,
  OUTPUT_ACTIONS,
  outputUnavailable,
} from '../../client/agent/run-output';

/**
 * Where this run's answer goes, as the last field of the command's input step: the pop-up lists
 * the actions in the command settings' groups, names the command's saved one as the default, and
 * starts from what the launch carries (`PreparedCommand.output`). A pick lasts for this run only.
 * Actions the run cannot use stay in the menu, disabled: the selection actions for a command that
 * does not read the selection, the write-backs for a launch that did not come from another app.
 * When the current action is one of them, a note under the field says why the answer will stay in
 * the conversation instead.
 */
export function RunOutputField({
  prepared,
  onChange,
}: {
  prepared: PreparedCommand;
  onChange: (output: CommandOutput) => void;
}) {
  const { t } = useTranslation('commands');
  const id = useId();
  const { action } = prepared.output;
  const saved = prepared.command.output.action;
  const blocked = outputUnavailable(prepared, action);
  return (
    <div className="settings-field">
      <Label htmlFor={id}>{t('output.action')}</Label>
      <Select
        value={action}
        onValueChange={(value) => {
          const next = OUTPUT_ACTIONS.find((candidate) => candidate === value);
          if (next) onChange({ ...prepared.output, action: next });
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-describedby={`${id}-note`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OUTPUT_ACTION_GROUPS.map((group, index) => (
            <Fragment key={group[0]}>
              {index > 0 && <SelectSeparator />}
              <SelectGroup>
                {group.map((candidate) => (
                  <SelectItem
                    key={candidate}
                    value={candidate}
                    disabled={
                      candidate !== action && outputUnavailable(prepared, candidate) !== null
                    }
                  >
                    {candidate === saved
                      ? t('output.savedTitle', { title: t(`output.${candidate}.title`) })
                      : t(`output.${candidate}.title`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-note`} className="text-xs text-pretty text-muted-foreground">
        {blocked
          ? t(blocked === 'target' ? 'output.needsTarget' : 'output.needsSelection')
          : t(`output.${action}.description`)}
      </p>
    </div>
  );
}
