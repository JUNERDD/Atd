import { useTranslation } from 'react-i18next';
import { CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import { useDevelopmentSync } from './use-development-sync';

/** Only GeneralSettings in the development renderer mounts this local configuration action. */
export function DevelopmentSyncSettings() {
  const { t } = useTranslation('settings');
  const sync = useDevelopmentSync();
  const status = sync.error && 'status' in sync.error ? sync.error.status : null;
  // A service started without `--development` never mounts the route: the relay denies a route
  // missing from its manifest with 403 before the service could answer 404.
  const failure =
    status === 409
      ? t('developmentSync.busy')
      : status === 403 || status === 404
        ? t('developmentSync.unavailable')
        : t('developmentSync.failed');
  return (
    <section
      className="settings-shortcut-group"
      aria-labelledby="development-sync-heading"
      data-settings-anchor="development-sync"
    >
      <h3 id="development-sync-heading" className="settings-section-title">
        {t('developmentSync.group')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <Item asChild size="sm" className="settings-card-row">
            <li>
              <ItemContent className="min-w-[min(200px,100%)]">
                <ItemTitle>{t('developmentSync.title')}</ItemTitle>
                <ItemDescription className="whitespace-normal" id="development-sync-description">
                  {t('developmentSync.description')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!window.desktop?.service || sync.isPending}
                  aria-busy={sync.isPending}
                  aria-describedby="development-sync-description"
                  onClick={() => {
                    if (!sync.isPending) sync.mutate();
                  }}
                >
                  {sync.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {sync.isPending ? t('developmentSync.syncing') : t('developmentSync.action')}
                </Button>
              </ItemActions>
              {sync.isError && (
                <ItemFooter
                  className="settings-inline-error min-w-0 items-start justify-start"
                  role="alert"
                >
                  <CircleAlert aria-hidden="true" />
                  <span>{failure}</span>
                </ItemFooter>
              )}
              {sync.isSuccess && (
                <ItemFooter className="min-w-0 items-start justify-start">
                  <output className="min-w-0 text-sm wrap-anywhere text-muted-foreground">
                    {t('developmentSync.success', sync.data)}
                    {sync.data.backupDir &&
                      ` ${t('developmentSync.backup', { path: sync.data.backupDir })}`}
                  </output>
                </ItemFooter>
              )}
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </section>
  );
}
