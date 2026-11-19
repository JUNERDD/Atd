import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { showErrorToast } from '../../components/toast-store';
import { useServiceStatus } from './use-service';

/** Panel banner for service connection states (disconnected/connecting/reconnecting). */
export function ServiceBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation('panel');
  const { status } = useServiceStatus();
  const [restarting, setRestarting] = useState(false);

  if (!window.desktop?.service) return null;
  if (!status || status.state === 'connected') return null;

  const isUnavailable = status.state === 'disconnected' || status.state === 'reconnecting';
  const canRestart =
    isUnavailable &&
    Boolean(window.desktop?.diagnostics?.restartService) &&
    status.failureCode !== 'service_not_running';

  function handleDiagnose() {
    void window.desktop?.settings?.openSection('diagnostics').catch(showErrorToast);
  }

  async function handleRestart() {
    const restart = window.desktop?.diagnostics?.restartService;
    if (!restart || restarting) return;
    setRestarting(true);
    try {
      const result = await restart();
      if (!result.ok) showErrorToast(result.summary);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="service-banner flex-wrap" data-state={status.state}>
      <output className="service-banner-text">
        {t(`service.banner.${status.state}`, { detail: status.detail })}
      </output>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {canRestart && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={restarting}
            onClick={() => void handleRestart()}
          >
            {t('service.banner.restartService')}
          </Button>
        )}
        {isUnavailable && (
          <Button type="button" variant="outline" size="sm" onClick={handleDiagnose}>
            {t('service.banner.openDiagnostics')}
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
          {t('service.banner.openSettings')}
        </Button>
      </div>
    </div>
  );
}
