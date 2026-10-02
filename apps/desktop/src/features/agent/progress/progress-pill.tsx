import { Fragment, type ReactNode } from 'react';
import { Bot, ListOrdered, LoaderCircle, MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Separator } from '@ai/ui/components/separator';
import { cn } from '@ai/ui/lib/utils';
import type { TaskProgress } from './selectors';
import './progress.css';

/**
 * Circular progress of the todo list: a muted track with a green arc for the completed share.
 * The pill text says the same, so the ring is decorative. `pathLength` makes the dash a plain
 * percentage.
 */
function StepRing({ completed, total }: { completed: number; total: number }) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <svg className="composer-progress-ring" viewBox="0 0 16 16" aria-hidden>
      <circle className="composer-progress-ring-track" cx="8" cy="8" r="6" />
      {percent > 0 && (
        <circle
          className="composer-progress-ring-value"
          cx="8"
          cy="8"
          r="6"
          pathLength={100}
          strokeDasharray={`${percent} 100`}
        />
      )}
    </svg>
  );
}

/** Enter eases out like the popover's view slide; exit is quicker and eases in. */
const ENTER: Transition = { duration: 0.2, ease: [0.22, 1, 0.36, 1] };
const EXIT: Transition = { duration: 0.15, ease: [0.4, 0, 1, 1] };
const INSTANT: Transition = { duration: 0 };

/** The views of the one popover above the composer, each opened by its pill part. */
export type PillView = 'hitl' | 'todos' | 'subagents';

/**
 * Pending human-in-the-loop content (approvals, answers, queued messages): the pill's first part
 * shows it for as long as it waits.
 */
export interface HitlStatus {
  kind: 'approval' | 'answer' | 'queue';
  /** "Waiting for your approval", "Waiting for your answer", or the queued count. */
  label: string;
}

const HITL_ICONS = {
  approval: ShieldAlert,
  answer: MessageCircleQuestion,
  queue: ListOrdered,
} as const;

/**
 * A part that opens its view: an xs button flush on the capsule's glass (`glass-ghost`), rounded to
 * the capsule, expanded while its view shows. `data-pill-view` lets the popover return focus to it.
 * It drops the button's transparent border so its washes reach the capsule's edge and its padding
 * matches the plain parts beside it.
 */
function PartButton({
  view,
  open,
  label,
  className,
  onToggle,
  children,
}: {
  view: PillView;
  open: boolean;
  label?: string;
  className?: string;
  onToggle: (view: PillView) => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="glass-ghost"
      size="xs"
      className={cn('composer-progress-part composer-progress-trigger border-0', className)}
      data-pill-view={view}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={label}
      onClick={() => onToggle(view)}
    >
      {children}
    </Button>
  );
}

/**
 * Compact status capsule, centered above the composer input, with up to three parts, each hidden
 * when it has nothing to say (the pill hides when all are). Parts with something to list open
 * their view in the one popover the composer owns, so switching parts morphs that popover
 * instead of stacking a second one:
 * - pending HITL content ("Waiting for your approval"), shown for as long as it waits;
 * - a progress ring and `Step x / y` from the latest todo list, which opens Todos;
 * - the subagents the latest reply dispatched, finished ones included, which opens their list.
 *   Summarized children stay after the reply ends and on reopen, since the pill is the way into
 *   their conversations; a bare count from a transcript without summaries has no list to open and
 *   shows only while the reply is `live` (its run is in progress);
 * - "Compacting context…" while the task's context is being compacted, with nothing to open: the
 *   transcript's compaction row carries the outcome.
 *
 * The pill enters and leaves animated: its row grows from and collapses to zero height, so the
 * transcript above resizes instead of jumping, while the capsule fades and scales, rising out of
 * the composer. The first render (a window that opens on a task) places it without animating.
 */
export function ProgressPill({
  progress,
  live,
  hitl,
  compacting = false,
  view,
  onToggle,
}: {
  progress: TaskProgress;
  live: boolean;
  hitl: HitlStatus | null;
  /** The task's context is being compacted. */
  compacting?: boolean;
  /** The view the popover shows, which marks its part expanded. */
  view: PillView | null;
  onToggle: (view: PillView) => void;
}) {
  const { t } = useTranslation('panel');
  const { t: tt } = useTranslation('tasks');
  const { todos, step, completed, children } = progress;
  const subagents = children.length > 0 ? children.length : live ? progress.subagents : 0;
  const running = children.filter((child) => child.status === 'running').length;
  const parts: { key: string; node: ReactNode }[] = [];
  if (hitl) {
    const Icon = HITL_ICONS[hitl.kind];
    parts.push({
      key: 'hitl',
      node: (
        <PartButton
          view="hitl"
          open={view === 'hitl'}
          className="composer-progress-hitl"
          onToggle={onToggle}
        >
          <Icon aria-hidden />
          {/* A narrow panel truncates this label first; hover shows it whole. */}
          <span className="truncate" title={hitl.label}>
            {hitl.label}
          </span>
        </PartButton>
      ),
    });
  }
  if (step) {
    const stepText = t('composer.progress.step', { current: step.current, total: step.total });
    const content = (
      <>
        <StepRing completed={completed} total={step.total} />
        <span className="truncate">{stepText}</span>
      </>
    );
    parts.push({
      key: 'step',
      node:
        todos.length > 0 ? (
          <PartButton
            view="todos"
            open={view === 'todos'}
            label={`${stepText} · ${t('composer.progress.showTodos')}`}
            onToggle={onToggle}
          >
            {content}
          </PartButton>
        ) : (
          <span className="composer-progress-part">{content}</span>
        ),
    });
  }
  if (subagents > 0) {
    const subagentText =
      running > 0
        ? t('composer.progress.subagentRunning', { count: running })
        : subagents === 1
          ? t('composer.progress.subagentOne')
          : t('composer.progress.subagentMany', { count: subagents });
    const content = (
      <>
        <Bot aria-hidden />
        <span className="truncate">{subagentText}</span>
      </>
    );
    parts.push({
      key: 'subagents',
      node:
        children.length > 0 ? (
          <PartButton
            view="subagents"
            open={view === 'subagents'}
            label={`${subagentText} · ${tt('subagent.listLabel')}`}
            onToggle={onToggle}
          >
            {content}
          </PartButton>
        ) : (
          <span className="composer-progress-part">{content}</span>
        ),
    });
  }
  if (compacting)
    parts.push({
      key: 'compacting',
      node: (
        <span className="composer-progress-part">
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
          <span className="truncate">{t('composer.progress.compacting')}</span>
        </span>
      ),
    });
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {parts.length > 0 && (
        <motion.div
          key="pill"
          className="composer-progress-row"
          initial={{ height: 0 }}
          animate={{ height: 'auto', transition: reduced ? INSTANT : ENTER }}
          exit={{ height: 0, transition: reduced ? INSTANT : EXIT }}
        >
          <motion.div
            className="composer-progress-slot"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, transition: reduced ? INSTANT : ENTER }}
            exit={{ opacity: 0, scale: 0.96, transition: reduced ? INSTANT : EXIT }}
          >
            <output
              className="composer-progress glass-control surface-glass"
              aria-label={t('composer.progress.label')}
            >
              {parts.map(({ key, node }, index) => (
                <Fragment key={key}>
                  {index > 0 && (
                    // Radix stretches a vertical separator; a fixed 12px one centers in the 24px
                    // capsule.
                    <Separator orientation="vertical" className="h-3 data-vertical:self-center" />
                  )}
                  {node}
                </Fragment>
              ))}
            </output>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
