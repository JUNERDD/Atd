import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { placeAvailable, type CommandPlace } from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { SettingsSwitchRow } from '../settings/settings-switch-row';

/** The places in the order the section lists them: other apps first, then conversations. */
const PLACES: readonly CommandPlace[] = [
  'selectionToolbar',
  'screenshotToolbar',
  'turnSelection',
  'turnActions',
];

/**
 * Where the command is offered beyond the command list, its shortcut and the launcher, as a field
 * of the editor's launch group (`LaunchSettings`). A place offers only a command that can run
 * there (`placeAvailable`): the screenshot toolbar one whose input is a screenshot, every other
 * place one that reads the selection, since it hands the command text that stands in for one.
 * Until it can, a place's switch shows off and stays disabled, with a note saying why. The stored
 * choices stay as they are meanwhile, so changing the input back restores them.
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
  const available = (place: CommandPlace) => placeAvailable(command.input, place);
  const selectionNote = PLACES.some((place) => place !== 'screenshotToolbar' && !available(place));
  const screenshotNote = !available('screenshotToolbar');
  const note = [
    selectionNote && t('placement.unavailable'),
    screenshotNote && t('placement.screenshotUnavailable'),
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="settings-field" data-figma-node="1969:113490">
      <Label id="command-placement-title">{t('placement.title')}</Label>
      <Card size="sm" className="settings-card">
        <ItemGroup
          aria-labelledby="command-placement-title"
          aria-describedby={note ? noteId : undefined}
        >
          {PLACES.map((place) => (
            <SettingsSwitchRow
              key={place}
              id={`command-placement-${place}`}
              title={t(`placement.${place}.title`)}
              description={t(`placement.${place}.description`)}
              checked={available(place) && command.placement[place]}
              disabled={!available(place)}
              onCheckedChange={(checked) =>
                onChange({ ...command, placement: { ...command.placement, [place]: checked } })
              }
            />
          ))}
        </ItemGroup>
      </Card>
      {note && (
        <p id={noteId} className="settings-field-note">
          {note}
        </p>
      )}
    </div>
  );
}
