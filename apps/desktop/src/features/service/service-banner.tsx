import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { useServiceStatus } from './use-service';

/** Panel banner for service connection states (disconnected/connecting/reconnecting). */
export function ServiceBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation('panel');
  const { status } = useServiceStatus();
  if (!window.desktop?.service) return null;
  if (!status || status.state === 'connected') return null;
  return (
    <div className="service-banner" data-state={status.state}>
      <output className="service-banner-text">
        {t(`service.banner.${status.state}`, { detail: status.detail })}
      </output>
      <Button variant="outline" size="sm" onClick={onOpenSettings}>
        {t('service.banner.openSettings')}
      </Button>
    </div>
  );
}
