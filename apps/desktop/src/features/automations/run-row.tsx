import { useTranslation } from 'react-i18next';
import { SquareArrowOutUpRight } from 'lucide-react';
import type { AutomationRun } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { formatDuration, formatWhen } from './automation-time';
import { isUnread, outcomeTone, outcomeWords, reasonWords } from './automation-words';
import { OutcomeIcon } from './run-outcome';

/**
 * One run of an automation: its outcome (with New until its result is opened, and Late for a
 * catch-up run), the opening of its answer, why it was skipped or failed, and when and how long
 * it ran, scheduled against actual time. Open task shows its task in the panel, which marks it
 * read; a task deleted since says so instead. Summaries, details and file names are runtime text
 * and stay as the run wrote them.
 */
export function RunRow({
  run,
  now,
  taskGone,
  onOpen,
}: {
  run: AutomationRun;
  /** When the history opened, which its dates read against. */
  now: Date;
  /** The run's task was deleted: the row says so in place of Open task. */
  taskGone: boolean;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation('automations');
  const language = i18n.language;
  const started = formatWhen(run.firedAt, now, language);
  const meta = [t(`source.${run.source}`)];
  if (run.scheduledFor && run.scheduledFor !== run.firedAt)
    meta.push(t('runs.scheduled', { time: formatWhen(run.scheduledFor, now, language) }));
  meta.push(t('runs.started', { time: started }));
  if (run.finishedAt) {
    const took = Date.parse(run.finishedAt) - Date.parse(run.firedAt);
    if (Number.isFinite(took))
      meta.push(t('runs.took', { duration: formatDuration(took, language) }));
  }
  if (run.declined) meta.push(t('runs.declined', { count: run.declined }));
  return (
    <Item
      asChild
      size="sm"
      className="settings-card-row automation-run-row"
      data-tone={outcomeTone(run.outcome) ?? undefined}
    >
      <li>
        <ItemMedia variant="icon" className="automation-run-icon">
          <OutcomeIcon outcome={run.outcome} />
        </ItemMedia>
        <ItemContent className="min-w-[min(160px,100%)]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <ItemTitle>{outcomeWords(run.outcome, t)}</ItemTitle>
            {run.late && <Badge variant="outline">{t('runs.late')}</Badge>}
            {isUnread(run) && <Badge>{t('runs.new')}</Badge>}
          </div>
          {run.summary && (
            <ItemDescription className="line-clamp-2 whitespace-normal">
              {run.summary}
            </ItemDescription>
          )}
          {run.reason && (
            <p className="automation-run-reason">
              {reasonWords(run.reason, t)}
              {run.detail && (
                <span className="automation-problem-detail font-mono"> {run.detail}</span>
              )}
            </p>
          )}
          {run.files?.length ? (
            <p className="automation-run-meta line-clamp-1" title={run.files.join('\n')}>
              {t('runs.files', { count: run.files.length, names: run.files.join(', ') })}
            </p>
          ) : null}
          <p className="automation-run-meta">{meta.join(' · ')}</p>
        </ItemContent>
        {run.taskId && taskGone ? (
          <ItemActions className="ml-auto">
            <span className="automation-run-meta">{t('runs.taskDeleted')}</span>
          </ItemActions>
        ) : run.taskId ? (
          <ItemActions className="ml-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('runs.openTaskFor', { when: started })}
              onClick={onOpen}
            >
              <SquareArrowOutUpRight data-icon="inline-start" />
              {t('runs.openTask')}
            </Button>
          </ItemActions>
        ) : null}
      </li>
    </Item>
  );
}
