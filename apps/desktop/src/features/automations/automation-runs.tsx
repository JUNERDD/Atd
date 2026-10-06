import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, History, Pencil } from 'lucide-react';
import {
  AUTOMATION_RUN_HISTORY,
  type AutomationItem,
  type AutomationRun,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { ItemGroup } from '@atd/ui/components/item';
import { showErrorToast } from '../../components/toast-store';
import { useAgent } from '../agent/use-agent';
import { ExtensionLoadError } from '../service/extension-detail-fields';
import { SettingsHeading } from '../settings/settings-heading';
import { isUnread, runBlockWords, triggerNames, triggerWords } from './automation-words';
import { RunNowButton } from './run-now-button';
import { RunRow } from './run-row';
import { AutomationStatusNotice } from './status-notice';
import { automationsBridge, useAutomationRuns, useAutomations } from './use-automations';

/**
 * One automation's run history, a sub-page of Automations ("Automations › name"): its trigger in
 * words, Edit, Mark all as read and Run now, then its runs newest first. Opening a run's task
 * marks the run read and shows the task in the panel; a finished run whose task is no longer in
 * the task list says its task was deleted instead.
 */
export function AutomationRuns({
  item,
  unavailable,
  onEdit,
  onRun,
}: {
  item: AutomationItem;
  /** The saved automations cannot be read: nothing runs. */
  unavailable: boolean;
  onEdit: () => void;
  onRun: () => void;
}) {
  const { t, i18n } = useTranslation('automations');
  const { automation, status } = item;
  const { runs, error, retry } = useAutomationRuns(automation.id);
  const { automations } = useAutomations();
  const [now] = useState(() => new Date());
  const summary = triggerWords(automation.trigger, triggerNames(automations), t, i18n.language);
  const unread = (runs ?? []).filter(isUnread);
  // The tasks the renderer knows; null until they are read. A run's task keeps existing while it
  // runs (history cannot delete an active task), so only a finished run's can be gone.
  const tasks = useAgent().snapshot?.tasks;
  const known = tasks ? new Set(tasks.map(({ id }) => id)) : null;
  const taskGone = (run: AutomationRun) =>
    Boolean(run.taskId) &&
    run.outcome !== 'running' &&
    known !== null &&
    !known.has(run.taskId ?? '');
  const bridge = () => automationsBridge();
  function open(run: AutomationRun) {
    if (!run.taskId) return;
    if (isUnread(run))
      void bridge()
        .markRead({ runIds: [run.id] })
        .catch(showErrorToast);
    void bridge().showTask(run.taskId).catch(showErrorToast);
  }
  return (
    <section className="automation-runs" aria-label={t('runs.label')}>
      <SettingsHeading
        title={automation.name}
        description={summary}
        subpage
        backLabel={t('runs.back')}
      >
        <Button variant="outline" onClick={onEdit}>
          <Pencil data-icon="inline-start" />
          {t('runs.edit')}
        </Button>
        {unread.length > 0 && (
          <Button
            variant="outline"
            onClick={() =>
              void bridge()
                .markRead({ runIds: unread.map(({ id }) => id).slice(0, AUTOMATION_RUN_HISTORY) })
                .catch(showErrorToast)
            }
          >
            <CheckCheck data-icon="inline-start" />
            {t('runs.markAllRead')}
          </Button>
        )}
        <RunNowButton
          label={t('list.run')}
          reason={runBlockWords(status, unavailable, t)}
          onRun={onRun}
        />
      </SettingsHeading>
      <div className="automation-runs-body">
        <AutomationStatusNotice status={status} />
        {runs === null ? (
          error ? (
            <ExtensionLoadError message={error} onRetry={retry} />
          ) : (
            <output className="settings-field-note">{t('runs.loading')}</output>
          )
        ) : runs.length ? (
          <>
            <Card size="sm" className="settings-card">
              <ItemGroup aria-label={t('runs.label')}>
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    now={now}
                    taskGone={taskGone(run)}
                    onOpen={() => open(run)}
                  />
                ))}
              </ItemGroup>
            </Card>
            <p className="settings-field-note">
              {t('runs.historyNote', { count: AUTOMATION_RUN_HISTORY })}
            </p>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyTitle>{t('runs.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('runs.emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}
