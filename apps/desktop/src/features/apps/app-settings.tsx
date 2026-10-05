import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showErrorToast } from '../../components/toast-store';
import type { AppSummary } from '@atd/agent-contracts';
import { Sparkles } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { ExtensionDetailStatus } from '../service/extension-detail-fields';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { SettingsSearchField } from '../settings/settings-search-field';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import { AppConfirmDialog } from './app-dialogs';
import { AppDetailPage } from './app-detail-page';
import { AppSettingsList } from './app-settings-list';
import { useAppActions } from './use-app-actions';
import { useAppConfirmations } from './use-app-confirmations';
import { useApps } from './use-apps';
import './apps.css';

/** A page of the Apps section: the list, or one app's page. */
type AppRoute = { page: 'list' } | { page: 'app'; app: AppSummary };
const LIST: AppRoute = { page: 'list' };

/**
 * The app another window asked this one to show (`AppsBridge.showInSettings`). The section
 * subscribes while it is shown, so a request made before (a new window opening at the section)
 * arrives as it subscribes.
 */
function useSettingsTarget() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => window.desktop?.apps?.onShowInSettings(setTarget), []);
  return [target, () => setTarget(null)] as const;
}

/**
 * The Apps section: every app the agent built, and each app's page with its permissions,
 * versions and data. Pages follow the section's history (the header's Back and Forward); an app
 * deleted while its page is shown, here or elsewhere, leaves the page.
 */
export function AppSettings() {
  const { t } = useTranslation('apps');
  const { apps, error, retry } = useApps();
  const actions = useAppActions();
  const history = useSettingsPageHistory<AppRoute>(
    LIST,
    (route) => route.page === 'list' || !apps || apps.some(({ id }) => id === route.app.id),
  );
  const confirmations = useAppConfirmations(actions);
  const search = useCompositionQuery();
  const searchInput = useRef<HTMLInputElement>(null);
  useSettingsSectionExit(() => search.change(''));
  const [target, clearTarget] = useSettingsTarget();
  if (target && apps) {
    clearTarget();
    const app = apps.find(({ id }) => id === target);
    if (app) history.reset({ page: 'app', app });
  }
  const { route } = history;
  // The app as the latest list has it; one deleted meanwhile leaves its page.
  const shown = route.page === 'app' ? apps?.find(({ id }) => id === route.app.id) : undefined;
  if (route.page === 'app' && apps && !shown) history.discard();

  return (
    <section className="app-settings">
      {route.page === 'app' ? (
        <AppDetailPage
          key={route.app.id}
          app={shown ?? route.app}
          actions={actions}
          confirmations={confirmations}
        />
      ) : (
        <>
          <SettingsHeading title={t('settings.title')} description={t('settings.description')}>
            <SettingsSearchField
              search={search}
              ref={searchInput}
              aria-label={t('settings.searchLabel')}
              placeholder={t('settings.searchPlaceholder')}
              disabled={!apps?.length}
            />
            <Button
              variant="outline"
              disabled={!window.desktop?.apps}
              onClick={() => void window.desktop?.apps?.createInPanel().catch(showErrorToast)}
            >
              <Sparkles data-icon="inline-start" />
              {t('panel.create')}
            </Button>
          </SettingsHeading>
          <ScrollArea
            className="app-settings-scroll settings-page-scroll"
            viewportClassName="[&>div]:flex! [&>div]:flex-col [&>div]:min-h-full"
            gutter="none"
            scrollShadow
          >
            <div className="app-settings-list">
              {apps ? (
                <AppSettingsList
                  apps={apps}
                  query={search.query}
                  actions={actions}
                  onShow={(app) => history.open({ page: 'app', app })}
                  onClearSearch={() => {
                    search.change('');
                    searchInput.current?.focus();
                  }}
                />
              ) : (
                <ExtensionDetailStatus
                  text={error ?? t('panel.loading')}
                  error={error !== null}
                  onRetry={retry}
                />
              )}
            </div>
          </ScrollArea>
        </>
      )}
      <AppConfirmDialog confirmation={confirmations.confirmation} onClose={confirmations.close} />
    </section>
  );
}
