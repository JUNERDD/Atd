import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WPS_SELECTION_ADDON } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { queryClient } from '../../lib/query-client';
import { AddonCard, AddonCardGroup } from './addon-card';
import { addonKeys, addonsBridge, useAddon } from './use-addons';

function useWpsConnection() {
  const bridge = addonsBridge();
  const { connected, addon } = useAddon(WPS_SELECTION_ADDON);
  const status = useQuery(
    {
      queryKey: [...addonKeys.all, 'wps-selection'],
      queryFn: bridge && connected ? () => bridge.wpsStatus() : skipToken,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const reconnect = useMutation(
    {
      mutationFn: () => {
        if (!bridge) throw new Error('The desktop connection is unavailable.');
        return bridge.reconnectWps();
      },
      meta: { errorToast: false },
      onSettled: () => queryClient.invalidateQueries({ queryKey: addonKeys.all }),
    },
    queryClient,
  );
  const hasStatus = Boolean(
    (addon?.installed || status.data?.error) && (status.data || status.isError),
  );
  const failed = hasStatus && (status.isError || reconnect.isError || Boolean(status.data?.error));
  return {
    failed,
    needsReopen: hasStatus && !failed && !(connected && status.data?.connected),
    disabled: !connected || reconnect.isPending,
    retry: () => reconnect.mutate(),
  };
}

/** Optional WPS sheet adapter; document tables continue to use native Accessibility. */
export function WpsSelectionAddon() {
  const { t } = useTranslation('addons');
  const connection = useWpsConnection();
  const description = connection.failed
    ? t('wps.setupFailed')
    : connection.needsReopen
      ? t('wps.reopen')
      : t('wps.description');
  return (
    <AddonCardGroup label={t('wps.label')}>
      <AddonCard
        id={WPS_SELECTION_ADDON}
        title={t('wps.title')}
        description={
          <span role={connection.failed ? 'alert' : connection.needsReopen ? 'status' : undefined}>
            {description}
          </span>
        }
      >
        {connection.failed && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={connection.disabled}
            onClick={connection.retry}
          >
            {t('actions.tryAgain')}
          </Button>
        )}
      </AddonCard>
    </AddonCardGroup>
  );
}
