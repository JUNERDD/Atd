import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ConversationSettings } from './conversation-settings';
import { SettingsHeading } from './settings-heading';

/** Preferences for the agent's conversation behavior, separate from the app's General settings. */
export function AgentSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  return (
    <>
      <SettingsHeading title={t('agent.title')} description={t('agent.description')} />
      <div className="settings-shortcut-groups">
        <ConversationSettings snapshot={snapshot} />
      </div>
    </>
  );
}
