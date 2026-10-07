import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSummary } from '@atd/agent-contracts';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { useSettingsSubpage } from '../settings/settings-navigation';
import { AppDataSection } from './app-data';
import { AppDetailHero } from './app-detail-hero';
import { RenameAppDialog } from './app-dialogs';
import { AppPermissionsSection } from './app-grants';
import { AppVersionsSection } from './app-versions';
import { AppWidgetsSection } from './app-widgets';
import type { AppActions } from './use-app-actions';
import type { useAppConfirmations } from './use-app-confirmations';
import { useAppIntent } from './use-app-intent';
import { appsBridge, useAppDetail, useAppVersions } from './use-apps';
import './apps.css';

/**
 * One app's page in Settings, a sub-page of Apps ("Apps › name" in the header's breadcrumb):
 * the app's identity with Open, Continue editing and More (Rename, Delete), then its versions
 * with Revert, the widgets it declares, its permissions, and last, apart, its data (Clear data,
 * Delete app). The whole page scrolls as one, so nothing important sits at the window's bottom
 * edge. The control that started a write shows it in place (`useAppIntent`). Every group reloads
 * on the `apps` invalidation, so a build or a consent answered elsewhere shows here at once.
 */
export function AppDetailPage({
  app,
  actions,
  confirmations,
}: {
  /** The app as the list has it, shown while its details load. */
  app: AppSummary;
  actions: AppActions;
  confirmations: ReturnType<typeof useAppConfirmations>;
}) {
  const { t } = useTranslation('apps');
  const { detail, error, retry } = useAppDetail(app.id);
  const versions = useAppVersions(app.id);
  const busy = actions.busy.has(app.id);
  const { pending, start } = useAppIntent(busy);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const name = detail?.name ?? app.name;
  const current = detail?.currentVersion ?? app.currentVersion;
  const named = { id: app.id, name };
  useSettingsSubpage({ title: name, backLabel: t('detail.back') });

  return (
    <section className="app-detail" aria-label={t('detail.label')}>
      <ScrollArea className="settings-page-scroll" gutter="none" scrollShadow>
        <div className="app-detail-body">
          <AppDetailHero
            app={app}
            detail={detail}
            busy={busy}
            pending={pending}
            onOpen={() => start('open', () => void actions.open(app.id))}
            onEdit={() =>
              start('edit', () => {
                void actions.edit(app.id).then((taskId) => {
                  if (taskId) void appsBridge().showTask(taskId);
                });
              })
            }
            onRename={() => setRenaming(named)}
            onDelete={() => start('delete', () => confirmations.confirmDelete(named))}
          />
          <AppVersionsSection
            versions={versions.versions}
            error={versions.error}
            onRetry={versions.retry}
            current={current}
            busy={busy}
            pending={pending}
            onRevert={(version) =>
              start(`revert:${version}`, () => confirmations.confirmRevert(named, version))
            }
          />
          {detail && detail.widgets.length > 0 && (
            <AppWidgetsSection
              appId={app.id}
              appName={name}
              revision={detail.revision}
              widgets={detail.widgets}
            />
          )}
          <AppPermissionsSection
            detail={detail}
            error={error}
            onRetry={retry}
            busy={busy}
            pending={pending}
            onChange={(capability, state) =>
              start(`grant:${capability}`, () => void actions.setGrant(app.id, capability, state))
            }
          />
          <AppDataSection
            busy={busy}
            pending={pending}
            onClear={() => start('clear', () => confirmations.confirmClearData(named))}
            onDelete={() => start('delete', () => confirmations.confirmDelete(named))}
          />
        </div>
      </ScrollArea>
      <RenameAppDialog app={renaming} onClose={() => setRenaming(null)} onSave={actions.rename} />
    </section>
  );
}
