import { useTranslation } from 'react-i18next';
import { isTaskAgent, type SubagentChildSummary } from '@atd/agent-contracts';
import { TemporaryBadge } from '../task-agents/task-agent-role';
import { agentDisplayName } from '../task-agents/task-agents';
import { subtaskLabel, type PendingByExecution } from '../transcript/subagent-children';
import { useSubagents } from '../transcript/subagent-context';
import { usePrefetchChildTranscripts } from '../transcript/use-child-transcript';
import { STATUS_ORDER, type StatusGlyph } from './status-glyphs';
import { StatusList, StatusRow } from './status-row';

function glyphOf(child: SubagentChildSummary, pending: PendingByExecution): StatusGlyph {
  const waiting = pending.get(child.executionId);
  if (waiting) return waiting === 'input' ? 'answer' : 'approval';
  return child.status;
}

/** The list's name for a child: the first line of its task, else the agent. */
function childTitle(child: SubagentChildSummary): string {
  return child.task.split('\n', 1)[0]?.trim() || agentDisplayName(child.agent);
}

/**
 * The composer popover's Subagents view: the latest reply's children in one flat list, sorted by
 * state with each state shown by the row's leading glyph and, under its task, in words with the
 * agent. Each row opens that child's full conversation (`onOpen`, null outside the task panel); the
 * list keeps no detail beyond that, which the drill-in view shows. Parallel children's tasks often
 * read alike until late, so a task takes up to two lines. A child of a task agent goes by the
 * agent's name without its `task.` prefix and carries the Temporary badge. While the list shows,
 * it prefetches the conversations it can open, so the drill-in rarely waits.
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
  rows.sort((a, b) => STATUS_ORDER.indexOf(a.glyph) - STATUS_ORDER.indexOf(b.glyph));
  return (
    <StatusList
      title={t('subagent.listLabel')}
      footer={
        truncated ? (
          <p className="m-0 mt-2 px-3 text-xs text-muted-foreground">{t('subagent.truncated')}</p>
        ) : null
      }
    >
      {rows.map(({ child, glyph }) => {
        const agent = agentDisplayName(child.agent);
        const temporary = isTaskAgent(child.agent);
        const name = subtaskLabel(child);
        return (
          <StatusRow
            key={child.key}
            glyph={glyph}
            text={childTitle(child)}
            // A child without a task already goes by its agent, which then needs no repeat.
            context={childTitle(child) === agent ? '' : agent}
            lines={2}
            title={name}
            actionLabel={
              temporary
                ? t('subagent.openTemporaryChild', { name })
                : t('subagent.openChild', { name })
            }
            badge={temporary ? <TemporaryBadge /> : undefined}
            onOpen={onOpen ? () => onOpen(child.key) : null}
          />
        );
      })}
    </StatusList>
  );
}
