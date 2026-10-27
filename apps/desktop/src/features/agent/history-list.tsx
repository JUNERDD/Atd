import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Ellipsis, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Badge } from '@atd/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { AgentTask } from '../../client/agent/task-schema';
import { isActive } from '../../client/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem, ItemMenuSeparator } from '../../components/item-menu';
import { ProviderBrand } from '../providers/provider-brand';
import type { HistoryEntry, HistoryRow } from './history-rows';
import { modelNameOf, rowDate, stampOf, type HistoryView } from './history-view';
import { TaskOriginBadge } from './task-origin-badge';

/** What the rows' menus do to their task; the history owns the dialogs these open. */
export type HistoryActions = {
  /** Pins an unpinned task, unpins a pinned one. */
  togglePin: (task: AgentTask) => void;
  rename: (task: AgentTask) => void;
  copyId: (task: AgentTask) => void;
  delete: (task: AgentTask) => void;
};

/** Row geometry before measurement (styles.css `.task-row`, `.history-section-title`). */
const ROW_HEIGHT = 62;
/** A conversation match's line under the meta line, with the row's 4px gap above it. */
const SNIPPET_HEIGHT = 20;
const TITLE_HEIGHT = 20;
const SECTION_GAP = 12;
/** The 4px between rows; sections add `SECTION_GAP` above their heading. */
const ROW_GAP = 4;

/**
 * The history's rows in its scroll area, windowed: only the rows near the viewport mount, so a long
 * history costs what a screenful does. Rows are measured once mounted, so a row's estimate only
 * places it until then. `children` follow the list, for the empty states.
 */
export function HistoryList({
  rows,
  view,
  now,
  actions,
  onChoose,
  children,
}: {
  rows: HistoryRow[];
  view: HistoryView;
  now: Date;
  actions: HistoryActions;
  onChoose: (id: string) => void;
  children?: ReactNode;
}) {
  // The virtualizer is one mutable instance whose reads change as it scrolls; compiled memoization
  // would keep the first window, so this component opts out (which the incompatible-library lint
  // cannot see). Rows below stay compiled and get only plain values, so a scroll re-renders only
  // the window.
  'use no memo';
  const viewport = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line react/incompatible-library -- opted out of memoization above.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return ROW_HEIGHT;
      const height = ROW_HEIGHT + (row.entry.content ? SNIPPET_HEIGHT : 0);
      if (row.title === null) return height;
      return height + TITLE_HEIGHT + (row.laterSection ? SECTION_GAP : 0);
    },
    getItemKey: (index) => rows[index]?.entry.task.id ?? index,
    gap: ROW_GAP,
    overscan: 8,
  });
  return (
    <ScrollArea
      className="-mr-3 min-h-0 flex-1"
      gutter="stable"
      scrollShadow
      viewportRef={viewport}
    >
      <ul
        className="history-list"
        style={{ '--history-list-height': `${virtualizer.getTotalSize()}px` } as CSSProperties}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <li
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              aria-setsize={rows.length}
              aria-posinset={item.index + 1}
              className="history-list-item"
              data-later-section={row.laterSection || undefined}
              style={{ '--history-row-y': `${item.start}px` } as CSSProperties}
            >
              {row.title !== null && <h3 className="history-section-title">{row.title}</h3>}
              <HistoryTaskRow
                entry={row.entry}
                view={view}
                now={now}
                actions={actions}
                onChoose={onChoose}
              />
            </li>
          );
        })}
      </ul>
      {children}
    </ScrollArea>
  );
}

