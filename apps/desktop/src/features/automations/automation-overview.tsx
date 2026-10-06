import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Plus, Zap } from 'lucide-react';
import type { AutomationItem } from '@atd/agent-contracts';
import { Alert, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { ItemGroup } from '@atd/ui/components/item';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import { showErrorToast } from '../../components/toast-store';
import { ExtensionLoadError } from '../service/extension-detail-fields';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsSectionExit } from '../settings/settings-navigation';
import { SettingsSearchField } from '../settings/settings-search-field';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { needsNewTime } from './automation-draft';
import { AutomationList } from './automation-list';
import { triggerNames } from './automation-words';
import { useAutomationSwitches } from './use-automation-switches';
import { automationsBridge, type useAutomations } from './use-automations';

/**
 * The Automations overview: the heading with search and New automation, the global pause, and
 * the list, or its loading, failed, empty, no-match or unreadable-store state.
 */
export function AutomationOverview({
  list,
  onCreate,
  onOpen,
  onRuns,
  onRun,
  onReschedule,
  onDuplicate,
}: {
  list: ReturnType<typeof useAutomations>;
  onCreate: () => void;
  onOpen: (item: AutomationItem) => void;
  onRuns: (item: AutomationItem) => void;
  onRun: (item: AutomationItem) => void;
  /** Turning on a one-time automation whose time has passed: its editor, for a new time. */
  onReschedule: (item: AutomationItem) => void;
  onDuplicate: (item: AutomationItem) => void;
}) {
  const { t } = useTranslation('automations');
  const { automations, paused, problem, error, retry } = list;
  const search = useCompositionQuery();
  const searchInput = useRef<HTMLInputElement>(null);
  useSettingsSectionExit(() => search.change(''));
  const [deleting, setDeleting] = useState<AutomationItem | null>(null);
  const { toggle, pending, pause } = useAutomationSwitches(t);
  const create = (
    <Button disabled={!automations} onClick={onCreate}>
      <Plus />
      {t('list.new')}
    </Button>
  );
  return (
    <section className="automation-settings">
      <SettingsHeading title={t('list.title')} description={t('list.description')}>
        <SettingsSearchField
          search={search}
          ref={searchInput}
          aria-label={t('list.searchLabel')}
          placeholder={t('list.searchPlaceholder')}
          disabled={!automations?.length}
        />
        {create}
      </SettingsHeading>
      {problem !== null && (
        <Alert variant="destructive" className="automation-store-problem">
          <CircleAlert />
          <AlertTitle>{t('list.storeProblemTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('list.storeProblem')}</p>
            <p className="automation-problem-detail font-mono">{problem}</p>
          </AlertDescription>
        </Alert>
      )}
      {automations !== null && (automations.length > 0 || paused) && (
        <Card size="sm" className="settings-card automation-pause-card">
          <ItemGroup>
            <SettingsSwitchRow
              id="automation-pause"
              title={t('list.pause')}
              description={t('list.pauseDescription')}
              checked={paused}
              pending={pause.isPending}
              disabled={problem !== null}
              onCheckedChange={(next) => pause.mutate(next)}
            />
          </ItemGroup>
        </Card>
      )}
      {automations === null ? (
        error ? (
          <ExtensionLoadError message={error} onRetry={retry} />
        ) : (
          <output className="settings-loading">{t('list.loading')}</output>
        )
      ) : automations.length ? (
        <AutomationList
          automations={automations}
          query={search.query}
          pendingIds={pending}
          paused={paused}
          unavailable={problem !== null}
          names={triggerNames(automations)}
          onClearSearch={() => {
            search.change('');
            searchInput.current?.focus();
          }}
          onOpen={onOpen}
          onToggle={(item, enabled) =>
            // The service refuses a one-time time that has passed; the editor asks for a new one.
            enabled && needsNewTime(item.automation)
              ? onReschedule(item)
              : toggle(item.automation.id, enabled)
          }
          onRun={onRun}
          onRuns={onRuns}
          onDuplicate={onDuplicate}
          onDelete={setDeleting}
        />
      ) : (
        <div className="settings-extension-empty">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Zap />
              </EmptyMedia>
              <EmptyTitle>{t('list.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('list.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>{create}</EmptyContent>
          </Empty>
        </div>
      )}
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('list.deleteTitle', { name: deleting?.automation.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('list.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('list.cancel')}</AlertDialogCancel>
            {/* The row leaving the list confirms the deletion; only a failure needs a message. */}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting)
                  void automationsBridge()
                    .remove(deleting.automation.id)
                    .catch((reason: unknown) => showErrorToast(reason));
              }}
            >
              {t('list.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
