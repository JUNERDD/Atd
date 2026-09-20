import { useEffect, useMemo, useRef } from 'react';
import { formatElapsed } from './elapsed';
import {
  averageRate,
  estimateTokens,
  formatRate,
  pruneSamples,
  windowedRate,
  type RateSample,
} from './token-rate';

export type TokenRateInput = {
  /** Joined model-output text from the adapter; drives the live character estimate. */
  text: string;
  live: boolean;
  /** Approval/input wait: the suffix freezes instead of decaying. */
  waiting: boolean;
  /** A tool/question in the turn is still running: the clock pauses. */
  toolRunning: boolean;
  startedAt: number | null;
  /** Provider true total for settled turns; null while streaming or when unknown. */
  trueTokens: number | null;
  durationMs: number | null;
  /** The turn lost provider history to compaction; settled falls back to the estimate. */
  rateUnknown: boolean;
  /** Live 1s tick from the header clock; throttles the suffix to the same cadence. */
  elapsedMs: number;
};

export type TokenRateDisplay =
  | { kind: 'stats'; rate: string; tokens: number; elapsed: string }
  | { kind: 'tps'; rate: string }
  | null;

/**
 * Live estimate while streaming, provider true average on settle. Sampling follows the 40ms
 * patch cadence but the display only moves with the header's 1s tick, so screen-reader chatter
 * stays at the existing elapsed rhythm. Tool execution and waiting pause the clock; the frozen
 * value stays visible for tool-heavy turns with an empty answer.
 */
export function useTokenRate(input: TokenRateInput): TokenRateDisplay {
  const {
    text,
    live,
    waiting,
    toolRunning,
    startedAt,
    trueTokens,
    durationMs,
    rateUnknown,
    elapsedMs,
  } = input;
  const paused = waiting || toolRunning;
  const samples = useRef<RateSample[]>([]);
  const firstDelta = useRef<{ t: number; paused: number } | null>(null);
  const pause = useRef({ total: 0, start: null as number | null });
  const frozen = useRef<TokenRateDisplay>(null);
  const mountText = useRef(text);

  // Pause accounting mirrors the header clock; tool pauses join waiting pauses here.
  useEffect(() => {
    const tracker = pause.current;
    if (paused) {
      tracker.start ??= Date.now();
      return;
    }
    if (tracker.start != null) {
      tracker.total += Date.now() - tracker.start;
      tracker.start = null;
    }
  }, [paused]);

  // Live sampling follows the patch cadence; the display below only moves with the 1s
  // tick, so a fast burst inside one tick still renders once.
  useEffect(() => {
    if (!live || paused || !text) return;
    const now = Date.now();
    if (firstDelta.current === null) {
      // Mounted with existing text (task switch remount): the true first delta predates the
      // mount, so anchor elapsed at the user message instead of spiking `total/250ms`. TTFT
      // and pre-mount pauses stay inside this fallback span; true first deltas anchor at now.
      const remount = mountText.current !== '';
      firstDelta.current = {
        t: remount && startedAt !== null ? startedAt : now,
        paused: pause.current.total,
      };
    }
    const tokens = estimateTokens(text);
    const current = samples.current;
    const last = current[current.length - 1];
    if (last === undefined || tokens > last.tokens)
      samples.current = pruneSamples(
        [...current, { t: now, tokens, paused: pause.current.total }],
        now,
      );
  }, [text, live, paused, startedAt]);

  return useMemo(() => {
    if (!live) {
      // Settled: provider true total back-dated across active time; compaction or legacy
      // turns without a true total fall back to the estimate, empty turns hide.
      const estimated = text ? estimateTokens(text) : 0;
      const total =
        !rateUnknown && trueTokens !== null ? trueTokens : estimated > 0 ? estimated : null;
      if (total === null || total <= 0) return null;
      const wall = durationMs ?? 0;
      const active = Math.max(0, wall - pause.current.total);
      const elapsed = formatElapsed(active > 0 ? active : wall);
      if (elapsed === null) return null;
      const rate = formatRate(averageRate(total, active > 0 ? active : wall));
      if (active > 0 && active < 1000) return { kind: 'tps', rate };
      return { kind: 'stats', rate, tokens: total, elapsed };
    }
    if (paused) return frozen.current;
    const first = firstDelta.current;
    if (!first) return null;
    const now = Date.now();
    const window = windowedRate(
      pruneSamples(samples.current, now),
      now,
      pause.current.total + (pause.current.start != null ? now - pause.current.start : 0),
    );
    if (!window) return null;
    const totalElapsed = Math.max(0, now - pause.current.total - (first.t - first.paused));
    const elapsed = formatElapsed(totalElapsed);
    if (elapsed === null) return null;
    const display: TokenRateDisplay =
      totalElapsed < 1000
        ? { kind: 'tps', rate: formatRate(window.rate) }
        : {
            kind: 'stats',
            rate: formatRate(window.rate),
            tokens: window.tokens,
            elapsed,
          };
    frozen.current = display;
    return display;
    // `text` is intentionally excluded: live sampling mutates refs in the effect above, and the
    // display only moves with the 1s `elapsedMs` tick. Settled text is static, and the
    // live->settled transition re-runs via `live`. Refs are mutated by the effects above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, paused, elapsedMs, trueTokens, durationMs, rateUnknown]);
}
