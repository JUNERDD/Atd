import { useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Lightbulb, X } from 'lucide-react';
import type { NextStep } from '@atd/agent-contracts';
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
import { useNextStepPreview } from './use-next-step-preview';
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
 * so hovering or focusing it points the card's preview at it; the other kinds open their details
 * in a dialog instead and hide the preview.
 */
function NextStepRow({
  step,
  previewId,
  onPick,
  onPreview,
}: {
  step: NextStep;
  /** The preview's element id while it shows this row's prompt. */
  previewId: string | undefined;
  onPick: (step: NextStep, row: HTMLElement) => void;
  onPreview: (row: HTMLElement, stepId: string | null) => void;
}) {
  const { t } = useTranslation('tasks');
  const Icon = NEXT_STEP_ICONS[step.kind];
  const here = step.kind === 'continue';
  const kind = t(`nextSteps.kinds.${step.kind}`);
  const previewThis = (event: { currentTarget: HTMLElement }) =>
    onPreview(event.currentTarget, here ? step.id : null);
  // No native `title` on the texts: a follow-up previews its prompt instead, and a dialog shows
  // the rest.
  return (
    <Item asChild size="xs" className="next-step-row">
      <button
        type="button"
        aria-haspopup={here ? undefined : 'dialog'}
        aria-describedby={previewId}
        onClick={(event) => onPick(step, event.currentTarget)}
        onPointerEnter={previewThis}
        onFocus={previewThis}
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
}

/**
 * The "Next steps" card under the last settled turn (`run`'s): typed suggestions for what to do
 * next. A follow-up fills this conversation's composer, or sends at once under the click setting;
 * a new task or an automation opens a dialog with its details, where nothing happens until the
 * person confirms. Hiding the card from inside it hands focus to the action bar's toggle.
 *
 * The card has one preview of a follow-up's full prompt, which sits on the hovered or focused row
 * and slides to the next one instead of closing and reopening (useNextStepPreview). The whole card
 * is its tooltip trigger, so the shared delay applies once on entering the card. It hides over a
 * row without a preview and when the pointer leaves the rows, and closes when it leaves the card.
 */
export function NextStepsCard({ run, last }: { run: TaskRun | undefined; last: boolean }) {
  const { t } = useTranslation('tasks');
  const offer = useTurnNextSteps(run, last);
  const card = useRef<HTMLElement>(null);
  const previewElementId = useId();
  const preview = useNextStepPreview(card);
  const [detail, setDetail] = useState<NextStepDetail | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  if (offer?.status !== 'ready' || !offer.open) return null;
  const { actions, click, taskId, setOpen, toggleId } = offer;
  const { shown } = preview;
  const previewed =
    shown && offer.items.find((step) => step.id === shown.stepId && step.kind === 'continue');

  function pick(step: NextStep, row: HTMLElement) {
    if (step.kind !== 'continue') {
      setDetail({ step, opener: row });
      setDialogOpen(true);
      return;
    }
    preview.dismiss(step.id);
    if (click === 'send') actions.send(taskId, step.prompt);
    else actions.fill(taskId, step.prompt);
  }
  function hide() {
    const within = card.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    if (within) requestAnimationFrame(() => document.getElementById(toggleId)?.focus());
  }

  return (
    <>
      <Tooltip open={preview.open} onOpenChange={preview.onOpenChange}>
        <TooltipTrigger asChild {...preview.card}>
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
            <div className="next-steps-items" {...preview.rows}>
              {offer.items.map((step) => (
                <NextStepRow
                  key={step.id}
                  step={step}
                  previewId={step === previewed ? previewElementId : undefined}
                  onPick={pick}
                  onPreview={preview.point}
                />
              ))}
            </div>
          </section>
        </TooltipTrigger>
        {shown && previewed && (
          <TooltipContent
            id={previewElementId}
            side="top"
            className="next-step-preview flex-col items-start gap-0.5 text-left"
            style={
              {
                '--next-step-from-top': `${shown.fromTop}px`,
                '--next-step-from-bottom': `${shown.fromBottom}px`,
              } as CSSProperties
            }
            onEscapeKeyDown={() => preview.dismiss(shown.stepId)}
          >
            <span className="font-medium opacity-70">
              {click === 'send' ? t('nextSteps.willSend') : t('nextSteps.willFill')}
            </span>
            <span className="line-clamp-8">{previewed.prompt}</span>
          </TooltipContent>
        )}
      </Tooltip>
      {/* Outside the card: the dialog's events would otherwise reach the preview's trigger. */}
      <NextStepDialog
        detail={detail}
        open={dialogOpen}
        click={click}
        onClose={() => setDialogOpen(false)}
        onNewTask={actions.newTask}
      />
    </>
  );
}
