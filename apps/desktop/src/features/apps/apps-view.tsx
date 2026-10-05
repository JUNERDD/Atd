import { useState } from 'react';
import { AppWindow, Ellipsis, History, Pencil, Sparkles, SquarePen, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppSummary } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { IconButton } from '../../components/icon-button';
import { rowDate } from '../agent/history-view';
import { ListCardGrid } from '../../components/list-card';
import { AppConfirmDialog, RenameAppDialog } from './app-dialogs';
import { AppListCard } from './app-list-card';
import { useAppActions } from './use-app-actions';
import { useAppConfirmations } from './use-app-confirmations';
import { useApps } from './use-apps';

/**
 * The panel's My apps view: every app the agent built, most recently updated first, as cards like
 * Settings' (`ListCardGrid`), each with Open, Continue editing (the conversation that builds the
 * app) and More (Figma `App / App actions menu`: Rename, Versions in Settings, Delete). An empty
 * list offers Create app, which starts the same seeded conversation as the new-task entry.
 */
export function AppsView({
  onCreate,
  onOpenTask,
}: {
  onCreate: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const { t, i18n } = useTranslation('apps');
  const { apps, error, retry } = useApps();
  const actions = useAppActions();
  const confirmations = useAppConfirmations(actions);
  const [renaming, setRenaming] = useState<AppSummary | null>(null);
  // Cards are dated against when the view opened, so they hold still while it is browsed.
  const [now] = useState(() => new Date());
  return (
    <section className="panel-content task-history" aria-label={t('panel.label')}>
      <ScrollArea className="apps-view-scroll min-h-0 flex-1" gutter="none" scrollShadow>
        <div className="apps-view-body">
          {apps?.length ? (
            <ListCardGrid className="apps-view-grid">
              {apps.map((app) => {
                const busy = actions.busy.has(app.id);
                const date = rowDate(new Date(app.updatedAt), now, i18n.language, false);
                return (
                  <AppListCard
                    key={app.id}
                    app={app}
                    actions={actions}
                    meta={t('panel.rowMeta', { date, version: app.currentVersion })}
                  >
                    <IconButton
                      label={t('panel.edit')}
                      aria-label={t('panel.editLabel', { name: app.name })}
                      aria-disabled={busy || undefined}
                      onClick={() => {
                        if (busy) return;
                        void actions.edit(app.id).then((taskId) => {
                          if (taskId) onOpenTask(taskId);
                        });
                      }}
                    >
                      <SquarePen />
                    </IconButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={t('panel.more')}
                          aria-label={t('panel.moreLabel', { name: app.name })}
                          tooltipDismissOnClick
                        >
                          <Ellipsis />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenaming(app)}>
                          <Pencil />
                          {t('panel.rename')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void actions.showInSettings(app.id)}>
                          <History />
                          {t('panel.versions')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy}
                          onSelect={() => confirmations.confirmDelete(app)}
                        >
                          <Trash2 />
                          {t('panel.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </AppListCard>
                );
              })}
            </ListCardGrid>
          ) : (
            <Empty className="px-4 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <AppWindow />
                </EmptyMedia>
                <EmptyTitle className="text-base">
                  {error ? t('panel.loadError') : apps ? t('panel.empty') : t('panel.loading')}
                </EmptyTitle>
                {(error || apps) && (
                  <EmptyDescription>{error ?? t('panel.emptyDescription')}</EmptyDescription>
                )}
              </EmptyHeader>
              {(error || apps) && (
                <EmptyContent>
                  {error ? (
                    <Button variant="outline" onClick={retry}>
                      {t('panel.retry')}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={onCreate}>
                      <Sparkles data-icon="inline-start" />
                      {t('panel.create')}
                    </Button>
                  )}
                </EmptyContent>
              )}
            </Empty>
          )}
        </div>
      </ScrollArea>
      <RenameAppDialog app={renaming} onClose={() => setRenaming(null)} onSave={actions.rename} />
      <AppConfirmDialog confirmation={confirmations.confirmation} onClose={confirmations.close} />
    </section>
  );
}
