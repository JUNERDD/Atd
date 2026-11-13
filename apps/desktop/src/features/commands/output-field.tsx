import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { actsOnSelection, readsSelection, type CommandOutputAction } from '@atd/agent-contracts';
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
import type { CommandDefinition } from '../../client/agent/command-schema';
import { OUTPUT_ACTION_GROUPS, OUTPUT_ACTIONS } from '../../client/agent/run-output';
import { FOLLOW, FollowItem } from './follow-item';

/**
 * Where a run's answer goes, as a labelled Select of the actions this input can serve: the ones
 * on the selection (`actsOnSelection`) need a command that reads it, so they are left out until
 * it does. Marking the selection (`annotate`) is left out where `offerAnnotate` is false: a
 * shortcut's runs never read text in a screenshot, the only text it marks. With `follow`, the
 * first item (labelled by it) leaves the result to the command and reports `undefined`, as a
 * shortcut that does not override it.
 */
export function OutputField({
  id,
  input,
  value,
  onChange,
  follow,
  describedBy,
  offerAnnotate = true,
}: {
  id: string;
  input: CommandDefinition['input'];
  value: CommandOutputAction | undefined;
  onChange: (action: CommandOutputAction | undefined) => void;
  follow?: string;
  /** Notes about the chosen result, for the trigger's `aria-describedby`. */
  describedBy?: string | undefined;
  /** Whether `annotate` is offered; it still shows while it is `value`. */
  offerAnnotate?: boolean;
}) {
  const { t } = useTranslation('commands');
  const offered = (candidate: CommandOutputAction) =>
    (readsSelection(input) || !actsOnSelection(candidate)) &&
    (candidate !== 'annotate' || offerAnnotate || value === candidate);
  const groups = OUTPUT_ACTION_GROUPS.map((group) => group.filter(offered)).filter(
    (group) => group.length > 0,
  );
  return (
    <div className="settings-field">
      <Label htmlFor={id}>{t('output.title')}</Label>
      <Select
        value={value ?? FOLLOW}
        onValueChange={(next) => {
          if (next === FOLLOW) onChange(undefined);
          const action = OUTPUT_ACTIONS.find((candidate) => candidate === next);
          if (action) onChange(action);
        }}
      >
        <SelectTrigger id={id} className="w-full" aria-describedby={describedBy}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <FollowItem label={follow} />
          {groups.map((group, index) => (
            <Fragment key={group[0]}>
              {index > 0 && <SelectSeparator />}
              <SelectGroup>
                {group.map((candidate) => (
                  <SelectItem key={candidate} value={candidate}>
                    {t(`output.${candidate}.title`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
