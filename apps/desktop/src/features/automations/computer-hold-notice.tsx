import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import type { AutomationItem } from '@atd/agent-contracts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import { Button } from '@atd/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { Label } from '@atd/ui/components/label';
import { Spinner } from '@atd/ui/components/spinner';
import { AutomationConflictError } from '../../client/automations-contract';
import { showErrorToast, showToast } from '../../components/toast-store';
import { messageOf } from '../../lib/errors';
import { FieldError } from '../commands/field-error';
import { formatWhen } from './automation-time';
import { automationsBridge, useAutomationRuns } from './use-automations';

/**
 * Why the automation waits for the person: a run left computer actions whose effect nobody could
 * confirm, so nothing it does on a computer runs again, scheduled, chained or Run now, until a
 * person looked. Review and resolve opens that run's task and asks them to confirm they checked
 * the target; marking runs read never clears it, which the notice says.
 */
export function ComputerHoldNotice({ item }: { item: AutomationItem }) {
  const { t, i18n } = useTranslation('automations');
  const hold = item.status.computerHold;
  const { runs } = useAutomationRuns(item.automation.id);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const checkId = useId();
  // Dates read against when the notice first showed, as the run rows do.
  const [now] = useState(() => new Date());
  if (!hold) return null;
  const run = runs?.find(({ id }) => id === hold.runId);
  const taskId = run?.taskId;
  const since = formatWhen(hold.since, now, i18n.language);
  async function resolve() {
    if (!hold || !checked || pending) return;
    setPending(true);
    setFailure(null);
    try {
      await automationsBridge().resolveComputerHold(item.automation.id, hold.runId);
      setPending(false);
      setOpen(false);
      showToast({ kind: 'info', text: t('computer.hold.resolved') });
    } catch (error) {
      setPending(false);
      setFailure(
        error instanceof AutomationConflictError ? t('computer.hold.conflict') : messageOf(error),
      );
    }
  }
  return (
    <>
      <Alert data-settings-anchor="automation-computer-hold">
        <TriangleAlert />
        <AlertTitle>{t('computer.hold.title')}</AlertTitle>
        <AlertDescription>
          {t(`computer.hold.reason.${hold.reason}`, {
            count: hold.unresolvedActionIds.length,
            since,
          })}{' '}
          {t('computer.hold.markReadNote')}
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setChecked(false);
              setFailure(null);
              setOpen(true);
            }}
          >
            {t('computer.hold.review')}
          </Button>
        </AlertAction>
      </Alert>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent className="panel-dialog">
          <DialogHeader>
            <DialogTitle>{t('computer.hold.dialogTitle')}</DialogTitle>
            <DialogDescription className="whitespace-normal">
              {t('computer.hold.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          {taskId && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => void automationsBridge().showTask(taskId).catch(showErrorToast)}
            >
              {t('computer.hold.openRun')}
            </Button>
          )}
          <Label htmlFor={checkId} className="items-start gap-3 font-normal">
            <input
              id={checkId}
              type="checkbox"
              checked={checked}
              className="mt-0.5 size-4 shrink-0 accent-primary"
              onChange={(event) => setChecked(event.target.checked)}
            />
            <span className="whitespace-normal">{t('computer.hold.acknowledge')}</span>
          </Label>
          {failure && <FieldError id={`${checkId}-error`}>{failure}</FieldError>}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t('list.cancel')}
            </Button>
            <Button
              aria-disabled={!checked || pending || undefined}
              aria-busy={pending || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => void resolve()}
            >
              {pending && <Spinner data-icon="inline-start" />}
              {t('computer.hold.resolve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
