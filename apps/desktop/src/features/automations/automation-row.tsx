import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleAlert,
  CirclePause,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import type { AutomationItem } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Switch } from '@atd/ui/components/switch';
import type { FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import { IconButton } from '../../components/icon-button';
import { formatWhen } from './automation-time';
import { outcomeTone, outcomeWords, problemWords } from './automation-words';
import { OutcomeIcon, TriggerIcon } from './run-outcome';
import '../../components/open-row.css';

export interface AutomationRowActions {
  /** Opens the editor. */
  onOpen: (item: AutomationItem) => void;
  onToggle: (item: AutomationItem, enabled: boolean) => void;
  onRun: (item: AutomationItem) => void;
  onRuns: (item: AutomationItem) => void;
  onDuplicate: (item: AutomationItem) => void;
  onDelete: (item: AutomationItem) => void;
}

interface StatusLine {
  tone: ReturnType<typeof outcomeTone>;
  icon: ReactNode;
  text: string;
}

/**
 * The row's status line: why it cannot run, that it runs now, why the service turned it off, or
 * when it runs next and how its last run went. Only the first that applies shows. Dates read
 * against when the list opened, so rows hold still while it is browsed.
 */
function useStatusLine(item: AutomationItem, paused: boolean): StatusLine {
  const { t, i18n } = useTranslation('automations');
  const [now] = useState(() => new Date());
  const { automation, status } = item;
  if (status.problem)
    return { tone: 'error', icon: <CircleAlert />, text: problemWords(status.problem, t) };
  if (status.running)
    return { tone: null, icon: <OutcomeIcon outcome="running" />, text: t('status.running') };
  if (status.pausedReason === 'failures')
    return { tone: 'warning', icon: <CirclePause />, text: t('status.pausedFailures') };
  if (status.pausedReason === 'finished')
    return { tone: null, icon: null, text: t('status.pausedFinished') };
  if (automation.enabled && paused)
    return { tone: 'warning', icon: <CirclePause />, text: t('status.paused') };
  const parts: string[] = [];
  if (!automation.enabled) parts.push(t('status.off'));
  else if (status.nextRunAt)
    parts.push(t('status.next', { when: formatWhen(status.nextRunAt, now, i18n.language) }));
  const last = status.lastRun;
  parts.push(
    last
      ? t('status.last', {
          outcome: outcomeWords(last.outcome, t),
          when: formatWhen(last.finishedAt ?? last.firedAt, now, i18n.language),
        })
      : t('status.noRuns'),
  );
  return {
    tone: last && automation.enabled ? outcomeTone(last.outcome) : null,
    icon: null,
    text: parts.join(' · '),
  };
}

/**
 * One row anatomy for every automation (the Commands row's): the trigger's icon, the name with
 * its unread results, the trigger in words and the status line, then Run, the switch and More in
 * fixed positions. Run stays focusable while it cannot run, so its tooltip says why.
 */
export function AutomationRow({
  item,
  summary,
  match,
  busy,
  paused,
  unavailable,
  onOpen,
  onToggle,
  onRun,
  onRuns,
  onDuplicate,
  onDelete,
}: {
  item: AutomationItem;
  summary: string;
  match: FieldsMatch<'name' | 'summary'> | null;
  busy: boolean;
  paused: boolean;
  unavailable: boolean;
} & AutomationRowActions) {
  const { t } = useTranslation('automations');
  const { automation, status } = item;
  const line = useStatusLine(item, paused);
  const runBlocked = unavailable || status.running || Boolean(status.problem);
  const runLabel = unavailable
    ? t('list.runUnavailable')
    : status.running
      ? t('list.runRunning')
      : status.problem
        ? t('list.runProblem')
        : t('list.run');
  return (
    <Item asChild size="sm" variant="outline" className="automation-row open-row">
      <li>
        <button
          type="button"
          className="open-row-button"
          aria-label={t('list.editFor', { name: automation.name })}
          onClick={() => onOpen(item)}
        />
        <div className="automation-row-identity">
          <ItemMedia variant="icon">
            <TriggerIcon kind={automation.trigger.kind} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="automation-row-title">
              <span className="truncate" title={automation.name}>
                <HighlightedText text={automation.name} ranges={match?.ranges.name} />
              </span>
              {status.unread > 0 && (
                <Badge
                  variant="secondary"
                  title={t('status.unreadLabel', { count: status.unread })}
                >
                  {t('status.unread', { count: status.unread })}
                </Badge>
              )}
            </ItemTitle>
            <ItemDescription title={summary}>
              <HighlightedText text={summary} ranges={match?.ranges.summary} />
            </ItemDescription>
            <p className="automation-status-line" data-tone={line.tone ?? undefined}>
              {line.icon}
              <span>{line.text}</span>
            </p>
          </ItemContent>
        </div>
        <ItemActions className="shrink-0">
          <IconButton
            label={runLabel}
            aria-label={t('list.runFor', { name: automation.name })}
            aria-disabled={runBlocked || busy || undefined}
            aria-busy={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!runBlocked && !busy) onRun(item);
            }}
          >
            <Play />
          </IconButton>
          <Switch
            aria-label={t('list.enableFor', { name: automation.name })}
            checked={automation.enabled}
            aria-disabled={busy || unavailable || undefined}
            aria-busy={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onCheckedChange={(enabled) => {
              if (!busy && !unavailable) onToggle(item, enabled);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t('list.more')}
                aria-label={t('list.moreActionsFor', { name: automation.name })}
                tooltipDismissOnClick
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen(item)}>
                <Pencil />
                {t('list.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRuns(item)}>
                <History />
                {t('list.runHistory')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={unavailable} onSelect={() => onDuplicate(item)}>
                <Copy />
                {t('list.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
                <Trash2 />
                {t('list.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </li>
    </Item>
  );
}
