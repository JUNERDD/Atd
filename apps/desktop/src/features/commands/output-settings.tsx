import { Fragment, useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  actsOnSelection,
  readsSelection,
  writesBack,
  type CommandOutputAction,
} from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
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
import { SettingsGroup } from '../settings/settings-group';
import { SettingsSwitchRow } from '../settings/settings-switch-row';

/**
 * The actions as the menu groups them, divided by separators: the conversation, the write-backs
 * into the app the command ran from, then the clipboard.
 */
const ACTION_GROUPS: readonly (readonly CommandOutputAction[])[] = [
  ['panel'],
  ['replaceSelection', 'insertAfterSelection', 'insertAtCursor'],
  ['copy'],
];
const ACTIONS = ACTION_GROUPS.flat();

/**
 * What happens with the answer once a run completes, as an editor group laid out like the other
 * settings lists: one card whose first row picks the action from a pop-up beside a description of
 * the chosen one, and, for the write-back actions, a second row that holds the answer for review.
 * What every write-back shares (it writes only for a launch from another app) is said once under
 * the card. The selection actions need a command that reads the selection (`actsOnSelection`):
 * until it does they stay disabled in the menu with a note saying why, and the editor resets an
 * output that acted on the selection when the input stops reading it.
 */
export function OutputSettings({
  command,
  onChange,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
}) {
  const { t } = useTranslation('commands');
  const ids = useId();
  const { action, review } = command.output;
  const selectionAvailable = readsSelection(command.input);
  const writeBack = writesBack(action);
  const notes = [writeBack && `${ids}-write-back`, !selectionAvailable && `${ids}-unavailable`];
  return (
    <SettingsGroup
      id="command-output"
      title={t('output.title')}
      description={t('output.description')}
    >
      <div className="settings-field">
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <Item asChild size="sm" className="settings-card-row">
              <li>
                {/* Wide enough that the pop-up wraps below a long description in a narrow column. */}
                <ItemContent className="min-w-[min(200px,100%)]">
                  <ItemTitle id={`${ids}-title`} className="whitespace-normal">
                    {t('output.action')}
                  </ItemTitle>
                  <ItemDescription id={`${ids}-description`} className="whitespace-normal">
                    {t(`output.${action}.description`)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto flex-wrap justify-end">
                  <Select
                    value={action}
                    onValueChange={(value) => {
                      const next = ACTIONS.find((candidate) => candidate === value);
                      if (next)
                        onChange({ ...command, output: { ...command.output, action: next } });
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-labelledby={`${ids}-title`}
                      aria-describedby={[`${ids}-description`, ...notes].filter(Boolean).join(' ')}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_GROUPS.map((group, index) => (
                        <Fragment key={group[0]}>
                          {index > 0 && <SelectSeparator />}
                          <SelectGroup>
                            {group.map((candidate) => (
                              <SelectItem
                                key={candidate}
                                value={candidate}
                                disabled={actsOnSelection(candidate) && !selectionAvailable}
                              >
                                {t(`output.${candidate}.title`)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </Fragment>
                      ))}
                    </SelectContent>
                  </Select>
                </ItemActions>
              </li>
            </Item>
            {writeBack && (
              <SettingsSwitchRow
                id="command-output-review"
                title={t('output.review.title')}
                description={t('output.review.description')}
                checked={review}
                onCheckedChange={(checked) =>
                  onChange({ ...command, output: { ...command.output, review: checked } })
                }
              />
            )}
          </ItemGroup>
        </Card>
        {writeBack && (
          <p id={`${ids}-write-back`} className="settings-field-note">
            {t('output.writeBackNote')}
          </p>
        )}
        {!selectionAvailable && (
          <p id={`${ids}-unavailable`} className="settings-field-note">
            {t('output.unavailable')}
          </p>
        )}
      </div>
    </SettingsGroup>
  );
}