/** Row actions, shown by the More dropdown and by the right-click menu (`item-menu.tsx`). */
function TaskMenuItems({ task, actions }: { task: AgentTask; actions: HistoryActions }) {
  const { t } = useTranslation('tasks');
  return (
    <>
      <ItemMenuItem onSelect={() => actions.togglePin(task)}>
        {task.pinned ? <PinOff /> : <Pin />}
        {task.pinned ? t('history.unpin') : t('history.pin')}
      </ItemMenuItem>
      <ItemMenuItem onSelect={() => actions.rename(task)}>
        <Pencil />
        {t('history.rename')}
      </ItemMenuItem>
      <ItemMenuItem onSelect={() => actions.copyId(task)}>
        <Copy />
        {t('history.copyId')}
      </ItemMenuItem>
      <ItemMenuSeparator />
      <ItemMenuItem
        variant="destructive"
        disabled={isActive(task.runs.at(-1)?.status)}
        onSelect={() => actions.delete(task)}
      >
        <Trash2 />
        {t('history.delete')}
      </ItemMenuItem>
    </>
  );
}

/** Run states that need the user's attention read in the destructive color, beside their text. */
const ERROR_STATUSES = new Set(['failed', 'interrupted']);

/** A task waits for the person's answer or approval before its run can go on. */
function needsAttention(status: string | undefined) {
  return status === 'awaiting_input' || status === 'awaiting_confirmation';
}

function HistoryTaskRow({
  entry: { task, statusLabel, match, content },
  view,
  now,
  actions,
  onChoose,
}: {
  entry: HistoryEntry;
  view: HistoryView;
  now: Date;
  actions: HistoryActions;
  onChoose: (id: string) => void;
}) {
  const { t, i18n } = useTranslation('tasks');
  const status = task.runs.at(-1)?.status;
  const model = task.runs.at(-1)?.snapshot.model;
  const modelName = modelNameOf(task);
  const progressing = status === 'queued' || status === 'running' || status === 'stopping';
  const stamp = stampOf(task, view.sort);
  const updated = new Date(stamp);
  const menu = <TaskMenuItems task={task} actions={actions} />;
  return (
    <ItemContextMenu menu={menu}>
      <div className="history-row">
        {/* In the row's leading inset, so no title or meta line moves; the status text names it too. */}
        {needsAttention(status) && (
          <span className="history-row-attention" title={t('history.needsAttention')}>
            <span className="sr-only">{t('history.needsAttention')}</span>
          </span>
        )}
        <Button variant="ghost" className="task-row min-w-0" onClick={() => onChoose(task.id)}>
          <span className="task-row-head">
            <span className="task-row-heading">
              <span className="task-row-title" title={task.title}>
                <HighlightedText text={task.title} ranges={match?.ranges.title} />
              </span>
              {statusLabel && (
                <Badge
                  variant={status && ERROR_STATUSES.has(status) ? 'destructive' : 'secondary'}
                  className="task-row-status border-border"
                  title={statusLabel}
                >
                  <span className="truncate">
                    {/* Shimmer animates plain text only, so a running status stays unmarked. */}
                    {progressing ? (
                      <Shimmer as="span">{statusLabel}</Shimmer>
                    ) : (
                      <HighlightedText text={statusLabel} ranges={match?.ranges.status} />
                    )}
                  </span>
                </Badge>
              )}
              {task.origin && <TaskOriginBadge origin={task.origin} />}
            </span>
            <time className="task-row-time" dateTime={stamp} title={updated.toLocaleString()}>
              {/* A pinned task sits in the pinned section, under no day heading. */}
              {rowDate(updated, now, i18n.language, view.group === 'date' && !task.pinned)}
            </time>
          </span>
          <span className="task-row-meta">
            {model && (
              <span className="task-row-model" title={`${modelName} · ${model.provider}`}>
                <ProviderBrand provider={model.provider} variant="inline" />
                <span className="sr-only">{model.provider} · </span>
                <span className="task-row-model-name">{modelName}</span>
              </span>
            )}
          </span>
          {content && (
            <span className="task-row-snippet" title={content.snippet}>
              <HighlightedText text={content.snippet} ranges={content.ranges} />
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={t('history.more')}
              aria-label={t('history.moreActionsFor', { title: task.title })}
              className="history-row-more"
              tooltip={false}
            >
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ItemContextMenu>
  );
}
