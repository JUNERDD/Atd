import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Settings, Stethoscope } from 'lucide-react';
import { BarAction } from '../../components/bar-action';
import { useOneLineActions } from '../../components/one-line-actions';
import { showErrorToast } from '../../components/toast-store';
import { useServiceStatus } from './use-service';

/**
 * Panel banner for service connection states (disconnected/connecting/reconnecting): the state on
 * one line, then its actions, Restart service last. Short of room, the state truncates down to the
 * room it keeps (`.service-banner-text`), then the actions show their icons alone, the leading
 * ones first (`useOneLineActions`).
 */
export function ServiceBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { t } = useTranslation('panel');
  const { status } = useServiceStatus();
  const [restarting, setRestarting] = useState(false);
  const bannerRef = useOneLineActions<HTMLDivElement>();

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
    <div ref={bannerRef} className="service-banner" data-state={status.state}>
      <output className="service-banner-text">
        {t(`service.banner.${status.state}`, { detail: status.detail })}
      </output>
      <div className="flex shrink-0 items-center gap-1.5">
        {isUnavailable && (
          <BarAction
            type="button"
            variant="outline"
            size="sm"
            icon={<Stethoscope data-icon="inline-start" />}
            iconAtRest={false}
            label={t('service.banner.openDiagnostics')}
            onClick={handleDiagnose}
          />
        )}
        <BarAction
          type="button"
          variant="outline"
          size="sm"
          icon={<Settings data-icon="inline-start" />}
          iconAtRest={false}
          label={t('service.banner.openSettings')}
          onClick={onOpenSettings}
        />
        {canRestart && (
          <BarAction
            type="button"
            variant="secondary"
            size="sm"
            disabled={restarting}
            icon={<RotateCw data-icon="inline-start" />}
            iconAtRest={false}
            label={t('service.banner.restartService')}
            onClick={() => void handleRestart()}
          />
        )}
      </div>
    </div>
  );
}
