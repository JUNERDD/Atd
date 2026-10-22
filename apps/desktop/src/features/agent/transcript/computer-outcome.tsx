import { useTranslation } from 'react-i18next';
import type { ActionResult, ComputerDisturbance, ComputerError } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { outcomeTone, type ComputerOutcome } from './computer-call';

/**
 * The tag on the row of an action the host completed in the foreground (`ComputerDetails.delivery`,
 * set by `useComputerRow`): it briefly brought the app forward, sent the step's clicks and keys
 * straight to it without moving the pointer, then switched back to the app and window the person
 * was using. The hint says so in a native tooltip, like the Temporary badge of a task agent; what
 * the host brought forward and restored reads in the card's evidence and in "What changed for
 * you". Its text takes the row's muted face, as every other part of a row does, so a run of
 * foreground steps stays quiet while the outline sets it apart.
 */
export function ComputerForegroundTag() {
  const { t } = useTranslation('tasks');
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground"
      title={t('computer.delivery.foregroundHint')}
    >
      {t('computer.delivery.foreground')}
    </Badge>
  );
}

/**
 * Why a call stopped or was refused, as plain detail text: what happened, the background limit it
 * hit when the host named one, and the host's own words in the muted tone. An action's comes with
 * its outcome (`ComputerSummary`); any other operation's stands alone under the header.
 */
export function ComputerErrorLine({ error }: { error: ComputerError }) {
  const { t } = useTranslation('tasks');
  return (
    <p className="computer-error">
      {t(`computer.error.${error.code}`)}
      {error.reason && ` ${t(`computer.refusal.${error.reason}`)}`}
      {error.message && <span className="text-muted-foreground"> {error.message}</span>}
    </p>
  );
}

/**
 * The opening lines of a `computer` call's detail, under the card header that already names the
 * outcome: what took effect, why it stopped (with the background limit it hit, when the host named
 * one) and whether it may be tried again. The card keeps one title, the header, so these read as
 * plain detail text; an effect that may have happened unchecked repeats its words in the warning
 * tone, and a checked result reads in the plain foreground like every other success.
 */
export function ComputerSummary({
  outcome,
  result,
  total,
}: {
  outcome: ComputerOutcome;
  result: ActionResult;
  total: number;
}) {
  const { t } = useTranslation('tasks');
  const unverifiedResult =
    outcome === 'partial' &&
    result.dispatch === 'settled' &&
    total > 0 &&
    result.completedSteps === total &&
    !result.error &&
    result.stoppedAt === undefined;
  return (
    <div className="computer-summary">
      <p className="computer-outcome" data-tone={outcomeTone(outcome) ?? undefined}>
        {t(`computer.outcomeDetail.${unverifiedResult ? 'partialUnverified' : outcome}`, {
          completed: result.completedSteps,
          total,
        })}
      </p>
      {result.error && <ComputerErrorLine error={result.error} />}
      {result.retry !== 'safe' && (
        <p className="computer-note">{t(`computer.retry.${result.retry}`)}</p>
      )}
    </div>
  );
}

/**
 * What the host's guard saw change for the person while the action ran and that they did not do
 * themselves (the caller leaves those out): what changed, who caused it as far as the host can
 * tell, and whether the host put it back. One left as it was reads in the warning tone, which its
 * words already say; the guard's own note follows in the muted tone.
 */
export function ComputerDisturbances({
  disturbances,
}: {
  disturbances: readonly ComputerDisturbance[];
}) {
  const { t } = useTranslation('tasks');
  return (
    <ul className="computer-disturbances">
      {disturbances.map((item, index) => (
        <li
          // Facts in the host's order; two of one kind can differ only in their note.
          key={`${item.kind}-${index}`}
          className="computer-disturbance"
          data-tone={item.repaired ? undefined : 'warning'}
        >
          {t(`computer.disturbance.kind.${item.kind}`)}
          {' · '}
          {t(
            item.attribution === 'agent'
              ? 'computer.disturbance.byAtd'
              : 'computer.disturbance.byUnknown',
          )}
          {' · '}
          {t(item.repaired ? 'computer.disturbance.repaired' : 'computer.disturbance.notRepaired')}
          {item.detail && <span className="text-muted-foreground"> {item.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
