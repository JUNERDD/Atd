import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AutomationDraftSchema,
  parse,
  type NextStep,
  type NextStepClick,
} from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Textarea } from '@atd/ui/components/textarea';
import { showErrorToast, showToast } from '../../../components/toast-store';
import { failureWords } from '../../automations/automation-words';
import { TimeField } from '../../automations/schedule-inputs';
import { automationsBridge } from '../../automations/use-automations';
import { WeekdayPicker } from '../../automations/weekday-picker';
import { NEXT_STEP_ICONS } from './next-step-kinds';
import { proposedSchedule, suggestedAutomation } from './suggested-automation';
// The weekday picker's field trigger is styled by the automations feature.
import '../../automations/automations.css';

/** The suggestion a dialog shows, and the row that opened it, which gets focus back on close. */
export interface NextStepDetail {
  step: NextStep;
  opener: HTMLElement;
}

/** The longest automation name the contract accepts. */
const MAX_AUTOMATION_NAME = 120;

/**
 * The editable details of a new task or an automation. A new task opens with its prompt as the
 * draft, or starts with it under the click setting; an automation is created only from here.
 */
function NextStepForm({
  step,
  click,
  saving,
  onSavingChange,
  onClose,
  onNewTask,
}: {
  step: NextStep;
  click: NextStepClick;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onClose: () => void;
  onNewTask: (prompt: string, start: boolean) => void;
}) {
  const { t } = useTranslation('tasks');
  const { t: tAutomations } = useTranslation('automations');
  const id = useId();
  const [name, setName] = useState(step.label);
  const [prompt, setPrompt] = useState(step.prompt);
  const [schedule, setSchedule] = useState(() => proposedSchedule(step));
  const automation = step.kind === 'automation';
  const Icon = NEXT_STEP_ICONS[step.kind];
  const ready =
    prompt.trim() !== '' &&
    (!automation || (name.trim() !== '' && schedule.days.length > 0 && schedule.time !== ''));
  const hint = automation
    ? t('nextSteps.automationHint')
    : click === 'send'
      ? t('nextSteps.startHint')
      : t('nextSteps.openHint');

  async function create() {
    if (!ready || saving) return;
    onSavingChange(true);
    try {
      const draft = parse(AutomationDraftSchema, suggestedAutomation(name, prompt, schedule));
      await automationsBridge().create(draft);
      showToast({ kind: 'info', text: t('nextSteps.automationCreated', { name: draft.name }) });
      onSavingChange(false);
      onClose();
    } catch (error) {
      onSavingChange(false);
      showErrorToast(failureWords(error, tAutomations));
    }
  }
  function confirm() {
    if (automation) return void create();
    if (!ready) return;
    onClose();
    onNewTask(prompt.trim(), click === 'send');
  }

  return (
    <>
      <DialogHeader>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
          {t(`nextSteps.kinds.${step.kind}`)}
        </span>
        <DialogTitle>{automation ? t('nextSteps.automationTitle') : step.label}</DialogTitle>
        {step.reason && (
          <DialogDescription className="whitespace-normal">
            {t('nextSteps.why', { reason: step.reason })}
          </DialogDescription>
        )}
      </DialogHeader>
      <ScrollArea className="panel-dialog-scroll" gutter="stable" scrollShadow>
        <div className="panel-dialog-body">
          {automation && (
            <>
              <div className="settings-field">
                <Label htmlFor={`${id}-name`}>{t('nextSteps.nameLabel')}</Label>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={MAX_AUTOMATION_NAME}
                  autoComplete="off"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="next-step-schedule">
                <div className="settings-field">
                  <Label htmlFor={`${id}-days`}>{tAutomations('schedule.days')}</Label>
                  <WeekdayPicker
                    id={`${id}-days`}
                    days={schedule.days}
                    invalid={schedule.days.length === 0}
                    onChange={(days) => setSchedule((current) => ({ ...current, days }))}
                  />
                </div>
                <TimeField
                  time={schedule.time}
                  error=""
                  onChange={(time) => setSchedule((current) => ({ ...current, time }))}
                />
              </div>
            </>
          )}
          <div className="settings-field">
            <Label htmlFor={`${id}-prompt`}>{t('nextSteps.promptLabel')}</Label>
            <Textarea
              id={`${id}-prompt`}
              value={prompt}
              aria-describedby={`${id}-hint`}
              className="min-h-28"
              onChange={(event) => setPrompt(event.target.value)}
            />
            <p id={`${id}-hint`} className="m-0 text-xs text-muted-foreground">
              {hint}
            </p>
          </div>
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button variant="outline" disabled={saving} onClick={onClose}>
          {t('nextSteps.cancel')}
        </Button>
        <Button disabled={!ready || saving} aria-busy={saving || undefined} onClick={confirm}>
          {automation
            ? t('nextSteps.create')
            : click === 'send'
              ? t('nextSteps.startNewTask')
              : t('nextSteps.openInNewTask')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Details and actions for a suggestion that leaves this conversation: a new task or an
 * automation, everything editable before anything happens. Closing returns focus to the row that
 * opened it, while that row is still there.
 */
export function NextStepDialog({
  detail,
  open,
  click,
  onClose,
  onNewTask,
}: {
  detail: NextStepDetail | null;
  open: boolean;
  click: NextStepClick;
  onClose: () => void;
  onNewTask: (prompt: string, start: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const opener = detail?.opener;
  return (
    <Dialog
      open={open && detail !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent
        className="panel-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener?.isConnected) opener.focus();
        }}
        {...(detail?.step.reason ? {} : { 'aria-describedby': undefined })}
      >
        {detail && (
          <NextStepForm
            key={detail.step.id}
            step={detail.step}
            click={click}
            saving={saving}
            onSavingChange={setSaving}
            onClose={onClose}
            onNewTask={onNewTask}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
