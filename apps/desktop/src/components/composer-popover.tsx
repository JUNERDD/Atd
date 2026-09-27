import { useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverAnchor, PopoverContent } from '@ai/ui/components/popover';
import { isComposingKey } from '@ai/ui/lib/ime';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import type { Block, QueueState } from '../../electron/agent/transcript-schema';
import { ProgressPill, type PillView } from '../features/agent/progress/progress-pill';
import { SubagentPanel } from '../features/agent/progress/subagent-panel';
import { TodosPanel } from '../features/agent/progress/todo-list';
import { useTaskProgress } from '../features/agent/progress/use-task-progress';
import { useSubagents } from '../features/agent/transcript/subagent-context';
import { HitlPanel } from './hitl-panel';
import { MorphViewport } from './morph-viewport';
import { useComposerView } from './use-composer-view';
import { useHitlSummary } from './use-hitl-summary';
import { createViewAnchor } from './view-anchor';
import './composer-popover.css';

const NO_BLOCKS: readonly Block[] = [];

/**
 * The status pill above the composer surface and the one Radix popover its parts open: HITL
 * content (requests and the queue), Todos, or Subagents. Like a navigation menu's viewport, the
 * popover stays open while the user moves between parts and morphs to the next view instead of
 * stacking a second popover, sliding to center on the part that opened it; clicking the expanded
 * part closes it. `useComposerView` decides what shows.
 *
 * Focus and Esc are split by intent. Radix auto-focus is off, so an arriving request never steals
 * the composer; only the HITL controls autofocus, and only when the user is not typing. Opening
 * a view from the pill moves focus to its first action (or the popover) and Esc returns focus to
 * that part, stopping propagation so the panel-global Esc (new chat, hide) never fires. While the
 * quick panel is open above the same anchor the popover is `suppressed`: it hides without
 * counting as a dismiss and returns unchanged. A `hidden` composer (a subagent's drill-in covers
 * the task) closes it the same way but at once, without the exit animation: the drill-in replaces
 * the view the popover belonged to.
 */
export function ComposerPopover({
  requests,
  queue,
  taskId,
  queueDisabled = false,
  suppressed = false,
  hidden = false,
  recall = 0,
  blocks = NO_BLOCKS,
  live = false,
  onEditQueued,
  children,
}: {
  requests: PermissionRequest[];
  queue: QueueState;
  taskId: string | null;
  queueDisabled?: boolean;
  /** The quick panel is open over the composer; hide without dismissing. */
  suppressed?: boolean;
  /** The composer is hidden; close at once and return unchanged when it shows again. */
  hidden?: boolean;
  /** Changes when the user asks for the queue (`/queue`): dismissed HITL content reopens. */
  recall?: number;
  /** The open task's transcript, which the pill's step and subagent parts derive from. */
  blocks?: readonly Block[];
  /** The latest reply's run is in progress. */
  live?: boolean;
  onEditQueued: (text: string) => void;
  /** The composer surface; the popover anchors to it without adding a visible trigger. */
  children: ReactElement;
}) {
  const { t } = useTranslation('tasks');
  const anchor = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hitl = useHitlSummary(requests, queue, taskId);
  const progress = useTaskProgress(blocks);
  const { open: openChild } = useSubagents();
  const [view, setView] = useComposerView({
    signature: hitl.signature,
    requestIds: requests.map((request) => request.id),
    hasHitl: hitl.status !== null,
    recall,
  });
  const available: Record<PillView, boolean> = {
    hitl: hitl.status !== null,
    todos: progress.todos.length > 0,
    subagents: progress.children.length > 0,
  };
  const shown = view !== null && available[view] ? view : null;
  const open = shown !== null && !suppressed && !hidden;
  // The closing popover keeps its last view while it animates out, instead of emptying.
  const [rendered, setRendered] = useState(shown);
  if (shown !== null && shown !== rendered) setRendered(shown);
  // Only a switch between views slides the popover; its first placement must not animate.
  const [previous, setPrevious] = useState(shown);
  const [moved, setMoved] = useState(false);
  if (previous !== shown) {
    setPrevious(shown);
    setMoved(previous !== null && shown !== null);
  }
  const reduced = useReducedMotion();
  const [anchorFor] = useState(createViewAnchor);
  // A new reference per view makes Radix re-anchor when the view changes.
  const viewAnchor = useMemo(() => {
    const slide = moved && !reduced;
    return { current: { getBoundingClientRect: () => anchorFor(anchor.current, rendered, slide) } };
  }, [anchorFor, rendered, moved, reduced]);

  const part = (target: PillView) =>
    anchor.current?.querySelector<HTMLElement>(`[data-pill-view="${target}"]`) ?? null;

  function toggle(target: PillView) {
    if (open && shown === target) {
      setView(null);
      return;
    }
    setView(target);
    requestAnimationFrame(() => {
      const panel = content.current;
      const action = panel?.querySelector<HTMLElement>('[data-panel-focus] button:not([disabled])');
      (action ?? panel)?.focus();
    });
  }

  function close() {
    const last = shown;
    setView(null);
    // The popover unmounts under focused fingers; the part that opened it takes focus back.
    if (last) requestAnimationFrame(() => part(last)?.focus());
  }

  function onContentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || isComposingKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  const onOpenChild = openChild
    ? (childKey: string) => {
        // The drill-in's back button takes focus and returns it to the subagents part.
        const origin = part('subagents');
        setView(null);
        if (origin) openChild(childKey, origin);
      }
    : null;

  const labels: Record<PillView, string> = {
    hitl: hitl.title,
    todos: t('todo.title'),
    subagents: t('subagent.listLabel'),
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setView(null);
      }}
    >
      <PopoverAnchor virtualRef={viewAnchor} />
      <div ref={anchor} className="composer-popover-anchor">
        <ProgressPill
          progress={progress}
          live={live}
          hitl={hitl.status}
          view={open ? shown : null}
          onToggle={toggle}
        />
        {children}
      </div>
      <PopoverContent
        ref={content}
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={8}
        className="composer-popover"
        // Radix unmounts closed content at once when it has no exit animation to wait for.
        data-instant-close={hidden || undefined}
        // The pill can reflow under an open view (a part appears or its count changes), which no
        // resize of the popover or window reports.
        updatePositionStrategy="always"
        aria-label={rendered === null ? undefined : labels[rendered]}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // The pill toggles and switches views itself, and HITL content is answered from the
        // composer: neither is "outside". Anywhere else still dismisses.
        onInteractOutside={(event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          const pill = anchor.current?.querySelector('.composer-progress');
          if (pill?.contains(target) || (shown === 'hitl' && anchor.current?.contains(target)))
            event.preventDefault();
        }}
        onKeyDown={onContentKeyDown}
      >
        <MorphViewport>
          {rendered === 'hitl' && (
            <HitlPanel
              key="hitl"
              summary={hitl}
              requests={requests}
              queue={queue}
              taskId={taskId}
              queueDisabled={queueDisabled}
              onEditQueued={onEditQueued}
              onClose={close}
            />
          )}
          {rendered === 'todos' && (
            <TodosPanel key="todos" todos={progress.todos} completed={progress.completed} />
          )}
          {rendered === 'subagents' && (
            <SubagentPanel
              key="subagents"
              taskId={taskId}
              items={progress.children}
              truncated={progress.childrenTruncated}
              onOpen={onOpenChild}
            />
          )}
        </MorphViewport>
      </PopoverContent>
    </Popover>
  );
}
