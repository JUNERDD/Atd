import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { SettingsGroup } from '../settings/settings-group';
import { PlacementSettings } from './placement-settings';
import { ShortcutInput } from './shortcut-input';

/**
 * How a command starts beyond the command list and the launcher, as an editor group laid out like
 * the Shortcuts settings: its global shortcut as a row in its own card, then the places that offer
 * it (`PlacementSettings`), a titled card of switches.
 */
export function LaunchSettings({
  command,
  onChange,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
}) {
  const { t } = useTranslation('commands');
  return (
    <SettingsGroup id="command-start" title={t('start.title')} description={t('start.description')}>
      <Card size="sm" className="settings-card">
        <ItemGroup aria-labelledby="command-start-title">
          <ShortcutInput
            value={command.shortcut}
            onChange={(shortcut) => onChange({ ...command, shortcut })}
          />
        </ItemGroup>
      </Card>
      <PlacementSettings command={command} onChange={onChange} />
    </SettingsGroup>
  );
}
