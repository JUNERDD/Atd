import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutomationItem, AutomationTrigger, FolderRef } from '@atd/agent-contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atd/ui/components/tabs';
import { FieldError } from '../commands/field-error';
import { defaultTrigger, type DraftPatch, type TriggerKind } from './automation-draft';
import { formatDateTime, systemTimeZone, zoneName } from './automation-time';
import { problemWords } from './automation-words';
import { ChainTriggerFields } from './chain-trigger-fields';
import { FolderTriggerFields } from './folder-trigger-fields';
import { TriggerIcon } from './run-outcome';
import { ScheduleFields } from './schedule-fields';
import type { AutomationProblemsView } from './use-automation-problems';
import type { TriggerPreview } from './use-automations';

const TRIGGER_KINDS: readonly TriggerKind[] = ['schedule', 'folder', 'automation'];

/** Where the trigger's preview problem shows; Save scrolls to it when the service refuses one. */
export const TRIGGER_ERROR_ID = 'automation-trigger-error';

/**
 * The service's word on the edited trigger: why it cannot run, or a schedule's next run times in
 * the schedule's own zone (named when it is not the Mac's). The service owns the one schedule
 * implementation, so nothing here works out when a schedule fires.
 */
function TriggerOutlook({
  trigger,
  preview,
}: {
  trigger: AutomationTrigger;
  preview: TriggerPreview;
}) {
  const { t, i18n } = useTranslation('automations');
  const result = preview.preview;
  if (preview.error)
    return (
      <p className="settings-field-note">{t('trigger.previewError', { message: preview.error })}</p>
    );
  if (!result) return null;
  if (result.problem)
    return <FieldError id={TRIGGER_ERROR_ID}>{problemWords(result.problem, t)}</FieldError>;
  if (trigger.kind !== 'schedule') return null;
  const zone =
    trigger.timezone === systemTimeZone() ? null : zoneName(trigger.timezone, i18n.language);
  return (
    <div className="automation-next-runs" aria-busy={preview.pending || undefined}>
      <p className="automation-next-runs-title">
        {zone ? t('trigger.nextRunsIn', { zone }) : t('trigger.nextRuns')}
      </p>
      {result.nextRuns.length ? (
        <ul>
          {result.nextRuns.map((run) => (
            <li key={run}>
              <time dateTime={run}>{formatDateTime(run, i18n.language, trigger.timezone)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-field-note">{t('trigger.noNextRuns')}</p>
      )}
    </div>
  );
}

/**
 * "When it runs": a schedule, changes in a watched folder, or another automation's results, as
 * tabs over the fields of each. Switching kind keeps what the other kinds held, so switching back
 * restores it.
 */
export function TriggerFields({
  trigger,
  onChange,
  patch,
  automationId,
  automations,
  folderName,
  onFoldersPicked,
  problems,
  preview,
}: {
  trigger: AutomationTrigger;
  onChange: (trigger: AutomationTrigger) => void;
  /** For a folder pick, which lands after other edits. */
  patch: DraftPatch;
  /** The edited automation, which a chain may not follow; null for a new one. */
  automationId: string | null;
  automations: readonly AutomationItem[] | null;
  /** A folder's name; undefined once it is no longer registered. */
  folderName: (folderId: string) => string | undefined;
  onFoldersPicked: (folders: readonly FolderRef[]) => void;
  problems: AutomationProblemsView;
  preview: TriggerPreview;
}) {
  const { t } = useTranslation('automations');
  const [kept, setKept] = useState<Partial<Record<TriggerKind, AutomationTrigger>>>({});
  function switchKind(value: string) {
    const kind = TRIGGER_KINDS.find((item) => item === value);
    if (!kind || kind === trigger.kind) return;
    setKept((current) => ({ ...current, [trigger.kind]: trigger }));
    onChange(kept[kind] ?? defaultTrigger(kind));
  }
  return (
    <section className="settings-field" aria-labelledby="automation-trigger-title">
      <h3 id="automation-trigger-title" className="settings-section-title">
        {t('trigger.title')}
      </h3>
      <Tabs value={trigger.kind} onValueChange={switchKind}>
        <TabsList
          aria-label={t('trigger.kindLabel')}
          className="max-w-full justify-start overflow-x-auto overflow-y-hidden"
        >
          {TRIGGER_KINDS.map((kind) => (
            <TabsTrigger key={kind} value={kind} className="flex-none px-2.5">
              <TriggerIcon kind={kind} />
              {t(`trigger.kinds.${kind}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={trigger.kind} className="automation-tab-panel">
          {trigger.kind === 'schedule' ? (
            <ScheduleFields trigger={trigger} onChange={onChange} problems={problems} />
          ) : trigger.kind === 'folder' ? (
            <FolderTriggerFields
              trigger={trigger}
              onChange={onChange}
              patch={patch}
              folderName={trigger.folderId ? folderName(trigger.folderId) : undefined}
              onFoldersPicked={onFoldersPicked}
              problems={problems}
            />
          ) : (
            <ChainTriggerFields
              trigger={trigger}
              onChange={onChange}
              automationId={automationId}
              automations={automations}
              problems={problems}
            />
          )}
        </TabsContent>
      </Tabs>
      <TriggerOutlook trigger={trigger} preview={preview} />
    </section>
  );
}
