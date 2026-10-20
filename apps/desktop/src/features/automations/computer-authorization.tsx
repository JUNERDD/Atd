import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { AutomationItem } from '@atd/agent-contracts';
import { Alert, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import { Button } from '@atd/ui/components/button';
import { Spinner } from '@atd/ui/components/spinner';
import { showErrorToast } from '../../components/toast-store';
import { isActive } from '../../client/agent/task-schema';
import { useAgent } from '../agent/use-agent';
import { failureWords } from './automation-words';
import { authorizationState } from './computer-scope';
import { automationsBridge } from './use-automations';

const STATE_ICONS = {
  authorized: <ShieldCheck />,
  changed: <ShieldX />,
  needed: <ShieldAlert />,
};

/**
 * Where the computer scope's authorization stands and the two steps that change it. Run trial
 * starts the saved steps for real with the person present, and follows the trial's task until it
 * ends; Save and authorize saves pending edits first, then opens the shell's confirmation. A trial
 * runs what is saved, so it waits for edits to be saved; scheduled runs never act without a grant
 * that matches the saved automation.
 */
export function ComputerAuthorization({
  saved,
  dirty,
  pending,
  onSaveAndAuthorize,
}: {
  saved: AutomationItem | null;
  dirty: boolean;
  /** The editor is saving. */
  pending: boolean;
  onSaveAndAuthorize: () => void;
}) {
  const { t } = useTranslation('automations');
  const tasks = useAgent().snapshot?.tasks;
  const [trial, setTrial] = useState<{ taskId: string; runId: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const state = authorizationState(saved);
  const trialRun = trial
    ? tasks?.find(({ id }) => id === trial.taskId)?.runs.find(({ id }) => id === trial.runId)
    : undefined;
  // The service's verdict wins once it has one: only it judges a trial, from the host's facts.
  const judged = saved?.status.computerTrial;
  const trialStatus =
    trial && (!trialRun || isActive(trialRun.status))
      ? 'running'
      : (judged ?? (!trial ? null : trialRun?.status === 'completed' ? 'finished' : 'incomplete'));
  const blocked = !saved || dirty;
  async function runTrial() {
    if (!saved || blocked || starting) return;
    setStarting(true);
    try {
      const started = await automationsBridge().computerTrial(
        saved.automation.id,
        saved.automation.revision,
      );
      setTrial({ taskId: started.taskId, runId: started.runId });
      void automationsBridge().showTask(started.taskId).catch(showErrorToast);
    } catch (error) {
      showErrorToast(failureWords(error, t));
    }
    setStarting(false);
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Alert role="note" data-settings-anchor="automation-computer-authorization">
        {STATE_ICONS[state]}
        <AlertTitle>{t(`computer.authorization.${state}.title`)}</AlertTitle>
        <AlertDescription>{t(`computer.authorization.${state}.description`)}</AlertDescription>
      </Alert>
      <p id="automation-computer-trial-note" className="settings-field-note">
        {blocked ? t('computer.trial.saveFirst') : t('computer.trial.note')}
      </p>
      {trialStatus && (
        <p className="settings-field-note" aria-live="polite">
          {t(`computer.trial.${trialStatus}`)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-describedby="automation-computer-trial-note"
          aria-disabled={blocked || starting || trialStatus === 'running' || undefined}
          aria-busy={starting || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (trialStatus !== 'running') void runTrial();
          }}
        >
          {starting ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FlaskConical data-icon="inline-start" />
          )}
          {t('computer.trial.run')}
        </Button>
        {trial && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void automationsBridge().showTask(trial.taskId).catch(showErrorToast)}
          >
            <SquareArrowOutUpRight data-icon="inline-start" />
            {t('computer.trial.open')}
          </Button>
        )}
        <Button
          type="button"
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (!pending) onSaveAndAuthorize();
          }}
        >
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          {t('computer.saveAndAuthorize')}
        </Button>
      </div>
    </div>
  );
}
