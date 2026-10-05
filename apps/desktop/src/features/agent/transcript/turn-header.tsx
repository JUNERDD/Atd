import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { formatElapsed } from './elapsed';
import { formatRate, turnRate, type TurnGeneration } from './token-rate';
import { TurnUsageDetail } from './turn-usage-detail';
import type { TurnUsage } from './turn-usage';

/** One reading of the live header's clock: active elapsed time, and the wall time read. */
interface LiveTick {
  elapsed: number;
  at: number;
}

/**
 * Ticking clock for the live header, read once a second; freezes while the turn waits on the
 * user. Settled headers never tick.
 */
function useLiveTick(startedAt: number | null, live: boolean, paused: boolean): LiveTick {
  // The origin is fixed per mount: a new turn remounts the header with its own start time.
  const [origin] = useState(() => startedAt ?? Date.now());
  const [tick, setTick] = useState<LiveTick>({ elapsed: 0, at: 0 });
  const state = useRef({ pausedMs: 0, pauseStarted: null as number | null });

  useEffect(() => {
    if (!live) return;
    const tracker = state.current;
    const read = () => {
      const at = Date.now();
      setTick({ elapsed: Math.max(0, at - tracker.pausedMs - origin), at });
    };
    if (paused) {
      if (tracker.pauseStarted == null) tracker.pauseStarted = Date.now();
      read();
      return;
    }
    if (tracker.pauseStarted != null) {
      tracker.pausedMs += Date.now() - tracker.pauseStarted;
      tracker.pauseStarted = null;
    }
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [origin, live, paused]);

  return tick;
}

export type TurnWaitingKind = 'approval' | 'answer' | null;

/**
 * The live rate as of the clock's latest reading (`turnRate` at `at`). While the turn waits on
 * the user nothing streams, so the rate holds without a freeze of its own.
 */
function useLiveRate(
  generation: TurnGeneration | undefined,
  at: number,
  live: boolean,
): string | null {
  return useMemo(() => {
    if (!live || at === 0 || !generation) return null;
    const rate = turnRate(generation, at);
    return rate === null ? null : formatRate(rate);
    // `generation` is intentionally excluded: it changes with every streamed patch, but the
    // display only moves with the 1s tick so screen-reader chatter stays at the elapsed rhythm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, at]);
}

/**
 * Per-turn elapsed header, directly under the user message. Settled turns show
 * "Worked for … · model · … tok/s" from provider totals over service-timed generation; the live
 * turn shows a ticking "Working · … · model · … tok/s" that adds an estimate for the message
 * still streaming until its true total replaces it. A settled turn with reported usage ends in a
 * trigger for its token and cost detail. Copy lives in the turn actions, not here.
 */
export function TurnHeader({
  startedAt,
  durationMs,
  modelName,
  live,
  waiting,
  generation,
  usage,
}: {
  startedAt: number | null;
  durationMs: number | null;
  modelName: string;
  live: boolean;
  waiting: TurnWaitingKind;
  /** Absent before the turn has blocks (the pending turn). */
  generation?: TurnGeneration;
  usage?: TurnUsage | null;
}) {
  const { t } = useTranslation('tasks');
  const tick = useLiveTick(live ? startedAt : null, live, waiting !== null);
  const liveRate = useLiveRate(generation, tick.at, live);

  if (live) {
    const elapsed = formatElapsed(tick.elapsed) ?? '';
    const label =
      waiting !== null
        ? waiting === 'answer'
          ? t('permission.waitingAnswer')
          : t('permission.waitingApproval')
        : modelName
          ? t('transcript.footer.live', { elapsed, model: modelName })
          : `${t('transcript.verb.working')} · ${t('transcript.footer.elapsed', { elapsed })}`;
    const suffix = liveRate === null ? '' : ` · ${t('transcript.rate.tps', { rate: liveRate })}`;
    return (
      <output
        aria-live="polite"
        aria-label={waiting !== null ? label : modelName || t('transcript.verb.working')}
        className="turn-header turn-header-live"
      >
        <LoaderCircle className="turn-header-spinner" />
        <Shimmer as="span" className="turn-header-label">
          {`${label}${suffix}`}
        </Shimmer>
      </output>
    );
  }

  const elapsed = formatElapsed(durationMs);
  if (elapsed === null) return null;
  const rate = generation ? turnRate(generation) : null;
  const suffix = rate === null ? '' : ` · ${t('transcript.rate.tps', { rate: formatRate(rate) })}`;
  const label = `${
    modelName
      ? t('transcript.footer.done', { elapsed, model: modelName })
      : t('transcript.footer.workedFor', { elapsed })
  }${suffix}`;
  return (
    <div className="turn-header" aria-label={label}>
      <Check className="turn-header-check" />
      <span className="turn-header-label" title={label}>
        {label}
      </span>
      {usage && <TurnUsageDetail usage={usage} />}
    </div>
  );
}
