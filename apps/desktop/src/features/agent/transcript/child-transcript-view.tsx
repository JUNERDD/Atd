import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { SubagentChildSummary } from '@ai/agent-contracts';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import { IconButton } from '../../../components/icon-button';
import { adaptTranscript } from './adapter';
import { ScrollJump } from './scroll-jump';
import { useSubagents } from './subagent-context';
import { TurnView } from './turn-view';
import { indexRequests } from './turns';
import { useChildTranscript } from './use-child-transcript';
import { useTranscriptScroll } from './use-transcript-scroll';

/** The drill-in view owns no files: task files anchor in the parent conversation only. */
const NO_ANCHORS = new Set<string>();
const noAttach = () => {};

/**
 * Where the view sits ("task › agent") with the way back. The view is a read-only transcript, so
 * the header carries no task, status or error of its own. The back action takes focus on open so
 * keyboard users land inside the new view.
 */
function ChildHeader({
  taskTitle,
  child,
  onBack,
}: {
  taskTitle: string;
  child: SubagentChildSummary | undefined;
  onBack: () => void;
}) {
  const { t } = useTranslation('tasks');
  const backRef = useRef<HTMLButtonElement>(null);
  const agent = child?.agent || t('subagent.fallbackName');
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="child-header">
      <div className="flex min-w-0 items-center gap-1">
        <IconButton ref={backRef} label={t('subagent.back')} className="-ml-1.5" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <nav aria-label={t('subagent.breadcrumb')} className="min-w-0 flex-1">
          <ol className="m-0 flex min-w-0 list-none items-center gap-1 p-0 text-sm">
            <li className="min-w-0 truncate text-muted-foreground" title={taskTitle}>
              {taskTitle}
            </li>
            <li aria-hidden="true" className="flex shrink-0 text-muted-foreground">
              <ChevronRight className="size-3.5" />
            </li>
            <li
              aria-current="page"
              className="max-w-2/3 shrink-0 truncate font-medium"
              title={agent}
            >
              {agent}
            </li>
          </ol>
        </nav>
      </div>
    </header>
  );
}

/**
 * A subagent's full conversation laid over the parent transcript: the same turn, activity and
 * answer rendering, fed from the child's own transcript subscription. Pending approvals come
 * from the task-level requests because the child's tool calls raise them on the parent task;
 * the transcript only labels them, and the parent's composer (hidden while this view is open)
 * answers them.
 */
export function ChildTranscriptView({
  taskId,
  taskTitle,
  childKey,
  requests,
  onBack,
}: {
  taskId: string;
  taskTitle: string;
  childKey: string;
  requests: PermissionRequest[];
  onBack: () => void;
}) {
  const { t } = useTranslation('tasks');
  const { index } = useSubagents();
  const child = index.byKey.get(childKey);
  const { detail, error } = useChildTranscript(taskId, childKey);
  const requestIndex = useMemo(() => indexRequests(requests), [requests]);
  const blocks = detail?.blocks;
  const model = child?.model ?? '';
  // Child blocks carry the parent's run id, so the run list would name the parent's model; the
  // child's own model from its summary labels the turn instead.
  const turns = useMemo(
    () =>
      blocks
        ? adaptTranscript(blocks, requestIndex, []).map((turn) => ({ ...turn, modelName: model }))
        : [],
    [blocks, requestIndex, model],
  );
  const live = child ? child.status === 'running' : Boolean(detail?.live);
  const { viewportRef, showJump, pin, onScroll } = useTranscriptScroll(detail?.revision ?? 0);

  return (
    <div className="conversation child-conversation">
      <ChildHeader taskTitle={taskTitle} child={child} onBack={onBack} />
      <ScrollArea
        viewportRef={viewportRef}
        className="flex-1 min-h-0"
        viewportClassName="overlay-footer-fade"
        viewportProps={{ onScroll }}
      >
        <div className="conversation-messages">
          {turns.map((turn, position) => (
            <TurnView
              key={turn.id}
              turn={turn}
              runs={[]}
              artifacts={[]}
              anchors={NO_ANCHORS}
              requests={requestIndex}
              live={live}
              last={position === turns.length - 1}
              copyable={false}
              onAttach={noAttach}
            />
          ))}
          {error ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {error}
            </p>
          ) : !detail ? (
            <p className="m-0 text-sm text-muted-foreground">{t('subagent.loading')}</p>
          ) : (
            turns.length === 0 && (
              <p className="m-0 text-sm text-muted-foreground">{t('subagent.empty')}</p>
            )
          )}
        </div>
      </ScrollArea>
      <ScrollJump show={showJump} onJump={pin} />
    </div>
  );
}
