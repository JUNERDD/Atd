import { skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WPS_SELECTION_ADDON } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { ItemDescription } from '@atd/ui/components/item';
import { queryClient } from '../../lib/query-client';
import { AddonCard, AddonCardGroup } from './addon-card';
import { addonKeys, addonsBridge, useAddon } from './use-addons';

function WpsConnection() {
  const { t } = useTranslation('addons');
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
  if ((!addon?.installed && !status.data?.error) || (!status.data && !status.isError)) return null;
  const failed = status.isError || reconnect.isError || Boolean(status.data?.error);
  return (
    <>
      <ItemDescription className="whitespace-normal" role={failed ? 'alert' : 'status'}>
        {failed
          ? t('wps.setupFailed')
          : connected && status.data?.connected
            ? t('wps.connected')
            : t('wps.reopen')}
      </ItemDescription>
      {failed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={!connected || reconnect.isPending}
          onClick={() => reconnect.mutate()}
        >
          {t('actions.tryAgain')}
        </Button>
      )}
    </>
  );
}

/** Optional WPS sheet adapter; document tables continue to use native Accessibility. */
export function WpsSelectionAddon() {
  const { t } = useTranslation('addons');
  return (
    <AddonCardGroup label={t('wps.label')}>
      <AddonCard
        id={WPS_SELECTION_ADDON}
        icon={<Table2 />}
        title={t('wps.title')}
        description={t('wps.description')}
      >
        <WpsConnection />
      </AddonCard>
    </AddonCardGroup>
  );
}
