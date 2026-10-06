import { useTranslation } from 'react-i18next';
import type { AutomationDelivery, AutomationNotify } from '@atd/agent-contracts';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { SettingsSwitchRow } from '../settings/settings-switch-row';

const NOTIFY: readonly AutomationNotify[] = ['whenNew', 'always', 'never'];

/**
 * "Results": when a finished run posts a notification (runs that fail or need the person always
 * do), and whether each run sees the previous result, so it can report only what changed.
 */
export function DeliveryFields({
  delivery,
  onChange,
}: {
  delivery: AutomationDelivery;
  onChange: (delivery: AutomationDelivery) => void;
}) {
  const { t } = useTranslation('automations');
  return (
    <section className="settings-field" aria-labelledby="automation-delivery-title">
      <h3 id="automation-delivery-title" className="settings-section-title">
        {t('delivery.title')}
      </h3>
      <div className="run-settings">
        <div className="field-columns automation-single-column">
          <div className="settings-field">
            <Label htmlFor="automation-notify">{t('delivery.notify')}</Label>
            <Select
              value={delivery.notify}
              onValueChange={(value) => {
                const notify = NOTIFY.find((item) => item === value);
                if (notify) onChange({ ...delivery, notify });
              }}
            >
              <SelectTrigger
                id="automation-notify"
                className="w-full"
                aria-describedby="automation-notify-note"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTIFY.map((notify) => (
                  <SelectItem key={notify} value={notify}>
                    {t(`delivery.options.${notify}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p id="automation-notify-note" className="settings-field-note">
          {t(`delivery.notes.${delivery.notify}`)}
        </p>
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="automation-previous"
              title={t('delivery.previous')}
              description={t('delivery.previousDescription')}
              checked={delivery.includePreviousResult}
              onCheckedChange={(includePreviousResult) =>
                onChange({ ...delivery, includePreviousResult })
              }
            />
          </ItemGroup>
        </Card>
      </div>
    </section>
  );
}
