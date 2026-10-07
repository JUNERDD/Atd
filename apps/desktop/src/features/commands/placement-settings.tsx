import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { readsSelection, type CommandPlace } from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { SettingsSwitchRow } from '../settings/settings-switch-row';

/** The places in the order the section lists them: other apps first, then conversations. */
const PLACES: readonly CommandPlace[] = ['selectionToolbar', 'turnSelection', 'turnActions'];

/**
 * Where the command is offered beyond the command list, its shortcut and the launcher, as a field
 * of the editor's "How it starts" group. Every place hands the command text that stands in for a selection, so a place
 * offers only a command that reads the selection (`offeredAt`): until it does, the switches show
 * off and stay disabled, with a note saying why. The stored choices stay as they are meanwhile, so
 * reading the selection again restores them.
 */
export function PlacementSettings({
  command,
  onChange,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
}) {
  const { t } = useTranslation('commands');
  const noteId = useId();
  const available = readsSelection(command.input);
  return (
    <div className="settings-field" data-figma-node="1969:113490">
      <Label id="command-placement-title">{t('placement.title')}</Label>
      <Card size="sm" className="settings-card">
        <ItemGroup
          aria-labelledby="command-placement-title"
          aria-describedby={available ? undefined : noteId}
        >
          {PLACES.map((place) => (
            <SettingsSwitchRow
              key={place}
              id={`command-placement-${place}`}
              title={t(`placement.${place}.title`)}
              description={t(`placement.${place}.description`)}
              checked={available && command.placement[place]}
              disabled={!available}
              onCheckedChange={(checked) =>
                onChange({ ...command, placement: { ...command.placement, [place]: checked } })
              }
            />
          ))}
        </ItemGroup>
      </Card>
      {!available && (
        <p id={noteId} className="settings-field-note">
          {t('placement.unavailable')}
        </p>
      )}
    </div>
  );
}
