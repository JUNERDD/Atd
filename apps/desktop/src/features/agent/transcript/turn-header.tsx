import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';

function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs == null) return null;
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Wall-clock stamp for a finished turn, in the reader's own locale. */
function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Ticking clock for the live header; freezes while the turn waits on the user. */
function useLiveElapsed(startedAt: number | null, paused: boolean): number {
  // The origin is fixed per mount: a new turn remounts the header with its own start time.
  const [origin] = useState(() => startedAt ?? Date.now());
  const [elapsed, setElapsed] = useState(0);
  const state = useRef({ pausedMs: 0, pauseStarted: null as number | null });

  useEffect(() => {
    const tracker = state.current;
    if (paused) {
      tracker.pauseStarted ??= Date.now();
      setElapsed(Math.max(0, Date.now() - tracker.pausedMs - origin));
      return;
    }
    if (tracker.pauseStarted != null) {
      tracker.pausedMs += Date.now() - tracker.pauseStarted;
      tracker.pauseStarted = null;
    }
    setElapsed(Math.max(0, Date.now() - tracker.pausedMs - origin));
    const timer = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - tracker.pausedMs - origin));
    }, 1000);
    return () => clearInterval(timer);
  }, [origin, paused]);

  return elapsed;
}

export type TurnWaitingKind = 'approval' | 'answer' | null;

/**
 * Per-turn elapsed header, directly under the user message. Settled turns show
 * "Worked for … · model · clock"; the live turn shows a ticking "Working · … · model"
 * instead of the old bare status line. Copy lives in the turn actions, not here.
 */
export function TurnHeader({
  startedAt,
  durationMs,
  modelName,
  live,
  waiting,
}: {
  startedAt: number | null;
  durationMs: number | null;
  modelName: string;
  live: boolean;
  waiting: TurnWaitingKind;
}) {
  const { t } = useTranslation('tasks');
  const elapsedMs = useLiveElapsed(live ? startedAt : null, waiting !== null);

  if (live) {
    const elapsed = formatElapsed(elapsedMs) ?? '';
    const label =
      waiting !== null
        ? waiting === 'answer'
          ? t('permission.waitingAnswer')
          : t('permission.waitingApproval')
        : modelName
          ? t('transcript.footer.live', { elapsed, model: modelName })
          : `${t('transcript.verb.working')} · ${t('transcript.footer.elapsed', { elapsed })}`;
    return (
      <output
        aria-live="polite"
        aria-label={waiting !== null ? label : modelName || t('transcript.verb.working')}
        className="turn-header turn-header-live"
      >
        <LoaderCircle className="turn-header-spinner" />
        <Shimmer as="span" className="turn-header-label">
          {label}
        </Shimmer>
      </output>
    );
  }

  const elapsed = formatElapsed(durationMs);
  if (elapsed === null) return null;
  const clock =
    startedAt !== null && durationMs !== null ? formatClockTime(startedAt + durationMs) : '';
  const label =
    modelName && clock
      ? t('transcript.footer.done', { elapsed, model: modelName, clock })
      : `${t('transcript.footer.workedFor', { elapsed })}${modelName ? ` · ${modelName}` : ''}`;
  return (
    <div className="turn-header" aria-label={label}>
      <Check className="turn-header-check" />
      <span className="turn-header-label" title={label}>
        {label}
      </span>
    </div>
  );
}
