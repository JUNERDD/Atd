import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@atd/ui/components/ai-elements/shimmer';
import { useContentChangeFade } from '../content-feedback';
import { formatElapsed } from './elapsed';
import { formatRate, turnRate, type TurnGeneration } from './token-rate';
import { TurnUsageDetail } from './turn-usage-detail';
import type { TurnUsage } from './turn-usage';
import './turn-header.css';

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
 * still streaming until its true total replaces it. A settled turn with reported usage, its own
 * or its suggested next steps' request, ends in a trigger for its token and cost detail. Copy
 * lives in the turn actions, not here.
 */
export function TurnHeader({
  startedAt,
  durationMs,
  modelName,
  live,
  waiting,
  generation,
  usage,
  nextStepsUsage,
}: {
  startedAt: number | null;
  durationMs: number | null;
  modelName: string;
  live: boolean;
  waiting: TurnWaitingKind;
  /** Absent before the turn has blocks (the pending turn). */
  generation?: TurnGeneration;
  usage?: TurnUsage | null;
  /** What the request for the turn's suggested next steps used, shown apart from the reply's. */
  nextStepsUsage?: TurnUsage | undefined;
}) {
  const { t } = useTranslation('tasks');
  const tick = useLiveTick(live ? startedAt : null, live, waiting !== null);
  const liveRate = useLiveRate(generation, tick.at, live);
  // Only lifecycle changes arrive. Clock ticks and token rates update the same content in place;
  // a historical header mounts settled, so opening a conversation never replays its completion.
  const phase = live ? (waiting ?? 'working') : 'settled';
  const feedbackRef = useContentChangeFade<HTMLDivElement>(phase);
  const elapsed = formatElapsed(live ? tick.elapsed : durationMs);
  const rate = generation && !live ? turnRate(generation) : null;
  const rateLabel = live ? liveRate : rate === null ? null : formatRate(rate);
  const suffix = rateLabel === null ? '' : ` · ${t('transcript.rate.tps', { rate: rateLabel })}`;
  const label = live
    ? waiting !== null
      ? waiting === 'answer'
        ? t('permission.waitingAnswer')
        : t('permission.waitingApproval')
      : modelName
        ? t('transcript.footer.live', { elapsed: elapsed ?? '', model: modelName })
        : `${t('transcript.verb.working')} · ${t('transcript.footer.elapsed', { elapsed: elapsed ?? '' })}`
    : modelName
      ? t('transcript.footer.done', { elapsed, model: modelName })
      : t('transcript.footer.workedFor', { elapsed });
  if (elapsed === null) return null;
  const text = `${label}${suffix}`;
  return (
    <div
      className={live ? 'turn-header turn-header-live' : 'turn-header'}
      role={live ? 'status' : undefined}
      aria-label={
        live ? (waiting !== null ? label : modelName || t('transcript.verb.working')) : text
      }
    >
      <div ref={feedbackRef} className="turn-header-content">
        {live ? (
          <LoaderCircle className="turn-header-spinner" />
        ) : (
          <Check className="turn-header-check" />
        )}
        {live ? (
          <Shimmer as="span" className="turn-header-label">
            {text}
          </Shimmer>
        ) : (
          <span className="turn-header-label" title={text}>
            {text}
          </span>
        )}
        {!live && (usage || nextStepsUsage) && (
          <TurnUsageDetail usage={usage ?? null} nextStepsUsage={nextStepsUsage} />
        )}
      </div>
    </div>
  );
}
