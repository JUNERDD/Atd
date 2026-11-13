import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { SaveLocationRow } from './save-location-row';

/** General › Screen recording: the local save folder or ask-each-time preference. */
export function RecordingSettings() {
  const { t } = useTranslation('settings');
  if (!window.desktop?.saveLocation) return null;

  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-recording-group">
      <h3 id="settings-recording-group" className="settings-section-title">
        {t('recording.title')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SaveLocationRow
            kind="recording"
            anchor="settings-recording-save-location"
            label={t('saveLocation.label')}
            description={t('recording.saveLocation.description')}
            saveFailedMessage={t('recording.saveLocation.saveFailed')}
          />
        </ItemGroup>
      </Card>
    </section>
  );
}
