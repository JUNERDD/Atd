import {
  ChevronRight,
  CircleCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentChildSummary } from '@ai/agent-contracts';
import { Button } from '@ai/ui/components/button';
import { PopoverHeader, PopoverTitle } from '@ai/ui/components/popover';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { cn } from '@ai/ui/lib/utils';
import { subtaskLabel, type PendingByExecution } from '../transcript/subagent-children';
import { useSubagents } from '../transcript/subagent-context';
import { usePrefetchChildTranscripts } from '../transcript/use-child-transcript';

/**
 * A child's state as its row's leading glyph, in the Todos list's glyph style: the pill's HITL
 * icons while a request of it waits, a spinner while it runs, then its outcome. The order is the
 * list's: what needs the reader first, then working, then settled children.
 */
const GLYPHS = {
  approval: { Icon: ShieldAlert, className: '', label: 'permission.waitingApproval' },
  answer: { Icon: MessageCircleQuestion, className: '', label: 'permission.waitingAnswer' },
  running: { Icon: LoaderCircle, className: 'animate-spin', label: 'activity.running' },
  failed: { Icon: CircleX, className: 'text-destructive', label: 'activity.failed' },
  interrupted: {
    Icon: CircleSlash,
    className: 'text-muted-foreground',
    label: 'activity.interrupted',
  },
  completed: { Icon: CircleCheck, className: 'text-muted-foreground', label: 'activity.completed' },
} as const;
type Glyph = keyof typeof GLYPHS;
const ORDER = Object.keys(GLYPHS) as Glyph[];

function glyphOf(child: SubagentChildSummary, pending: PendingByExecution): Glyph {
  const waiting = pending.get(child.executionId);
  if (waiting) return waiting === 'input' ? 'answer' : 'approval';
  return child.status;
}

/** The list's name for a child: the first line of its task, else the agent. */
function childTitle(child: SubagentChildSummary): string {
  return child.task.split('\n', 1)[0]?.trim() || child.agent;
}

function ChildRow({
  child,
  glyph,
  onOpen,
}: {
  child: SubagentChildSummary;
  glyph: Glyph;
  onOpen: ((childKey: string) => void) | null;
}) {
  const { t } = useTranslation('tasks');
  const { Icon, className, label } = GLYPHS[glyph];
  return (
    <li>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        title={subtaskLabel(child)}
        aria-label={`${t(label)} · ${t('subagent.openChild', { name: subtaskLabel(child) })}`}
        disabled={!onOpen}
        onClick={() => onOpen?.(child.key)}
      >
        <Icon strokeWidth={1.75} className={cn('size-3.5 shrink-0', className)} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">{childTitle(child)}</span>
        <ChevronRight className="text-muted-foreground" aria-hidden />
      </Button>
    </li>
  );
}

/**
 * The composer popover's Subagents view: the latest reply's children in one flat list, sorted by
 * state with each state shown by the row's leading glyph. Each row opens that child's full
 * conversation (`onOpen`, null outside the task panel); the list keeps no detail beyond the name,
 * which the drill-in view shows. While the list shows, it prefetches the conversations it can
 * open, so the drill-in rarely waits.
 */
export function SubagentPanel({
  taskId,
  items,
  truncated,
  onOpen,
}: {
  taskId: string | null;
  items: SubagentChildSummary[];
  truncated: boolean;
  onOpen: ((childKey: string) => void) | null;
}) {
  const { t } = useTranslation('tasks');
  const { pending } = useSubagents();
  usePrefetchChildTranscripts(
    onOpen ? taskId : null,
    items.map((child) => child.key),
  );
  const rows = items.map((child) => ({ child, glyph: glyphOf(child, pending) }));
  // A stable sort keeps launch order within each state.
  rows.sort((a, b) => ORDER.indexOf(a.glyph) - ORDER.indexOf(b.glyph));
  return (
    <div className="composer-subagents">
      <PopoverHeader className="composer-subagents-header">
        <PopoverTitle className="text-xs text-muted-foreground">
          {t('subagent.listLabel')}
        </PopoverTitle>
      </PopoverHeader>
      <ScrollArea className="composer-todos-scroll" scrollShadow>
        <ul className="composer-subagents-list" data-panel-focus>
          {rows.map(({ child, glyph }) => (
            <ChildRow key={child.key} child={child} glyph={glyph} onOpen={onOpen} />
          ))}
        </ul>
        {truncated && (
          <p className="m-0 mt-2 px-3 text-xs text-muted-foreground">{t('subagent.truncated')}</p>
        )}
      </ScrollArea>
    </div>
  );
}
