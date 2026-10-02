import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { formatElapsed } from './elapsed';
import { averageRate, estimateTokens, formatRate } from './token-rate';
import { TurnUsageDetail } from './turn-usage-detail';
import type { TurnUsage } from './turn-usage';

/** Ticking clock for the live header; freezes while the turn waits on the user. */
function useLiveElapsed(startedAt: number | null, paused: boolean): number {
  // The origin is fixed per mount: a new turn remounts the header with its own start time.
  const [origin] = useState(() => startedAt ?? Date.now());
  const [elapsed, setElapsed] = useState(0);
  const state = useRef({ pausedMs: 0, pauseStarted: null as number | null });

  useEffect(() => {
    const tracker = state.current;
    if (paused) {
      if (tracker.pauseStarted == null) tracker.pauseStarted = Date.now();
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
 * Live estimated rate over streamed prose, moving with the header's 1s tick. While no prose
 * streams the display holds its last value and the anchor advances past the idle span, so tool
 * execution and stalls cannot dilute the streaming rate. While the turn waits on the user the
 * display freezes outright: the clock freeze alone cannot hold it, because a text flush that
 * lands on the frozen clock would divide the cumulative total by a near-zero active span.
 */
function useLiveRate(
  text: string,
  elapsedMs: number,
  live: boolean,
  paused: boolean,
): string | null {
  const [mountText] = useState(text);
  const tracker = useRef({
    first: null as number | null,
    at: 0,
    lastText: '',
    display: null as string | null,
  });
  return useMemo(() => {
    if (!live) return null;
    const state = tracker.current;
    if (paused) return state.display;
    if (text === '') return state.display;
    if (text === state.lastText) {
      if (state.first !== null) state.first += Math.max(0, elapsedMs - state.at);
      state.at = elapsedMs;
      return state.display;
    }
    state.lastText = text;
    // Mounted with existing text (task switch remount): the true first prose predates the mount,
    // so anchor at the turn start instead of spiking `total/250ms`. Fresh turns anchor at the
    // first streamed prose, leaving TTFT out of the rate.
    state.first ??= mountText === '' ? elapsedMs : 0;
    state.at = elapsedMs;
    const tokens = estimateTokens(text);
    if (tokens <= 0) return state.display;
    const display = formatRate(averageRate(tokens, Math.max(0, elapsedMs - state.first)));
    state.display = display;
    return display;
    // `text` is intentionally excluded: sampling follows the patch cadence through the ref
    // comparison above, but the display only moves with the 1s `elapsedMs` tick so
    // screen-reader chatter stays at the existing elapsed rhythm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, elapsedMs, mountText, paused]);
}

/**
 * Per-turn elapsed header, directly under the user message. Settled turns show
 * "Worked for … · model · … tok/s" from the provider true total; the live turn shows a
 * ticking "Working · … · model · … tok/s" from the character estimate until the true average
 * replaces it on settle. A settled turn with reported usage ends in a trigger for its token and
 * cost detail. Copy lives in the turn actions, not here.
 */
export function TurnHeader({
  startedAt,
  durationMs,
  modelName,
  live,
  waiting,
  trueTokens,
  trueDurationMs,
  liveText,
  usage,
}: {
  startedAt: number | null;
  durationMs: number | null;
  modelName: string;
  live: boolean;
  waiting: TurnWaitingKind;
  trueTokens?: number | null;
  trueDurationMs?: number | null;
  liveText?: string | undefined;
  usage?: TurnUsage | null;
}) {
  const { t } = useTranslation('tasks');
  const elapsedMs = useLiveElapsed(live ? startedAt : null, waiting !== null);
  const liveRate = useLiveRate(liveText ?? '', elapsedMs, live, waiting !== null);

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
  const tokens = trueTokens ?? null;
  const generationMs = trueDurationMs ?? null;
  let suffix = '';
  if (tokens !== null && tokens > 0 && generationMs !== null && generationMs >= 0)
    suffix = ` · ${t('transcript.rate.tps', { rate: formatRate(averageRate(tokens, generationMs)) })}`;
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
