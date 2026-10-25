import { useState } from 'react';
import { CircleCheck, Globe, ScanEye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerDetails, ComputerError, ComputerRefusalReason } from '@atd/agent-contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import { Button } from '@atd/ui/components/button';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { showErrorToast } from '../../../components/toast-store';
import {
  computerBridge,
  refreshComputer,
  useComputerShellState,
  useUnresolvedActions,
} from '../../computer/use-computer';
import { computerReviewActions } from './computer-review';
import { ToolCard } from './tool-card';
import { useTaskTurns } from './turn-context';

/**
 * A step the host left to the person because no route it may use could take it, the foreground
 * included where the task allows it: one with no route (by the limit it hit, `noRoute` when the
 * host named none, also for a window it would not restore, move or switch to, and for the
 * foreground it tried and undid: `covered`, `notActivated`), a target the person is using, screen
 * capture nobody prepared, or an action that disturbed the person and stopped.
 */
type Handoff =
  | { kind: 'route'; reason: ComputerRefusalReason }
  | { kind: 'inUse' | 'consent' | 'disturbed' };

function handoffOf(error: ComputerError | undefined): Handoff | null {
  if (!error) return null;
  if (error.code === 'targetInUse') return { kind: 'inUse' };
  if (error.code === 'needsConsent') return { kind: 'consent' };
  if (error.code === 'disturbed') return { kind: 'disturbed' };
  if (error.code === 'noBackgroundRoute' || error.reason) {
    return { kind: 'route', reason: error.reason ?? 'noRoute' };
  }
  return null;
}

/**
 * What a person can do about a call, under its outcome. Mark as checked on an action whose
 * effect is unknown or partial, or whose reply was lost, and that the service still lists as
 * unresolved (so it does not come back after a reload), after confirming they looked at the
 * target themselves, so the service records it resolved by a person and later business actions
 * on the target are no longer held back. An act the service held back for such earlier actions
 * (`blockedBy`) offers the same check for those still unresolved, under a line saying why the
 * step waits, so the person can lift the hold where the agent stopped. On the task's latest run,
 * a step the host left to the person, whether an action's (`result.error`) or another operation's
 * refusal (`details.error`, such as an observation without prepared capture or an access request
 * whose browser is not open), says what to do themselves and to tell Atd to continue afterwards;
 * Prepare screen access opens Settings › Computer use, where the person prepares capture (the
 * guidance turns to ready once the shell reports it), and Open browser opens a browser
 * environment the host could not start in the background. Each answer reads as a short note in
 * place of the guidance and its buttons. Nothing here acts on the target: the foreground, where a
 * step needs it, is the host's own fallback inside the action, never something this card starts.
 */
export function ComputerFollowUp({
  block,
  data,
}: {
  block: BlockOf<'tool'>;
  data: ComputerDetails;
}) {
  const { t } = useTranslation('tasks');
  const turns = useTaskTurns();
  const shell = useComputerShellState();
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const bridge = computerBridge();
  const result = data.result;
  // An action whose reply was lost has no result; the service still lists it while it may have
  // taken effect, so it is as checkable as an unknown one. An act the service held back recorded
  // nothing itself, so only the earlier actions it names can be checked from it.
  const { own, actionIds: candidates } = computerReviewActions(data);
  // Only actions the service still lists can be checked.
  const checkIds = useUnresolvedActions(
    turns?.taskId ?? '',
    candidates,
    turns?.runs.map(({ id, status }) => `${id}:${status}`).join(',') ?? '',
    candidates.length > 0 && Boolean(turns),
  );
  if (!bridge || !turns) return null;
  const blocked = !own && checkIds.length > 0;
  // Only the latest run still waits on the person; a later run already moved past this step. An
  // action carries its refusal in its result; any other operation in the details.
  const handoff =
    turns.runs.at(-1)?.id === block.runId ? handoffOf(result?.error ?? data.error) : null;
  if (!note && checkIds.length === 0 && !handoff) return null;
  const target = data.target ?? t('computer.unnamedTarget');
  const consentReady = Boolean(shell?.captureConsent);
  const browserId =
    handoff?.kind === 'route' && handoff.reason === 'openBrowser' ? data.bindingId : undefined;

  function guidance(handoff: Handoff) {
    switch (handoff.kind) {
      case 'route':
        return t(`computer.handoff.route.${handoff.reason}`, { target });
      case 'inUse':
        return t('computer.handoff.inUse', { target });
      case 'consent':
        return t(consentReady ? 'computer.handoff.consentReady' : 'computer.handoff.consent');
      case 'disturbed':
        return t('computer.handoff.disturbed', { target });
    }
  }
  async function act(work: () => Promise<string>) {
    setPending(true);
    try {
      setNote(await work());
    } catch (error) {
      showErrorToast(error);
    } finally {
      setPending(false);
    }
  }
  const check = (ids: readonly string[]) =>
    act(async () => {
      const { resolved } = await bridge.resolveFacts({
        taskId: turns.taskId,
        actionIds: [...ids],
      });
      refreshComputer();
      if (!blocked) return t(resolved.length ? 'computer.check.done' : 'computer.check.nothing');
      return resolved.length
        ? t('computer.check.blockedDone', { count: resolved.length })
        : t('computer.check.blockedNothing');
    });
  const prepareConsent = () =>
    act(async () => {
      await window.desktop?.settings.openSection('computer');
      return t('computer.handoff.settingsOpened');
    });
  const openBrowser = (bindingId: string) =>
    act(async () => {
      await bridge.openProfile(bindingId);
      return t('computer.handoff.browserOpened');
    });
  const offersConsent = handoff?.kind === 'consent' && !consentReady;

  return (
    <ToolCard.Footer>
      {note ? (
        <output className="m-0 block text-xs text-muted-foreground">{note}</output>
      ) : (
        // Guidance stacks above its buttons, so a long sentence never squeezes them.
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          {handoff && <p className="m-0 wrap-anywhere">{guidance(handoff)}</p>}
          {blocked && (
            <p className="m-0 wrap-anywhere">
              {t('computer.check.blocked', { count: checkIds.length, target })}
            </p>
          )}
          {(checkIds.length > 0 || offersConsent || browserId) && (
            <div className="flex flex-wrap gap-2">
              {checkIds.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => setConfirming(true)}
                >
                  <CircleCheck data-icon="inline-start" />
                  {t('computer.check.action')}
                </Button>
              )}
              {offersConsent && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => void prepareConsent()}
                >
                  <ScanEye data-icon="inline-start" />
                  {t('computer.handoff.prepareConsent')}
                </Button>
              )}
              {browserId && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={pending}
                  onClick={() => void openBrowser(browserId)}
                >
                  <Globe data-icon="inline-start" />
                  {t('computer.handoff.openBrowser')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {blocked
                ? t('computer.check.blockedTitle', { count: checkIds.length })
                : t('computer.check.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {blocked
                ? t('computer.check.blockedDescription', { count: checkIds.length, target })
                : t('computer.check.description', { target })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('computer.check.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (checkIds.length > 0) void check(checkIds);
              }}
            >
              {t('computer.check.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ToolCard.Footer>
  );
}
