import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Lightbulb, X } from 'lucide-react';
import type { NextStep, NextStepClick } from '@atd/agent-contracts';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Spinner } from '@atd/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import type { TaskRun } from '../../../client/agent/task-schema';
import { IconButton } from '../../../components/icon-button';
import { NextStepDialog, type NextStepDetail } from './next-step-dialog';
import { NEXT_STEP_ICONS } from './next-step-kinds';
import { useTurnNextSteps, type NextStepsOffer } from './use-next-steps-offer';
import './next-steps.css';

/**
 * The way back to a hidden card on the last turn's action bar, before More, shown while the turn
 * has suggestions. Expanded while the card shows, so the same button also hides it. While the
 * suggestions are generated it already holds its place, as a disabled spinner, so the bar does
 * not shift when they arrive: the same button then turns into the toggle.
 */
export function NextStepsToggle({ offer }: { offer: NextStepsOffer }) {
  const { t } = useTranslation('tasks');
  if (offer.status === 'pending') {
    // `aria-disabled`, not `disabled`: a disabled button takes no pointer or focus events, so its
    // tooltip could never say what the spinner is waiting for. It has no action to block.
    return (
      <IconButton
        id={offer.toggleId}
        label={t('nextSteps.preparing')}
        aria-disabled
        aria-busy
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        <Spinner />
      </IconButton>
    );
  }
  return (
    <IconButton
      id={offer.toggleId}
      label={offer.open ? t('nextSteps.hideCard') : t('nextSteps.showCard')}
      aria-expanded={offer.open}
      aria-controls={offer.open ? offer.cardId : undefined}
      onClick={() => offer.setOpen(!offer.open)}
    >
      <Lightbulb />
    </IconButton>
  );
}

/**
 * One suggestion: its label, and its kind with the reason. A follow-up stays in this conversation,
 * so hovering or focusing it previews the full prompt and what a click does with it; the other
 * kinds open their details in a dialog instead.
 */
function NextStepRow({
  step,
  click,
  onPick,
}: {
  step: NextStep;
  click: NextStepClick;
  onPick: (step: NextStep, row: HTMLElement) => void;
}) {
  const { t } = useTranslation('tasks');
  const Icon = NEXT_STEP_ICONS[step.kind];
  const here = step.kind === 'continue';
  const kind = t(`nextSteps.kinds.${step.kind}`);
  // No native `title` on the texts: a follow-up previews its prompt instead, and a dialog shows
  // the rest.
  const row = (
    <Item asChild size="xs" className="next-step-row">
      <button
        type="button"
        aria-haspopup={here ? undefined : 'dialog'}
        onClick={(event) => onPick(step, event.currentTarget)}
      >
        <ItemMedia variant="icon" className="next-step-kind">
          <Icon />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="next-step-title" title={undefined}>
            {step.label}
          </ItemTitle>
          <ItemDescription className="next-step-reason" title={undefined}>
            {step.reason ? t('nextSteps.kindReason', { kind, reason: step.reason }) : kind}
          </ItemDescription>
        </ItemContent>
        {!here && (
          <ItemActions>
            <ChevronRight className="size-4 text-muted-foreground" />
          </ItemActions>
        )}
      </button>
    </Item>
  );
  if (!here) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5 text-left">
        <span className="font-medium opacity-70">
          {click === 'send' ? t('nextSteps.willSend') : t('nextSteps.willFill')}
        </span>
        <span className="line-clamp-8">{step.prompt}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The "Next steps" card under the last settled turn (`run`'s): typed suggestions for what to do
 * next. A follow-up fills this conversation's composer, or sends at once under the click setting;
 * a new task or an automation opens a dialog with its details, where nothing happens until the
 * person confirms. Hiding the card from inside it hands focus to the action bar's toggle.
 */
export function NextStepsCard({ run, last }: { run: TaskRun | undefined; last: boolean }) {
  const { t } = useTranslation('tasks');
  const offer = useTurnNextSteps(run, last);
  const card = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<NextStepDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  if (offer?.status !== 'ready' || !offer.open) return null;
  const { actions, click, taskId, setOpen, toggleId } = offer;

  function pick(step: NextStep, row: HTMLElement) {
    if (step.kind !== 'continue') {
      setDetail({ step, opener: row });
      setDialogOpen(true);
    } else if (click === 'send') actions.send(taskId, step.prompt);
    else actions.fill(taskId, step.prompt);
  }
  function hide() {
    const within = card.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (within) requestAnimationFrame(() => document.getElementById(toggleId)?.focus());
  }

  return (
    <section
      ref={card}
      id={offer.cardId}
      className="next-steps-card"
      aria-label={t('nextSteps.label')}
    >
      <div className="next-steps-head">
        <span>{t('nextSteps.title')}</span>
        <IconButton label={t('nextSteps.hide')} className="next-steps-hide" onClick={hide}>
          <X />
        </IconButton>
      </div>
      <div className="next-steps-items">
        {offer.items.map((step) => (
          <NextStepRow key={step.id} step={step} click={click} onPick={pick} />
        ))}
      </div>
      <NextStepDialog
        detail={detail}
        open={dialogOpen}
        click={click}
        onClose={() => setDialogOpen(false)}
        onNewTask={actions.newTask}
      />
    </section>
  );
}
