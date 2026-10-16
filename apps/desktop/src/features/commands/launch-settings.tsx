import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { SettingsGroup } from '../settings/settings-group';
import { PlacementSettings } from './placement-settings';
import { ShortcutList } from './shortcut-list';

/** The group's id, which a link to the command's shortcuts scrolls into view. */
export const LAUNCH_GROUP_ID = 'command-start';

/**
 * How a command starts beyond the command list and the launcher, as an editor group laid out like
 * the Shortcuts settings: its global shortcuts as rows in their own card (`ShortcutList`), then
 * the places that offer it (`PlacementSettings`), a titled card of switches.
 */
export function LaunchSettings({
  command,
  onChange,
  shortcuts,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  /** The shortcut list's own wiring: its change, page and problems. */
  shortcuts: Omit<ComponentProps<typeof ShortcutList>, 'command'>;
}) {
  const { t } = useTranslation('commands');
  return (
    <SettingsGroup
      id={LAUNCH_GROUP_ID}
      title={t('start.title')}
      description={t('start.description')}
    >
      <ShortcutList command={command} {...shortcuts} />
      <PlacementSettings command={command} onChange={onChange} />
    </SettingsGroup>
  );
}
